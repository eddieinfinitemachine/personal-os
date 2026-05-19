import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet || pet.userId !== userId) {
    return NextResponse.json({ error: "pet not found" }, { status: 404 });
  }

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const dob = pet.birthDate ? new Date(pet.birthDate) : null;
  const ageMonths = dob
    ? (today.getFullYear() - dob.getFullYear()) * 12 +
      (today.getMonth() - dob.getMonth())
    : null;

  const sexLabel =
    pet.sex === "F"
      ? pet.spayedNeuteredAt
        ? "spayed female"
        : "intact female"
      : pet.sex === "M"
        ? pet.spayedNeuteredAt
          ? "neutered male"
          : "intact male"
        : "";

  const profile = [
    `Name: ${pet.name}`,
    `Species: ${pet.species}`,
    pet.breed ? `Breed: ${pet.breed}` : null,
    sexLabel ? `Sex: ${sexLabel}` : null,
    dob ? `Date of birth: ${dob.toISOString().slice(0, 10)}` : null,
    ageMonths !== null ? `Age: ${ageMonths} months (${(ageMonths / 12).toFixed(1)} years)` : null,
    pet.spayedNeuteredAt
      ? `Spayed/neutered on: ${new Date(pet.spayedNeuteredAt).toISOString().slice(0, 10)}`
      : null,
    pet.feedingSchedule ? `Feeding: ${pet.feedingSchedule}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are a knowledgeable, practical advisor to pet owners. Today is ${todayIso}.

Given a pet's profile, write a tight, breed-aware briefing on what the owner should expect at this exact life stage AND in the coming 1–6 months. Cover the things that genuinely matter for this breed/species at this age — growth, behavior, training/socialization windows, health screenings to schedule, vaccinations / boosters typically due, dietary changes, weight expectations, and breed-specific risks or needs. Be specific to the breed (e.g. coat care for long-haired breeds, dilated cardiomyopathy screening for at-risk breeds, joint health for large breeds).

Output strict markdown with these sections, in this order:
## Right now
3-5 short bullets on what's happening at this age. Be concrete.

## Coming up (next 1–6 months)
3-5 short bullets on what to anticipate / schedule. Include specific timeframes ("around month X", "by 12 months").

## Breed-specific notes
2-4 bullets that are SPECIFIC to this breed. If the breed is unknown, write a short note about that and skip the bullets.

## Watch for
2-4 bullets on early warning signs or things to flag at the vet for this age + breed.

Keep total length under 350 words. Use tight, declarative prose. Do not hedge with "consult your vet" on every line; trust the reader.`;

  const userPrompt = `Pet profile:\n${profile}\n\nWrite the briefing now.`;

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
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Claude error (${res.status}): ${err}` }, { status: 502 });
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const note = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  if (!note) {
    return NextResponse.json({ error: "empty response" }, { status: 502 });
  }

  const updated = await prisma.pet.update({
    where: { id },
    data: { lifeStageNote: note, lifeStageNoteAt: new Date() },
  });

  return NextResponse.json({
    note: updated.lifeStageNote,
    noteAt: updated.lifeStageNoteAt,
  });
}
