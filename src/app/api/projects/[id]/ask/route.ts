import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeText } from "@/lib/claude";
import { buildProjectContext } from "@/lib/project-context";
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

  const context = await buildProjectContext(id, userId);

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
