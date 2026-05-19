import { NextResponse } from "next/server";
import { PERSONAL } from "@/lib/personal";
import { getCurrentUserId } from "@/lib/auth";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const prompt = `Generate a fun, vivid, and accurate astrological natal chart reading for:

Name: ${PERSONAL.fullName}
Birth date: ${PERSONAL.birth.date}
Birth time: ${PERSONAL.birth.time} ${PERSONAL.birth.hourMarker} (${PERSONAL.birth.timezone})
Birth place: ${PERSONAL.birth.city} (${PERSONAL.birth.hospital}, ${PERSONAL.birth.borough})

Use traditional Western astrology with the tropical zodiac and Placidus houses.

Compute and report:
- Sun sign + degree
- Moon sign + degree
- Rising sign (Ascendant) + degree
- Mercury, Venus, Mars, Jupiter, Saturn signs
- Dominant element & modality
- Notable aspects (1-3 punchy ones)

Then write a 4-6 sentence personality read that is grounded, specific, and fun — not generic horoscope filler. Mention concrete tendencies (how he handles work, relationships, decision-making) tied to actual chart placements.

Format as Markdown:
## Chart
| Body | Sign | |
[bulleted or table — your choice]

## What it means
<paragraph>

Be confident with the calculations. Do not include disclaimers about astrology.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Claude error (${res.status}): ${err}` }, { status: 502 });
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const note = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  return NextResponse.json({ note });
}
