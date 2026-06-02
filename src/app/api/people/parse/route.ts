import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON } from "@/lib/claude";

export const dynamic = "force-dynamic";

// Shape Claude returns. Mirrors the editable fields in the Person editor so the
// preview cards can bind straight to it. Everything except firstName is
// optional — the model leaves out what the text doesn't mention.
export type ParsedPerson = {
  firstName: string;
  lastName?: string | null;
  strength?: string | null; // "close" | "strong" | "casual" | "weak"
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  city?: string | null;
  country?: string | null;
  howWeMet?: string | null;
  interests?: string[];
  tags?: string[];
  birthday?: string | null; // YYYY-MM-DD
  notes?: string | null;
  socialUrls?: {
    linkedin?: string | null;
    twitter?: string | null;
    instagram?: string | null;
    website?: string | null;
  } | null;
};

const SYSTEM = `You convert free-form notes about people into structured JSON for a personal CRM ("Friends").

The user pastes a brain-dump — could be a few names with context, a list, or a paragraph describing people they met. Extract EVERY distinct person mentioned. Resolve pronouns ("her partner Jon", "his sister") into their own entries when the person is clearly named.

Output ONLY a single JSON object on one line, no prose. Schema:
{
  "people": [
    {
      "firstName": string,                 // required; the given name
      "lastName": string | null,           // surname if stated, else null
      "strength": "close" | "strong" | "casual" | "weak" | null,
                                           // infer ONLY if the text signals closeness
                                           // (e.g. "old friend" -> "close", "met once" -> "weak"); else null
      "email": string | null,
      "phone": string | null,              // keep as written, digits/+ only
      "company": string | null,            // employer / org
      "role": string | null,               // job title or what they do (e.g. "PM", "photographer")
      "city": string | null,               // from any location mentioned
      "country": string | null,            // only if clearly implied
      "howWeMet": string | null,           // the CONTEXT: where/how/when met (e.g. "AI dinner in SF, May 2026")
      "interests": string[],               // hobbies/topics they're into; [] if none
      "tags": string[],                    // short labels worth filtering on (e.g. "founder", "climber"); [] if none
      "birthday": "YYYY-MM-DD" | null,     // only if an actual date is given
      "notes": string | null,              // any leftover detail that doesn't fit a field above
      "socialUrls": { "linkedin"?: string, "twitter"?: string, "instagram"?: string, "website"?: string } | null
    }
  ]
}

Rules:
- firstName is the only required field. Never invent data not supported by the text — use null / [].
- Split a location like "SF" into city "San Francisco"; "Brooklyn" -> city "Brooklyn". Leave country null unless obvious.
- Put the meeting context in howWeMet, not notes. Use notes only for genuine leftovers.
- Do not output duplicates of the same person.
- If the text contains no identifiable person, return { "people": [] }.`;

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  if (text.length > 20000) {
    return NextResponse.json({ error: "text too long (max 20k chars)" }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  let parsed: { people?: ParsedPerson[] };
  try {
    parsed = await callClaudeJSON<{ people?: ParsedPerson[] }>({
      system: SYSTEM,
      user: text,
      // ~150 tokens/person; 4000 comfortably covers a long paste of ~20 people.
      maxTokens: 4000,
    });
  } catch {
    return NextResponse.json({ error: "could not parse model output" }, { status: 502 });
  }

  // Defensively normalize: keep only entries with a usable firstName, coerce
  // array fields, and drop anything malformed rather than trusting the model.
  const people: ParsedPerson[] = Array.isArray(parsed.people)
    ? parsed.people
        .filter((p): p is ParsedPerson => !!p && typeof p.firstName === "string" && p.firstName.trim().length > 0)
        .map((p) => ({
          firstName: p.firstName.trim(),
          lastName: typeof p.lastName === "string" ? p.lastName.trim() || null : null,
          strength: typeof p.strength === "string" ? p.strength : null,
          email: typeof p.email === "string" ? p.email.trim() || null : null,
          phone: typeof p.phone === "string" ? p.phone.trim() || null : null,
          company: typeof p.company === "string" ? p.company.trim() || null : null,
          role: typeof p.role === "string" ? p.role.trim() || null : null,
          city: typeof p.city === "string" ? p.city.trim() || null : null,
          country: typeof p.country === "string" ? p.country.trim() || null : null,
          howWeMet: typeof p.howWeMet === "string" ? p.howWeMet.trim() || null : null,
          interests: Array.isArray(p.interests) ? p.interests.filter((s) => typeof s === "string") : [],
          tags: Array.isArray(p.tags) ? p.tags.filter((s) => typeof s === "string") : [],
          birthday: typeof p.birthday === "string" ? p.birthday : null,
          notes: typeof p.notes === "string" ? p.notes.trim() || null : null,
          socialUrls:
            p.socialUrls && typeof p.socialUrls === "object" ? p.socialUrls : null,
        }))
    : [];

  return NextResponse.json({ people });
}
