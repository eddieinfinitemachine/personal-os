import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isPrivateHost } from "@/lib/hosts";
import { getPersonalRecord } from "@/lib/personal-record";
import { callClaudeText } from "@/lib/claude";

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Defense in depth: only serve on the private host. The DB lookup below
  // would already 404 for any user without a PersonalRecord, but a tenant
  // who manually creates one shouldn't get astrology either on public.
  if (!isPrivateHost(request.headers.get("host"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const record = await getPersonalRecord(prisma, userId);
  if (!record) {
    return NextResponse.json({ error: "no personal record" }, { status: 404 });
  }

  const prompt = `Generate a fun, vivid, and accurate astrological natal chart reading for:

Name: ${record.fullName}
Birth date: ${record.birth.date}
Birth time: ${record.birth.time} ${record.birth.hourMarker} (${record.birth.timezone})
Birth place: ${record.birth.city} (${record.birth.hospital}, ${record.birth.borough})

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

  const note = await callClaudeText({ user: prompt, maxTokens: 1500 });
  return NextResponse.json({ note });
}
