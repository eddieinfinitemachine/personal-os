import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/claude", () => ({ callClaudeJSON: vi.fn() }));
import {
  MAX_CARDS,
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
const idsFor = (items: SignalItem[]) => buildPrompt(items, []).ids;

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
    const p = buildPrompt(items, [prev("launch", ["gmail:b", "gone:zzz"], { state: "hidden" })]);
    expect([...p.ids.keys()]).toEqual(["m1", "e1", "t1", "n1"]);
    expect(p.user).toContain("m1 | UPCOMING");
    expect(p.user).toContain("| recurring");
    expect(p.user).toContain("t1 | 2026-10-26 | done | Title todo:c | project: Launch");
    expect(p.user).toContain("- launch | launch | Olto | hidden | - | - | e1");
  });

  it("stays under the budget, taking turns between kinds, newest first", () => {
    const items = [
      ...Array.from({ length: 50 }, (_, i) => item(`gmail:${i}`, { at: ago(i / 10), detail: "x".repeat(200) })),
      ...Array.from({ length: 5 }, (_, i) => item(`todo:${i}`, { at: ago(i) })),
    ];
    const p = buildPrompt(items, [], 12_000);
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
  const v = (projects: unknown[], previous: PreviousProject[] = [], isSensitive?: (t: string) => boolean) =>
    validateProjects({ projects }, { ids, previous, now: NOW, isSensitive });

  it("throws on a reply without a projects array", () => {
    expect(() => validateProjects({ nope: 1 }, { ids, previous: [], now: NOW })).toThrow(/projects/);
  });

  it("maps ids to evidence, drops unknown ids, clips text, defaults company", () => {
    const [p] = v([{ name: "  Big   launch ", company: "Acme", status: "s".repeat(300), next: "", evidence: ["e1", "zz9", "m1", "e1"] }]);
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

  it("rejects a card whose only evidence is one recurring series", () => {
    expect(v([{ name: "Weekly sync", evidence: ["m2", "m3"] }])).toEqual([]);
    expect(v([{ key: "w", name: "W", evidence: ["m2"] }], [prev("w", [])])).toEqual([]);
    expect(v([{ name: "Real work", evidence: ["m2", "e1"] }])).toHaveLength(1);
  });

  it("drops sensitive cards and cards whose text trips the gate", () => {
    const gate = (t: string) => /therapy/i.test(t);
    expect(v([{ name: "Private", sensitive: true, evidence: ["e1", "e2"] }])).toEqual([]);
    expect(v([{ name: "Therapy search", evidence: ["e1", "e2"] }], [], gate)).toEqual([]);
    expect(v([{ name: "Fine", next: "Book therapy", evidence: ["e1", "e2"] }], [], gate)).toEqual([]);
    expect(v([{ name: "Fine", evidence: ["e1", "e2"] }], [], gate)).toHaveLength(1);
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

  it("caps shown cards at 12, keeping pinned ones and every hidden one", () => {
    const many = Array.from({ length: 30 }, (_, i) => item(`gmail:x${i}`, { at: ago(i / 10) }));
    const manyIds = idsFor(many);
    const projects = Array.from({ length: 15 }, (_, i) => ({ name: `P${i}`, evidence: [`e${2 * i + 1}`, `e${2 * i + 2}`] }));
    projects.push({ key: "pinned-old", name: "Pinned", evidence: ["e30"] } as never);
    projects.push({ key: "hidden-one", name: "Hidden", evidence: ["e29"] } as never);
    const out = validateProjects(
      { projects },
      {
        ids: manyIds,
        previous: [prev("pinned-old", [], { state: "pinned" }), prev("hidden-one", [], { state: "hidden" })],
        now: NOW,
      },
    );
    expect(out.filter((p) => p.key !== "hidden-one")).toHaveLength(MAX_CARDS);
    expect(out.map((p) => p.key)).toContain("pinned-old");
    expect(out.map((p) => p.key)).toContain("hidden-one");
    // The oldest auto cards are the ones dropped.
    expect(out.map((p) => p.key)).not.toContain("p14");
    expect(out.map((p) => p.key)).toContain("p0");
  });
});

describe("inferProjects", () => {
  it("doesn't call Claude without evidence", async () => {
    const claude = vi.fn();
    expect(await inferProjects({ items: [], previous: [], now: NOW, claude })).toEqual({ projects: [], omitted: 0 });
    expect(claude).not.toHaveBeenCalled();
  });

  it("sends one bounded call and validates the reply", async () => {
    const claude = vi.fn().mockResolvedValue({ projects: [{ name: "Launch", company: "Olto", evidence: ["e1", "m1"] }] });
    const { projects } = await inferProjects({ items: [item("gmail:1"), item("gcal:2")], previous: [], now: NOW, claude });
    expect(projects.map((p) => [p.key, p.company])).toEqual([["launch", "Olto"]]);
    expect(claude).toHaveBeenCalledOnce();
    expect(claude.mock.calls[0][0]).toMatchObject({ maxTokens: 8000, timeoutMs: 150_000 });
  });
});
