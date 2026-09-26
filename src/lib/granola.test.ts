import { describe, expect, it, vi } from "vitest";
import {
  GranolaError,
  createGranolaClient,
  granolaNoteText,
  isTherapyTitle,
  namesToMatch,
  selectMeeting,
  type GranolaNote,
} from "@/lib/granola";

const names = namesToMatch([{ name: "Ana Lopez" }, { name: "Katherine" }]);

describe("selectMeeting", () => {
  it("takes therapy sessions by title (Block is therapy), trimmed and any case", () => {
    expect(isTherapyTitle("  therapy ")).toBe(true);
    expect(isTherapyTitle("BLOCK")).toBe(true);
    expect(isTherapyTitle("Therapy prep")).toBe(false);
    expect(isTherapyTitle("Blocker review")).toBe(false);
    expect(isTherapyTitle(null)).toBe(false);
    expect(selectMeeting({ title: "Block" }, [])).toEqual({ candidate: true, reason: "therapy" });
  });

  it("matches people on /dating by full or first name, whole words only", () => {
    expect(names).toEqual(["Ana Lopez", "Ana", "Katherine"]);
    expect(selectMeeting({ title: "Catch-up", summary: "Talked about ana and the trip" }, names).candidate).toBe(true);
    expect(selectMeeting({ title: "Sync", notes: "ANA LOPEZ called" }, names).reason).toBe("mentions ANA LOPEZ");
    expect(selectMeeting({ title: "Banana budget", summary: "Analytics review, Katherines" }, names).candidate).toBe(false);
  });

  it("matches dating words on word boundaries", () => {
    for (const s of ["Went on a first date", "my ex texted", "Hinge match", "the relationship", "a crush", "Raya"]) {
      expect(selectMeeting({ summary: s }, []).candidate, s).toBe(true);
    }
    for (const s of ["Please update the doc", "exec review", "next quarter", "validated", "Rayan joined"]) {
      expect(selectMeeting({ summary: s }, []).candidate, s).toBe(false);
    }
    expect(selectMeeting({ title: "Weekly GTM", summary: "Pipeline", notes: null }, names)).toEqual({
      candidate: false,
      reason: null,
    });
  });
});

function note(over: Partial<GranolaNote> = {}): GranolaNote {
  return {
    id: "not_aaaaaaaaaaaaaa",
    object: "note",
    title: "Therapy",
    owner: { name: "Eddie", email: "eddie@example.com" },
    created_at: "2026-09-20T15:00:00Z",
    updated_at: "2026-09-20T16:00:00Z",
    web_url: "https://notes.granola.ai/d/abc",
    calendar_event: null,
    attendees: [],
    summary_text: "plain summary",
    summary_markdown: "## Summary\nTalked about Ana.",
    private_notes_text: "my plain notes",
    private_notes_markdown: "- Ana was late",
    transcript: [
      { speaker: { source: "microphone", attribution: "me" }, text: "I saw Ana." },
      { speaker: { source: "speaker", attribution: "them" }, text: "How was it?" },
      { speaker: { source: "microphone", diarization_label: "Speaker B" }, text: "Good." },
      { speaker: { source: "speaker", name: "Dr. Kim" }, text: "Say more." },
      { speaker: { source: "speaker" }, text: "  " },
    ],
    ...over,
  };
}

describe("granolaNoteText", () => {
  it("puts my notes, the summary, then the labelled transcript", () => {
    expect(granolaNoteText(note(), 10_000)).toBe(
      [
        "My notes:\n- Ana was late",
        "Summary:\n## Summary\nTalked about Ana.",
        "Transcript:\nMe: I saw Ana.\nThem: How was it?\nSpeaker B: Good.\nDr. Kim: Say more.",
      ].join("\n\n"),
    );
  });

  it("falls back to plain text fields and skips empty sections", () => {
    const t = granolaNoteText(
      note({ private_notes_markdown: null, private_notes_text: null, summary_markdown: null, transcript: null }),
      10_000,
    );
    expect(t).toBe("Summary:\nplain summary");
  });

  it("caps to the budget, keeping notes and summary before the transcript", () => {
    const long = note({ transcript: [{ speaker: { source: "speaker" }, text: "x".repeat(5000) }] });
    const head = granolaNoteText(note({ transcript: null }), 10_000);
    const t = granolaNoteText(long, head.length + 100);
    expect(t.length).toBe(head.length + 100);
    expect(t.startsWith(head + "\n\nTranscript:\n")).toBe(true);

    const tiny = granolaNoteText(long, 20);
    expect(tiny).toBe("My notes:\n- Ana was ");
  });
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const summary = (id: string, created: string) => ({
  id,
  object: "note",
  title: id,
  owner: { name: null, email: "e@x.com" },
  created_at: created,
  updated_at: created,
});

describe("createGranolaClient", () => {
  const sleep = vi.fn(async () => {});

  it("lists every page with created_after, page_size and cursor, and the bearer key", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer grn_test");
      const cursor = new URL(url).searchParams.get("cursor");
      if (!cursor) return json({ notes: [summary("not_1", "2026-01-02T00:00:00Z")], hasMore: true, cursor: "c2" });
      if (cursor === "c2") return json({ notes: [summary("not_2", "2026-01-03T00:00:00Z")], hasMore: true, cursor: "c3" });
      return json({ notes: [summary("not_3", "2026-01-04T00:00:00Z")], hasMore: false, cursor: null });
    });
    const client = createGranolaClient({ apiKey: "grn_test", baseUrl: "https://g.test/v1", fetch, sleep, minIntervalMs: 0 });
    const notes = await client.listNotes({ createdAfter: new Date("2026-01-01T00:00:00Z") });
    expect(notes.map((n) => n.id)).toEqual(["not_1", "not_2", "not_3"]);
    expect(calls).toHaveLength(3);
    const first = new URL(calls[0]);
    expect(first.pathname).toBe("/v1/notes");
    expect(first.searchParams.get("created_after")).toBe("2026-01-01T00:00:00.000Z");
    expect(first.searchParams.get("page_size")).toBe("30");
    expect(new URL(calls[2]).searchParams.get("cursor")).toBe("c3");
  });

  it("gets a note with include=transcript, paging the transcript on 413", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("/transcript")) {
        return u.searchParams.get("cursor")
          ? json({ transcript: [{ speaker: { source: "speaker" }, text: "two" }], hasMore: false, cursor: null })
          : json({ transcript: [{ speaker: { source: "speaker" }, text: "one" }], hasMore: true, cursor: "t2" });
      }
      if (u.searchParams.get("include") === "transcript") return json({ code: "TRANSCRIPT_TOO_LARGE" }, 413);
      return json(note({ transcript: null }));
    });
    const client = createGranolaClient({ apiKey: "k", baseUrl: "https://g.test/v1", fetch, sleep, minIntervalMs: 0 });
    const n = await client.getNote("not_aaaaaaaaaaaaaa", { transcript: true });
    expect(n.transcript?.map((t) => t.text)).toEqual(["one", "two"]);
    expect(calls.map((c) => new URL(c).pathname + new URL(c).search)).toEqual([
      "/v1/notes/not_aaaaaaaaaaaaaa?include=transcript",
      "/v1/notes/not_aaaaaaaaaaaaaa",
      "/v1/notes/not_aaaaaaaaaaaaaa/transcript?page_size=100",
      "/v1/notes/not_aaaaaaaaaaaaaa/transcript?page_size=100&cursor=t2",
    ]);
  });

  it("gets a note without the transcript param when not asked", async () => {
    const fetch = vi.fn(async (_url: string) => json(note()));
    const client = createGranolaClient({ apiKey: "k", baseUrl: "https://g.test/v1", fetch, sleep, minIntervalMs: 0 });
    await client.getNote("not_aaaaaaaaaaaaaa");
    expect(new URL(fetch.mock.calls[0][0] as string).search).toBe("");
  });

  it("explains 401 and 403 without retrying", async () => {
    for (const [status, text] of [
      [401, "rejected GRANOLA_API_KEY"],
      [403, "Personal notes scope"],
    ] as const) {
      const fetch = vi.fn(async () => json({ error: "no" }, status));
      const client = createGranolaClient({ apiKey: "k", fetch, sleep, minIntervalMs: 0 });
      const err = await client.listNotes({ createdAfter: new Date() }).catch((e) => e);
      expect(err).toBeInstanceOf(GranolaError);
      expect(err.status).toBe(status);
      expect(err.message).toContain(text);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("retries a 429 (honouring Retry-After) then gives a clear error", async () => {
    sleep.mockClear();
    let n = 0;
    const fetch = vi.fn(async () => (++n === 1 ? json({}, 429, { "retry-after": "3" }) : json(note())));
    const client = createGranolaClient({ apiKey: "k", fetch, sleep, minIntervalMs: 0 });
    await expect(client.getNote("not_aaaaaaaaaaaaaa")).resolves.toMatchObject({ id: "not_aaaaaaaaaaaaaa" });
    expect(sleep).toHaveBeenCalledWith(3000);

    const always = vi.fn(async () => json({}, 429));
    const c2 = createGranolaClient({ apiKey: "k", fetch: always, sleep, minIntervalMs: 0, retries429: 2 });
    const err = await c2.getNote("not_aaaaaaaaaaaaaa").catch((e) => e);
    expect(err).toBeInstanceOf(GranolaError);
    expect(err.status).toBe(429);
    expect(err.message).toContain("rate limit");
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("spaces requests out to stay under 5 per second", async () => {
    const waits: number[] = [];
    const fetch = vi.fn(async () => json({ notes: [], hasMore: false, cursor: null }));
    const client = createGranolaClient({
      apiKey: "k",
      fetch,
      minIntervalMs: 220,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await Promise.all([1, 2, 3].map(() => client.listNotes({ createdAfter: new Date() })));
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(200);
    expect(waits[1]).toBeGreaterThan(420);
  });
});
