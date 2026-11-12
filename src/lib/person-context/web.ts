import { callClaudeWithServerTools, type ClaudeResponseBlock } from "@/lib/claude";
import type { PersonContext } from "./types";

export const PERSON_CONTEXT_MODEL = "claude-sonnet-5-5";

const SYSTEM = `You look up public, professional context about one person for a private contact book.
Search the web for the exact name together with the company (and city when given).

Many people share a name. A page is about this person only when the page itself ties the name to the company given (or, when no company is given, to the given role and city). A page that matches the name alone, or the name with a different employer, is a different person: do not use it, and do not report a "previous role" from it. If the only pages you find are about someone at another company, the answer is {"confident": false}.

Never use people-search, lead or contact-data sites (ZoomInfo, RocketReach, Apollo, SignalHire, ContactOut, Lusha, Spokeo, Whitepages and the like) as a source. Use the person's own site, their employer's site, a professional profile, or reputable press.

Write what is known, not where you read it (no "a profile lists…"). Never guess, never include home addresses, contact details, family members, health, or anything private.
Reply with ONLY a JSON object:
{"confident": true, "matched": "company", "text": "at most 3 plain sentences of public/professional context", "sources": [{"title": "page title", "url": "https://..."}]}
"matched" says what on the page ties it to this person: "company" (the page names the given company) or "role" (it names the given role and city).
Or {"confident": false} when nothing reliable was found.`;

/**
 * People-search and contact-data sites: they merge namesakes and sell contact
 * details, so a page there is never evidence about the person in the book.
 */
const AGGREGATORS = [
  "zoominfo.com", "rocketreach.co", "apollo.io", "signalhire.com", "contactout.com", "lusha.com", "datanyze.com", "leadiq.com",
  "seamless.ai", "peopledatalabs.com", "clay.com", "spokeo.com", "whitepages.com", "beenverified.com", "radaris.com", "intelius.com",
  "truepeoplesearch.com", "fastpeoplesearch.com", "peekyou.com", "mylife.com", "pipl.com", "thatsthem.com", "idcrawl.com", "nuwber.com",
  "clustrmaps.com", "usphonebook.com", "emailsherlock.com", "hunter.io", "anymailfinder.com",
];
export function isAggregator(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AGGREGATORS.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return true;
  }
}

type PublicContext = NonNullable<PersonContext["publicContext"]>;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null;
}

function httpsUrl(v: unknown): string | null {
  const raw = str(v, 2000);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Parse the final answer; only keep sources the search actually returned. */
export function parsePublicContext(content: ClaudeResponseBlock[]): PublicContext | undefined {
  let from = 0;
  const seen = new Set<string>();
  content.forEach((b, i) => {
    if (b.type !== "web_search_tool_result") return;
    from = i + 1;
    if (Array.isArray(b.content))
      for (const r of b.content as { url?: unknown }[]) {
        const url = httpsUrl(r?.url);
        if (url) seen.add(url);
      }
  });
  const text = content
    .slice(from)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  const data = JSON.parse(text.slice(start, end + 1)) as { confident?: unknown; matched?: unknown; text?: unknown; sources?: unknown };
  const summary = str(data.text, 600);
  if (data.confident !== true || !summary) return undefined;
  // A name alone is not this person: the page has to tie it to what the book knows.
  if (data.matched !== "company" && data.matched !== "role") return undefined;
  const sources: PublicContext["sources"] = [];
  for (const s of Array.isArray(data.sources) ? data.sources : []) {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const url = httpsUrl(o.url);
    if (!url || !seen.has(url) || isAggregator(url) || sources.some((x) => x.url === url)) continue;
    sources.push({ title: str(o.title, 200) ?? new URL(url).hostname, url });
    if (sources.length >= 5) break;
  }
  // Uncited public claims are not worth showing.
  return sources.length ? { text: summary, sources } : undefined;
}

/**
 * Public/professional context from web search. Queries only name + company
 * (+ city). Never searches without a company or role. Throws on API failure;
 * the caller decides that is non-fatal.
 */
export async function searchPublicContext(
  person: { fullName: string; company?: string | null; role?: string | null; city?: string | null },
  { timeoutMs }: { timeoutMs: number },
): Promise<PublicContext | undefined> {
  const company = person.company?.trim();
  const role = person.role?.trim();
  if (!company && !role) return undefined;
  const fullName = person.fullName.trim();
  if (!fullName) return undefined;
  const user = [
    `Name: ${fullName}`,
    company && `Company: ${company}`,
    role && `Role (for disambiguation only, do not search it): ${role}`,
    person.city?.trim() && `City: ${person.city.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
  const { content, stopReason } = await callClaudeWithServerTools({
    system: SYSTEM,
    user,
    model: PERSON_CONTEXT_MODEL,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    maxTokens: 4000,
    effort: "low",
    timeoutMs,
  });
  if (stopReason === "refusal" || stopReason === "max_tokens" || stopReason === "pause_turn") return undefined;
  return parsePublicContext(content);
}
