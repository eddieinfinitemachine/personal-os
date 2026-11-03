import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/claude", () => ({ callClaudeJSON: vi.fn() }));
import {
  MAX_CARDS,
  MAX_STEPS,
  buildPrompt,
  evidenceHash,
  inferProjects,
  shouldSkip,
  slugify,
  validateProjects,
  type PreviousProject,
} from "./infer";
import type { SignalItem } from "./signals/types";

const NOW = new Date("2026-10-27T18:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86400_000).toISOString();

const item = (ref: string, over: Partial<SignalItem> = {}): SignalItem => ({
  ref,
  kind: ref.startsWith("gmail:") ? "email" : ref.startsWith("todo:") ? "todo" : ref.startsWith("note:") ? "note" : "meeting",
  title: `Title ${ref}`,
  at: ago(1),
  url: `https://example.invalid/${ref}`,
  ...over,
});

const prev = (key: string, refs: string[], over: Partial<PreviousProject> = {}): PreviousProject => ({
  key,
  name: key,
  company: "Olto",
  status: null,
  next: null,
  state: "auto",
  refs,
  ...over,
});

/** ids m1, m2, e1… for the given items, as buildPrompt assigns them. */
const idsFor = (items: SignalItem[]) => buildPrompt(items, [], NOW).ids;

describe("slugify / hash / skip", () => {
  it("slugifies names", () => {
    expect(slugify("Product — Launch!")).toBe("product-launch");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
  });

  it("hashes refs and timestamps, order-insensitive", () => {
    const a = [item("gmail:1"), item("gcal:2")];
    expect(evidenceHash(a)).toBe(evidenceHash([...a].reverse()));
    expect(evidenceHash(a)).not.toBe(evidenceHash([item("gmail:1"), item("gcal:2", { at: ago(2) })]));
  });

  it("skips only an unchanged hash with a success under a day old", () => {
    expect(shouldSkip({ hash: "h", lastSuccessAt: ago(0.5) }, "h", NOW)).toBe(true);
    expect(shouldSkip({ hash: "h", lastSuccessAt: ago(1.1) }, "h", NOW)).toBe(false);
    expect(shouldSkip({ hash: "x", lastSuccessAt: ago(0.1) }, "h", NOW)).toBe(false);
    expect(shouldSkip(null, "h", NOW)).toBe(false);
  });
});

describe("buildPrompt", () => {
  it("numbers items per kind, marks upcoming and recurring, lists previous projects with their ids", () => {
    const items = [
      item("gcal:a", { upcoming: true, at: ago(-2), series: "s1" }),
      item("gmail:b", { from: "me@im.example", domains: ["acme.example"] }),
      item("todo:c", { done: true, project: "Launch" }),
      item("note:d"),
    ];
    const p = buildPrompt(items, [prev("launch", ["gmail:b", "gone:zzz"], { state: "hidden" })], NOW);
    expect([...p.ids.keys()]).toEqual(["m1", "e1", "t1", "n1"]);
    expect(p.user).toContain("m1 | UPCOMING");
    expect(p.user).toContain("| recurring");
    expect(p.user).toContain("t1 | CLOSED 2026-10-26 | Title todo:c | project: Launch");
    expect(p.user).toContain("- launch | launch | Olto | hidden | - | - | e1");
  });

  it("gives Claude today and the coming dates, in New York time", () => {
    // 01:00 UTC on the 28th is still the evening of the 27th in New York.
    const p = buildPrompt([item("gmail:1")], [], new Date("2026-10-28T01:00:00Z"));
    expect(p.user).toContain("Today is tuesday 2026-10-27. Coming dates: wed 2026-10-28, thu 2026-10-29,");
  });

  it("shows a todo's written date, so a relative deadline counts from the right day", () => {
    const p = buildPrompt(
      [item("todo:a", { title: "Decide by Sunday night", writtenAt: ago(5), at: ago(1), done: true }), item("todo:b", { writtenAt: ago(2) })],
      [],
      NOW,
    );
    expect(p.user).toContain("written 2026-10-22 | CLOSED 2026-10-26 | Decide by Sunday night");
    expect(p.user).toContain("written 2026-10-25 | OPEN | Title todo:b");
  });

  it("shows thread length and last sender, and keeps both ends of a long note", () => {
    const note = `${"a".repeat(1000)} MIDDLE ${"z".repeat(1500)} Follow up Friday`;
    const p = buildPrompt(
      [item("gmail:1", { threadCount: 24, lastFrom: "me", detail: "Ok thanks" }), item("gcal:2", { detail: note })],
      [],
      NOW,
    );
    expect(p.user).toContain("24 messages, last from me | Ok thanks");
    expect(p.user).toContain("Follow up Friday");
    expect(p.user).toContain(" … ");
    expect(p.user).not.toContain("MIDDLE");
  });

  it("stays under the budget, taking turns between kinds, newest first", () => {
    const items = [
      ...Array.from({ length: 50 }, (_, i) => item(`gmail:${i}`, { at: ago(i / 10), detail: "x".repeat(200) })),
      ...Array.from({ length: 5 }, (_, i) => item(`todo:${i}`, { at: ago(i) })),
    ];
    const p = buildPrompt(items, [], NOW, 12_000);
    expect(p.user.length).toBeLessThan(12_000);
    expect(p.omitted).toBeGreaterThan(0);
    expect(p.ids.get("e1")!.ref).toBe("gmail:0");
    // Todos still made it in despite the email flood.
    expect([...p.ids.values()].filter((i) => i.kind === "todo")).toHaveLength(5);
  });
});

describe("validateProjects", () => {
  const items = [
    item("gmail:1"),
    item("gmail:2", { at: ago(3) }),
    item("gcal:3", { upcoming: true, at: ago(-1) }),
    item("gcal:w1", { series: "weekly" }),
    item("gcal:w2", { series: "weekly", at: ago(8) }),
    item("todo:4"),
  ];
  const ids = idsFor(items); // m1 gcal:3, m2 gcal:w1, m3 gcal:w2, e1 gmail:1, e2 gmail:2, t1 todo:4
  const full = (projects: unknown[], previous: PreviousProject[] = [], isSensitive?: (t: string) => boolean) =>
    validateProjects({ projects }, { ids, previous, now: NOW, isSensitive });
  const v = (projects: unknown[], previous: PreviousProject[] = [], isSensitive?: (t: string) => boolean) =>
    full(projects, previous, isSensitive).projects;

  it("throws on a reply without a projects array", () => {
    expect(() => validateProjects({ nope: 1 }, { ids, previous: [], now: NOW })).toThrow(/projects/);
  });

  it("maps ids to evidence, drops unknown ids, clips text, defaults company", () => {
    const [p] = v([{ name: "  Big   launch ", company: "Acme", status: "s".repeat(300), steps: [], evidence: ["e1", "zz9", "m1", "e1"] }]);
    expect(p.key).toBe("big-launch");
    expect(p.company).toBe("Personal");
    expect(p.status!.length).toBeLessThanOrEqual(160);
    expect(p.next).toBeNull();
    // Newest first (the upcoming meeting is later than the email); lastActivityAt is the newest past one.
    expect(p.evidence.map((e) => e.ref)).toEqual(["gcal:3", "gmail:1"]);
    expect(p.evidence[1]).toEqual({ ref: "gmail:1", kind: "email", title: "Title gmail:1", at: ago(1), url: "https://example.invalid/gmail:1" });
    expect(p.lastActivityAt).toBe(ago(1));
  });

  it("needs two pieces of evidence for a new project, one for an existing one", () => {
    expect(v([{ name: "New thing", evidence: ["e1"] }])).toEqual([]);
    expect(v([{ key: "kept", name: "Kept", evidence: ["e1"] }], [prev("kept", [])]).map((p) => p.key)).toEqual(["kept"]);
  });

  it("takes a single thread of three or more messages as enough for a new project", () => {
    const threads = [item("gmail:short", { threadCount: 2 }), item("gmail:long", { threadCount: 24 })];
    const threadIds = idsFor(threads);
    const run = (id: string) => validateProjects({ projects: [{ name: "Order", evidence: [id] }] }, { ids: threadIds, previous: [], now: NOW }).projects;
    expect(run("e1")).toEqual([]);
    expect(run("e2").map((p) => p.key)).toEqual(["order"]);
  });

  it("reads steps and problem; next is the first step", () => {
    const [p] = v([
      {
        name: "Order",
        problem: "Deposit stuck",
        steps: [
          { text: "Fix the payment", due: "2026-10-30", who: "Eddie", waiting: false },
          { text: "Confirm fabric", due: "soon", who: "Vendor", waiting: true },
          { text: "", due: null },
          "junk",
        ],
        evidence: ["e1", "e2"],
      },
    ]);
    expect(p.problem).toBe("Deposit stuck");
    expect(p.next).toBe("Fix the payment");
    expect(p.steps).toEqual([
      { text: "Fix the payment", due: "2026-10-30", who: "Eddie", waiting: false },
      { text: "Confirm fabric", due: null, who: "Vendor", waiting: true },
    ]);
  });

  it(`keeps at most ${MAX_STEPS} steps`, () => {
    const steps = Array.from({ length: MAX_STEPS + 2 }, (_, i) => ({ text: `Step ${i}` }));
    expect(v([{ name: "Order", steps, evidence: ["e1", "e2"] }])[0].steps).toHaveLength(MAX_STEPS);
  });

  it("only counts as waiting when someone other than Eddie has the next move", () => {
    const [p] = v([
      {
        name: "Order",
        steps: [
          { text: "A", who: "Eddie", waiting: true },
          { text: "B", who: null, waiting: true },
          { text: "C", who: "Vendor", waiting: true },
        ],
        evidence: ["e1", "e2"],
      },
    ]);
    expect(p.steps.map((s) => s.waiting)).toEqual([false, false, true]);
  });

  it("clears a due date that contradicts a weekday in the step", () => {
    // 2026-10-28 is a Wednesday.
    const [p] = v([
      {
        name: "Hire",
        steps: [
          { text: "Interview on Wednesday", due: "2026-10-28" },
          { text: "Interview on Thursday", due: "2026-10-28" },
          { text: "Send the offer", due: "2026-10-28" },
        ],
        evidence: ["e1", "e2"],
      },
    ]);
    expect(p.steps.map((s) => s.due)).toEqual(["2026-10-28", null, "2026-10-28"]);
  });

  it("drops an undated step that copies a closed todo, but keeps a dated one and unrelated ones", () => {
    const closed = [item("todo:a", { title: "Fund the deposit this week", done: true }), item("todo:b", { title: "Interview the candidate on Wednesday", done: true }), item("gmail:1")];
    const closedIds = idsFor(closed);
    const { projects } = validateProjects(
      {
        projects: [
          {
            name: "Order",
            steps: [
              { text: "Fund deposit this week" },
              { text: "Interview the candidate on Wednesday", due: "2026-10-28" },
              { text: "Review the new factory terms" },
            ],
            evidence: ["t1", "t2", "e1"],
          },
        ],
      },
      { ids: closedIds, previous: [], now: NOW },
    );
    expect(projects[0].steps.map((s) => s.text)).toEqual(["Interview the candidate on Wednesday", "Review the new factory terms"]);
  });

  it("does not treat an open todo as closed", () => {
    const open = [item("todo:a", { title: "Fund the deposit this week" }), item("gmail:1")];
    const { projects } = validateProjects(
      { projects: [{ name: "Order", steps: [{ text: "Fund deposit this week" }], evidence: ["t1", "e1"] }] },
      { ids: idsFor(open), previous: [], now: NOW },
    );
    expect(projects[0].steps).toHaveLength(1);
  });

  it("gate-checks every step and who, removing only what is flagged", () => {
    const gate = (t: string) => /therapy|jordan/i.test(t);
    const [p] = v(
      [
        {
          name: "Fine",
          status: "All good",
          steps: [{ text: "Book therapy" }, { text: "Send the deck", who: "Jordan", waiting: true }, { text: "Review" }],
          evidence: ["e1", "e2"],
        },
      ],
      [],
      gate,
    );
    expect(p.steps).toEqual([
      { text: "Send the deck", due: null, who: null, waiting: false },
      { text: "Review", due: null, who: null, waiting: false },
    ]);
    expect(p.next).toBe("Send the deck");
  });

  it("rejects a card whose only evidence is one recurring series", () => {
    expect(v([{ name: "Weekly sync", evidence: ["m2", "m3"] }])).toEqual([]);
    expect(v([{ key: "w", name: "W", evidence: ["m2"] }], [prev("w", [])])).toEqual([]);
    expect(v([{ name: "Real work", evidence: ["m2", "e1"] }])).toHaveLength(1);
  });

  it("drops sensitive cards and cards whose text trips the gate", () => {
    const gate = (t: string) => /therapy/i.test(t);
    expect(v([{ name: "Private", sensitive: true, evidence: ["e1", "e2"] }])).toEqual([]);
    expect(v([{ name: "Therapy search", evidence: ["e1", "e2"] }], [], gate)).toEqual([]);
    expect(v([{ name: "Fine", problem: "Therapy bill late", evidence: ["e1", "e2"] }], [], gate)).toEqual([]);
    expect(v([{ name: "Fine", evidence: ["e1", "e2"] }], [], gate)).toHaveLength(1);
  });

  it("reports previous cards flagged as private so the store can remove them", () => {
    const gate = (t: string) => /therapy/i.test(t);
    const previous = [prev("a", ["gmail:1"]), prev("b", ["gmail:2"]), prev("c", ["todo:4"])];
    const res = full(
      [
        { key: "a", name: "A", sensitive: true, evidence: ["e1"] },
        // No key stated: found through its evidence.
        { name: "Therapy costs", evidence: ["e2"] },
        { key: "c", name: "C", evidence: ["t1"] },
      ],
      previous,
      gate,
    );
    expect(res.projects.map((p) => p.key)).toEqual(["c"]);
    expect(res.rejectedKeys.sort()).toEqual(["a", "b"]);
  });

  it("a stated key beats a smaller card matched on shared evidence, whatever the order", () => {
    const previous = [prev("big", ["gmail:1", "gmail:2", "todo:4"], { state: "pinned" })];
    const out = v(
      [
        // Listed first, with no key, and sharing one ref with the big card.
        { name: "Small thing", evidence: ["e1", "m1"] },
        { key: "big", name: "Big project", evidence: ["e1", "e2", "t1"] },
      ],
      previous,
    );
    expect(out.find((p) => p.name === "Big project")!.key).toBe("big");
    expect(out.find((p) => p.name === "Small thing")!.key).toBe("small-thing");
  });

  it("carries a key over from the previous card sharing half the evidence", () => {
    const previous = [prev("erp", ["gmail:1", "gmail:2", "todo:old"]), prev("other", ["todo:4"])];
    // No key, renamed: shares 2 of 3 with erp.
    expect(v([{ name: "Inventory system move", evidence: ["e1", "e2", "t1"] }], previous)[0].key).toBe("erp");
    // Unknown key: same rule.
    expect(v([{ key: "made-up", name: "X", evidence: ["e1", "m1"] }], previous)[0].key).toBe("erp");
    // Less than half shared: a new key.
    expect(v([{ name: "Fresh", evidence: ["e1", "m1", "m2", "t1"] }], [prev("erp", ["gmail:1"])])[0].key).toBe("fresh");
  });

  it("keeps a previous key by name, and suffixes slugs that collide", () => {
    expect(v([{ name: "ERP", evidence: ["m1"] }], [prev("erp", ["gone:1"])])[0].key).toBe("erp");
    const out = v(
      [
        { name: "Launch", evidence: ["e1", "e2"] },
        { name: "Launch", evidence: ["m1", "t1"] },
      ],
      [prev("launch-2", ["gone:1"], { state: "pinned" })],
    );
    // "launch" is free; the second can't take "launch" (taken) or "launch-2" (an existing card).
    expect(out.map((p) => p.key)).toEqual(["launch", "launch-3"]);
  });

  it("an explicit key is used once", () => {
    const out = v(
      [
        { key: "a", name: "A", evidence: ["e1"] },
        { key: "a", name: "A again", evidence: ["e2", "t1"] },
      ],
      [prev("a", [])],
    );
    expect(out.map((p) => p.key)).toEqual(["a", "a-again"]);
  });

  it("keeps a finished project closed: same key, no steps, not counted against the cap", () => {
    const previous = [prev("done", ["gmail:1"], { state: "finished" })];
    const [p] = v([{ key: "done", name: "Done", steps: [{ text: "Do more" }], evidence: ["e1"] }], previous);
    expect(p.key).toBe("done");
    expect(p.steps).toEqual([]);
    expect(p.next).toBeNull();

    // Fresh evidence under a new name still lands on the finished card.
    const [renamed] = v([{ name: "Done again", evidence: ["e1"] }], previous);
    expect(renamed.key).toBe("done");

    const many = Array.from({ length: 2 * MAX_CARDS + 2 }, (_, i) => item(`gmail:x${i}`, { at: ago(i / 100) }));
    const projects: unknown[] = Array.from({ length: MAX_CARDS }, (_, i) => ({ name: `P${i}`, evidence: [`e${2 * i + 1}`, `e${2 * i + 2}`] }));
    projects.push({ key: "closed", name: "Closed", evidence: [`e${2 * MAX_CARDS + 1}`] });
    const out = validateProjects({ projects }, { ids: idsFor(many), previous: [prev("closed", [], { state: "finished" })], now: NOW }).projects;
    expect(out).toHaveLength(MAX_CARDS + 1);
    expect(out.map((x) => x.key)).toContain("closed");
  });

  it("caps shown cards, keeping pinned ones and every hidden one", () => {
    const extra = 5;
    const count = MAX_CARDS + extra;
    const many = Array.from({ length: 2 * count + 2 }, (_, i) => item(`gmail:x${i}`, { at: ago(i / 100) }));
    const manyIds = idsFor(many);
    const projects: unknown[] = Array.from({ length: count }, (_, i) => ({ name: `P${i}`, evidence: [`e${2 * i + 1}`, `e${2 * i + 2}`] }));
    projects.push({ key: "pinned-old", name: "Pinned", evidence: [`e${2 * count + 2}`] });
    projects.push({ key: "hidden-one", name: "Hidden", evidence: [`e${2 * count + 1}`] });
    const out = validateProjects(
      { projects },
      {
        ids: manyIds,
        previous: [prev("pinned-old", [], { state: "pinned" }), prev("hidden-one", [], { state: "hidden" })],
        now: NOW,
      },
    ).projects;
    expect(out.filter((p) => p.key !== "hidden-one")).toHaveLength(MAX_CARDS);
    expect(out.map((p) => p.key)).toContain("pinned-old");
    expect(out.map((p) => p.key)).toContain("hidden-one");
    // The oldest auto cards are the ones dropped.
    expect(out.map((p) => p.key)).not.toContain(`p${count - 1}`);
    expect(out.map((p) => p.key)).toContain("p0");
  });
});

describe("inferProjects", () => {
  it("doesn't call Claude without evidence", async () => {
    const claude = vi.fn();
    expect(await inferProjects({ items: [], previous: [], now: NOW, claude })).toEqual({ projects: [], rejectedKeys: [], omitted: 0 });
    expect(claude).not.toHaveBeenCalled();
  });

  it("sends one bounded call and validates the reply", async () => {
    const claude = vi.fn().mockResolvedValue({ projects: [{ name: "Launch", company: "Olto", evidence: ["e1", "m1"] }] });
    const { projects } = await inferProjects({ items: [item("gmail:1"), item("gcal:2")], previous: [], now: NOW, claude });
    expect(projects.map((p) => [p.key, p.company])).toEqual([["launch", "Olto"]]);
    expect(claude).toHaveBeenCalledOnce();
    expect(claude.mock.calls[0][0]).toMatchObject({ maxTokens: 16_000, timeoutMs: 150_000 });
  });
});
