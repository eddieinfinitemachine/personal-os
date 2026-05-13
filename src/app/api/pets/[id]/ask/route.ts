import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) return NextResponse.json({ error: "pet not found" }, { status: 404 });

  const today = new Date();
  const dob = pet.birthDate ? new Date(pet.birthDate) : null;
  const ageMonths = dob
    ? (today.getFullYear() - dob.getFullYear()) * 12 +
      (today.getMonth() - dob.getMonth())
    : null;

  const profileLines = [
    `Name: ${pet.name}`,
    `Species: ${pet.species}`,
    pet.breed ? `Breed: ${pet.breed}` : null,
    pet.sex
      ? `Sex: ${pet.sex === "F" ? "female" : "male"}${pet.spayedNeuteredAt ? " (spayed/neutered)" : ""}`
      : null,
    ageMonths !== null
      ? `Age: ${ageMonths} months (${(ageMonths / 12).toFixed(1)} years)`
      : null,
    pet.feedingSchedule ? `Feeding: ${pet.feedingSchedule}` : null,
  ].filter(Boolean);

  const systemPrompt = `You are a knowledgeable, practical advisor to pet owners. The owner is asking about their specific pet. Use the profile below to ground answers — refer to the breed and age. Be concise (under 200 words) and direct. Use markdown for short lists when helpful. Don't append filler like "consult your vet" on every line — only add that line when the question genuinely warrants veterinary judgement.

Pet profile:
${profileLines.join("\n")}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Claude error (${res.status}): ${err}` }, { status: 502 });
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const answer = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  if (!answer) {
    return NextResponse.json({ error: "empty response" }, { status: 502 });
  }

  return NextResponse.json({ answer });
}
