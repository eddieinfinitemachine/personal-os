// Deterministic person-list routing. No AI: a capture that starts with
// "@shane " files to the list named "EC/Shane" (or exactly "shane"), title
// kept verbatim minus the token. Triage uses the same alias table to offer
// one-key filing when a known name appears anywhere in a title.

export type AliasTarget = { alias: string; listId: string; listName: string };

/** "@shane follow up on container email" → { token: "shane", rest: "follow up on container email" } */
export function parseAliasToken(
  text: string
): { token: string; rest: string } | null {
  const m = text.trim().match(/^@([\p{L}\d_-]+)\s+(\S[\s\S]*)$/u);
  if (!m) return null;
  return { token: m[1].toLowerCase(), rest: m[2].trim() };
}

/** Build the alias table from list names: "EC/Shane" → alias "shane". */
export function aliasTargetsFromLists(
  lists: { id: string; name: string }[]
): AliasTarget[] {
  const out: AliasTarget[] = [];
  for (const l of lists) {
    const m = l.name.match(/^EC\/(.+)$/i);
    if (!m) continue;
    out.push({ alias: m[1].trim().toLowerCase(), listId: l.id, listName: l.name });
  }
  return out;
}

/** First alias appearing as a whole word in the title (case-insensitive). */
export function detectAliasInTitle(
  title: string,
  targets: AliasTarget[]
): AliasTarget | null {
  const lower = title.toLowerCase();
  for (const t of targets) {
    const re = new RegExp(`(^|[^\\p{L}\\d])${escapeRe(t.alias)}([^\\p{L}\\d]|$)`, "u");
    if (re.test(lower)) return t;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
