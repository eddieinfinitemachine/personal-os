// Sent Gmail threads as /projects evidence: threads I wrote in during the last
// 14 days, from the account behind GOOGLE_REFRESH_TOKEN. Headers and snippets
// only (format=metadata); a message body is never requested.

import { getThreadMeta, listThreads, type GmailThreadMeta } from "@/lib/google";
import type { Gate } from "./gate";
import { otherDomains } from "./meetings";
import type { SignalItem } from "./types";

export const GMAIL_QUERY = "in:sent newer_than:14d -in:chats";
export const MAX_THREADS = 100;
const CONCURRENCY = 5;
const RETRIES_429 = 3;

/** Calendar RSVP and invitation mail: "Accepted: …", "Invitation: …", "Updated invitation: …". */
const RSVP_SUBJECT =
  /^(accepted|declined|tentatively accepted|tentative|invitation|updated invitation|canceled event|cancelled event|new event)\b[^:]*:/i;

const ADDRESS = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[a-z]{2,}/gi;

/** Every address in a header value ("Name <a@b.com>, c@d.com"), lowercased. */
export function addressesIn(value: string | null | undefined): string[] {
  return (value?.match(ADDRESS) ?? []).map((a) => a.toLowerCase());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export type GmailDeps = {
  listThreads: typeof listThreads;
  getThreadMeta: typeof getThreadMeta;
  sleep: (ms: number) => Promise<void>;
};

const defaultDeps: GmailDeps = {
  listThreads,
  getThreadMeta,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** Retries a 429 with exponential backoff (1 s, 2 s, 4 s), then gives up. */
async function withBackoff<T>(fn: () => Promise<T>, sleep: GmailDeps["sleep"]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if ((e as { status?: number }).status !== 429 || attempt >= RETRIES_429) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** `fn` over `items`, at most `limit` at a time, results in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type EmailsResult = {
  items: SignalItem[];
  threads: number;
  rsvp: number;
  selfOnly: number;
};

/** One thread → an evidence item, or why it was dropped. */
export function threadItem(
  thread: GmailThreadMeta,
  opts: { mine: Set<string>; account: string },
): SignalItem | "rsvp" | "self-only" | null {
  const messages = [...thread.messages].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  if (!messages.length) return null;
  const header = (m: (typeof messages)[number], name: string) =>
    m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  const subject = header(messages[0], "Subject").trim();
  if (RSVP_SUBJECT.test(subject)) return "rsvp";

  const everyone = new Set(messages.flatMap((m) => ["From", "To", "Cc"].flatMap((h) => addressesIn(header(m, h)))));
  const others = [...everyone].filter((a) => !opts.mine.has(a));
  if (!others.length) return "self-only";

  const sentFrom = [...messages].reverse().map((m) => addressesIn(header(m, "From"))[0]).find((a) => a && opts.mine.has(a));
  const last = messages[messages.length - 1];
  return {
    ref: `gmail:${thread.id}`,
    kind: "email",
    title: subject || "(no subject)",
    at: new Date(Number(last.internalDate ?? 0)).toISOString(),
    url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(opts.account)}#all/${encodeURIComponent(thread.id)}`,
    detail: last.snippet ? decodeEntities(last.snippet) : null,
    domains: otherDomains(others, opts.mine),
    from: sentFrom ?? null,
  };
}

export async function collectEmails(opts: {
  mine: Set<string>;
  account: string;
  gate: Gate;
  deps?: Partial<GmailDeps>;
}): Promise<EmailsResult> {
  const deps = { ...defaultDeps, ...opts.deps };
  const listed = await withBackoff(() => deps.listThreads(GMAIL_QUERY, MAX_THREADS), deps.sleep);
  const threads = await mapLimit(listed, CONCURRENCY, (t) => withBackoff(() => deps.getThreadMeta(t.id), deps.sleep));

  const result: EmailsResult = { items: [], threads: threads.length, rsvp: 0, selfOnly: 0 };
  for (const thread of threads) {
    const item = threadItem(thread, opts);
    if (item === "rsvp") result.rsvp++;
    else if (item === "self-only") result.selfOnly++;
    else if (item) {
      // The gate sees every snippet in the thread, not just the one shown.
      const snippets = thread.messages.map((m) => (m.snippet ? decodeEntities(m.snippet) : "")).join("\n");
      const emails = [...new Set(thread.messages.flatMap((m) => (m.payload?.headers ?? []).flatMap((h) => addressesIn(h.value))))];
      if (opts.gate.excludes({ title: item.title, text: snippets, emails: emails.filter((e) => !opts.mine.has(e)) })) continue;
      result.items.push(item);
    }
  }
  return result;
}
