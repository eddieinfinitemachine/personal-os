import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeDue } from "@/lib/maintenance";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeText } from "@/lib/claude";
import { applyPetActions, validatePetActions } from "@/lib/pet-edit";

type ChatTurn = { role: "user" | "assistant"; content: string };

// For pet projects the chat is read-write: Claude replies with a JSON object
// carrying the answer plus zero or more structured edit actions. The action
// catalog mirrors the manual add-weight / add-vaccination / add-vet-visit
// forms, so "China now weighs 9.6 lb and got a rabies shot today" lands as
// real records without opening a form.
const PET_EDIT_INSTRUCTIONS = `
You can also RECORD data for this pet. When the owner states facts to log —
a new weight, a vaccination or shot they received, a vet visit, or a profile
change (feeding schedule, vet clinic, microchip, etc.) — include actions.

Respond with ONLY a JSON object, no other text:
{"answer": "<markdown reply confirming what you recorded and/or answering the question>", "actions": [ ... ]}

Available actions (omit "actions" or use [] when there is nothing to record):
- {"type": "add_weight", "weightLb": <number>, "measuredAt": "<ISO date>", "notes": <string|null>}
- {"type": "add_vaccination", "name": "<e.g. Rabies, FVRCP>", "administeredAt": "<ISO date>", "boosterDueAt": <"ISO date"|null>, "vet": <string|null>, "notes": <string|null>}
- {"type": "add_vet_visit", "performedAt": "<ISO date>", "reason": "<short reason>", "vet": <string|null>, "details": <string|null>, "costUsd": <number|null>}
- {"type": "update_profile", "fields": {<subset of: name, species, breed, sex ("M"/"F"), color, birthDate, microchipId, spayedNeuteredAt, feedingSchedule, notes, vetClinic, vetPhone, vetAddress>}}

Rules:
- "today"/"yesterday" resolve against the Today date in the project state.
- Convert kg to lb (1 kg = 2.20462 lb) when the owner gives metric weight.
- Never invent data the owner didn't state — no guessed booster due dates,
  vets, or costs; leave those null unless mentioned.
- Only record for statements of fact. Questions, plans, and hypotheticals get
  an answer with no actions.
- One action per record: two shots in one message = two add_vaccination actions.`;

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

async function buildContext(projectId: string, userId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) return "Project not found.";

  const today = new Date();
  const lines: string[] = [];
  lines.push(`Today: ${today.toISOString().slice(0, 10)}`);
  lines.push(`Project: ${project.name}`);
  lines.push(`Kind: ${project.kind}`);
  lines.push(`Created: ${fmtDate(project.createdAt)}`);

  // Kind-specific context
  if (project.kind === "vehicle") {
    const vehicle = await prisma.vehicle.findUnique({
      where: { projectId: project.id },
      include: {
        serviceItems: { orderBy: { position: "asc" } },
        serviceRecords: { orderBy: { performedAt: "desc" }, take: 6 },
        contacts: { orderBy: { position: "asc" } },
      },
    });
    if (vehicle) {
      lines.push("");
      lines.push("=== Vehicle ===");
      lines.push(`${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      if (vehicle.vin) lines.push(`VIN: ${vehicle.vin}`);
      if (vehicle.chassisNumber) lines.push(`Chassis: ${vehicle.chassisNumber}`);
      if (vehicle.bodyStyle) lines.push(`Body: ${vehicle.bodyStyle}`);
      if (vehicle.transmission) lines.push(`Transmission: ${vehicle.transmission}`);
      if (vehicle.exteriorColor) lines.push(`Color: ${vehicle.exteriorColor}`);
      if (vehicle.currentMileage != null) {
        lines.push(`Current odometer: ${vehicle.currentMileage.toLocaleString()} ${vehicle.mileageUnit}`);
      }
      if (vehicle.acquiredAt) {
        lines.push(
          `Acquired ${fmtDate(vehicle.acquiredAt)}${
            vehicle.acquiredPriceUsd
              ? ` for $${vehicle.acquiredPriceUsd.toLocaleString()}`
              : ""
          }${vehicle.acquiredFrom ? ` from ${vehicle.acquiredFrom}` : ""}`
        );
      }

      const overdue: string[] = [];
      const dueSoon: string[] = [];
      for (const item of vehicle.serviceItems) {
        const due = computeDue(item, vehicle.currentMileage, today);
        if (due.status === "overdue") overdue.push(item.name);
        else if (due.status === "due-soon") dueSoon.push(item.name);
      }
      if (overdue.length > 0) lines.push(`Overdue: ${overdue.join(", ")}`);
      if (dueSoon.length > 0) lines.push(`Due soon: ${dueSoon.join(", ")}`);

      if (vehicle.serviceRecords.length > 0) {
        lines.push("Recent service:");
        for (const r of vehicle.serviceRecords) {
          lines.push(
            `  ${fmtDate(r.performedAt)}${r.mileage ? ` @ ${r.mileage.toLocaleString()}` : ""} — ${r.shop ?? "no shop"} — ${r.workSummary.slice(0, 160)}`
          );
        }
      }

      if (vehicle.contacts.length > 0) {
        lines.push("Specialists / contacts:");
        for (const c of vehicle.contacts) {
          lines.push(`  ${c.name}${c.role ? ` (${c.role})` : ""}${c.phone ? ` · ${c.phone}` : ""}`);
        }
      }

      if (vehicle.notes) {
        lines.push("");
        lines.push("=== Owner notes ===");
        lines.push(vehicle.notes.slice(0, 4000));
      }
    }
  } else if (project.kind === "pet") {
    const pet = await prisma.pet.findUnique({
      where: { projectId: project.id },
      include: {
        weights: { orderBy: { measuredAt: "desc" }, take: 8 },
        vaccinations: { orderBy: { administeredAt: "desc" }, take: 8 },
        vetVisits: { orderBy: { performedAt: "desc" }, take: 5 },
      },
    });
    if (pet) {
      lines.push("");
      lines.push("=== Pet ===");
      lines.push(`${pet.name} · ${pet.species}${pet.breed ? ` · ${pet.breed}` : ""}`);
      if (pet.sex) {
        lines.push(
          `Sex: ${pet.sex === "F" ? "female" : "male"}${pet.spayedNeuteredAt ? " (spayed/neutered)" : ""}`
        );
      }
      if (pet.birthDate) {
        const ageMonths =
          (today.getFullYear() - new Date(pet.birthDate).getFullYear()) * 12 +
          (today.getMonth() - new Date(pet.birthDate).getMonth());
        lines.push(`DOB: ${fmtDate(pet.birthDate)} (age ${ageMonths} months)`);
      }
      if (pet.feedingSchedule) lines.push(`Feeding: ${pet.feedingSchedule}`);
      if (pet.weights[0]) {
        lines.push(`Latest weight: ${pet.weights[0].weightLb} lb on ${fmtDate(pet.weights[0].measuredAt)}`);
      }
      if (pet.weights.length > 1) {
        lines.push(
          `Weight history: ${pet.weights
            .slice()
            .reverse()
            .map((w) => `${fmtDate(w.measuredAt)}: ${w.weightLb}lb`)
            .join(", ")}`
        );
      }
      if (pet.vaccinations.length > 0) {
        lines.push("Vaccinations:");
        for (const v of pet.vaccinations) {
          lines.push(
            `  ${v.name} on ${fmtDate(v.administeredAt)}${
              v.boosterDueAt ? ` — booster due ${fmtDate(v.boosterDueAt)}` : ""
            }`
          );
        }
      }
      if (pet.vetVisits.length > 0) {
        lines.push("Vet visits:");
        for (const v of pet.vetVisits) {
          lines.push(`  ${fmtDate(v.performedAt)} — ${v.reason}`);
        }
      }
      if (pet.notes) {
        lines.push("");
        lines.push("=== Owner notes ===");
        lines.push(pet.notes.slice(0, 2000));
      }
    }
  }

  // Todos / Notes / Attachments — applies to every project kind.
  const todos = await prisma.todo.findMany({
    where: { userId, projectId: project.id, completedAt: null },
    include: { list: true },
    orderBy: [{ dueDate: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    take: 50,
  });
  if (todos.length > 0) {
    lines.push("");
    lines.push("=== Open todos ===");
    const byList = new Map<string, typeof todos>();
    for (const t of todos) {
      const arr = byList.get(t.list.name) ?? [];
      arr.push(t);
      byList.set(t.list.name, arr);
    }
    for (const [listName, items] of byList) {
      lines.push(`${listName} (${items.length}):`);
      for (const t of items) {
        const due = t.dueDate ? ` [due ${fmtDate(t.dueDate)}]` : "";
        lines.push(`  - ${t.title}${due}`);
      }
    }
  }

  const notes = await prisma.note.findMany({
    where: { userId, projectId: project.id },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  if (notes.length > 0) {
    lines.push("");
    lines.push("=== Recent notes ===");
    for (const n of notes) {
      lines.push(`# ${n.title || "Untitled"} (updated ${fmtDate(n.updatedAt)})`);
      lines.push(n.body.slice(0, 800));
    }
  }

  const attachments = await prisma.attachment.findMany({
    where: { userId, projectId: project.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (attachments.length > 0) {
    lines.push("");
    lines.push("=== Attachments ===");
    for (const a of attachments) {
      lines.push(`  [${a.kind}] ${a.title} — ${a.url}`);
    }
  }

  return lines.join("\n");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as {
    question?: string;
    history?: ChatTurn[];
  };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  // Pet projects get the read-write chat; everything else stays Q&A-only.
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const pet =
    project.kind === "pet"
      ? await prisma.pet.findUnique({
          where: { projectId: project.id },
          select: { id: true },
        })
      : null;

  const context = await buildContext(id, userId);

  const systemPrompt = `You are a knowledgeable assistant for the owner of this project. You have access to the project's full state below. Answer the owner's questions directly using this data — refer to specific records, dates, mileages, weights, items, etc. Suggest concrete actions when asked. Be concise (under 250 words unless the question requires depth) and use markdown lists/headings when helpful. Don't append boilerplate disclaimers.
${pet ? PET_EDIT_INSTRUCTIONS : ""}
=== PROJECT STATE ===
${context}`;

  const history = Array.isArray(body.history) ? body.history : [];
  const raw = await callClaudeText({
    system: systemPrompt,
    messages: [...history, { role: "user", content: question }],
    maxTokens: 1500,
  });
  if (!raw) {
    return NextResponse.json({ error: "empty response" }, { status: 502 });
  }

  if (!pet) {
    return NextResponse.json({ answer: raw });
  }

  // Lenient parse: pull the JSON object out of the reply; if the model spoke
  // plain text anyway, treat the whole reply as the answer with no actions.
  let answer = raw;
  let applied: string[] = [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as {
        answer?: string;
        actions?: unknown;
      };
      if (typeof parsed.answer === "string" && parsed.answer.trim()) {
        answer = parsed.answer.trim();
      }
      const actions = validatePetActions(parsed.actions);
      if (actions.length > 0) {
        applied = await applyPetActions(userId, pet.id, actions);
      }
    } catch {
      // Not valid JSON — keep the raw reply as the answer.
    }
  }

  return NextResponse.json({ answer, applied });
}
