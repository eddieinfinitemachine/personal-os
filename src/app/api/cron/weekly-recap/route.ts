import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureJournalProject, isAuthorizedCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not set" },
      { status: 500 }
    );
  }

  const FOUNDER_EMAIL = process.env.FOUNDER_EMAIL ?? "emcohen@me.com";
  const founder = await prisma.user.findUnique({ where: { email: FOUNDER_EMAIL } });
  if (!founder) return NextResponse.json({ error: "founder user missing" }, { status: 500 });
  const userId = founder.id;

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    completedTodos,
    newNotes,
    serviceRecords,
    vetVisits,
    weights,
    vaccinations,
    petPhotos,
    vehiclePhotos,
    newProjects,
  ] = await Promise.all([
    prisma.todo.findMany({
      where: { userId, completedAt: { gte: weekAgo } },
      orderBy: { completedAt: "asc" },
      include: {
        list: { select: { name: true } },
        project: { select: { name: true } },
      },
    }),
    prisma.note.findMany({
      where: { userId, createdAt: { gte: weekAgo } },
      include: { project: { select: { name: true } } },
    }),
    prisma.serviceRecord.findMany({
      where: { userId, performedAt: { gte: weekAgo } },
      include: {
        vehicle: {
          include: { project: { select: { name: true } } },
        },
      },
    }),
    prisma.petVetVisit.findMany({
      where: { userId, performedAt: { gte: weekAgo } },
      include: {
        pet: { include: { project: { select: { name: true } } } },
      },
    }),
    prisma.petWeight.findMany({
      where: { userId, measuredAt: { gte: weekAgo } },
      include: {
        pet: { include: { project: { select: { name: true } } } },
      },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.petVaccination.findMany({
      where: { userId, administeredAt: { gte: weekAgo } },
      include: {
        pet: { include: { project: { select: { name: true } } } },
      },
    }),
    prisma.petPhoto.count({ where: { userId, createdAt: { gte: weekAgo } } }),
    prisma.vehiclePhoto.count({ where: { userId, createdAt: { gte: weekAgo } } }),
    prisma.project.findMany({
      where: { userId, createdAt: { gte: weekAgo }, archived: false },
    }),
  ]);

  const totalActivity =
    completedTodos.length +
    newNotes.length +
    serviceRecords.length +
    vetVisits.length +
    weights.length +
    vaccinations.length +
    petPhotos +
    vehiclePhotos +
    newProjects.length;

  if (totalActivity === 0) {
    return NextResponse.json({ ok: true, skipped: "no activity" });
  }

  const lines: string[] = [];
  lines.push(`Week of ${weekAgo.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`);
  lines.push("");

  if (completedTodos.length) {
    lines.push(`# Completed todos (${completedTodos.length})`);
    for (const t of completedTodos) {
      const proj = t.project?.name ? ` · ${t.project.name}` : "";
      lines.push(`- [${t.list.name}] ${t.title}${proj}`);
    }
    lines.push("");
  }
  if (serviceRecords.length) {
    lines.push(`# Vehicle service`);
    for (const r of serviceRecords) {
      const mi = r.mileage ? ` @ ${r.mileage.toLocaleString()}mi` : "";
      const cost = r.costUsd ? ` · $${r.costUsd}` : "";
      lines.push(
        `- ${r.vehicle.project.name}${mi} — ${r.workSummary}${cost}${r.shop ? ` (${r.shop})` : ""}`
      );
    }
    lines.push("");
  }
  if (vetVisits.length) {
    lines.push(`# Vet visits`);
    for (const v of vetVisits) {
      const cost = v.costUsd ? ` · $${v.costUsd}` : "";
      lines.push(`- ${v.pet.project.name}: ${v.reason}${cost}`);
    }
    lines.push("");
  }
  if (weights.length) {
    lines.push(`# Weight logs`);
    for (const w of weights) {
      lines.push(`- ${w.pet.project.name}: ${w.weightLb} lb`);
    }
    lines.push("");
  }
  if (vaccinations.length) {
    lines.push(`# Vaccinations`);
    for (const v of vaccinations) {
      lines.push(`- ${v.pet.project.name}: ${v.name}`);
    }
    lines.push("");
  }
  if (newNotes.length) {
    lines.push(`# Notes`);
    for (const n of newNotes) {
      lines.push(
        `- [${n.project.name}] ${n.title || "Untitled"}: ${n.body.slice(0, 200)}`
      );
    }
    lines.push("");
  }
  if (newProjects.length) {
    lines.push(`# New projects`);
    for (const p of newProjects) lines.push(`- ${p.name} (${p.kind})`);
    lines.push("");
  }
  if (petPhotos || vehiclePhotos) {
    lines.push(`# Photos: ${petPhotos} pet · ${vehiclePhotos} vehicle`);
  }

  const systemPrompt = `You are writing the user's weekly journal recap. Read the structured activity log below and produce a 3-paragraph narrative recap in first person ("I"). Be specific — reference actual todos, services, visits. Tone: calm, observational, slightly warm. End with one short forward-looking sentence about the coming week. No headings, no bullets. Plain prose. Markdown allowed for emphasis only.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: lines.join("\n") }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: `Claude error (${res.status}): ${err}` },
      { status: 502 }
    );
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const recap = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  if (!recap) return NextResponse.json({ error: "empty recap" }, { status: 502 });

  const project = await ensureJournalProject(userId);
  const weekLabel = `Week of ${weekAgo.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} – ${now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const note = await prisma.note.create({
    data: {
      userId,
      projectId: project.id,
      title: weekLabel,
      body:
        recap +
        "\n\n---\n\n" +
        lines.join("\n"),
    },
  });

  return NextResponse.json({
    ok: true,
    noteId: note.id,
    activity: {
      todos: completedTodos.length,
      notes: newNotes.length,
      serviceRecords: serviceRecords.length,
      vetVisits: vetVisits.length,
      weights: weights.length,
      vaccinations: vaccinations.length,
      petPhotos,
      vehiclePhotos,
      newProjects: newProjects.length,
    },
  });
}
