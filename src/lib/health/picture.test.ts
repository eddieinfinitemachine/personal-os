import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callClaudeJSON: vi.fn() }));
vi.mock("@/lib/claude", () => {
  class ClaudeAPIError extends Error {
    constructor(
      readonly status: number,
      body: string,
    ) {
      super(`Claude error ${status}: ${body}`);
    }
  }
  return { callClaudeJSON: mocks.callClaudeJSON, ClaudeAPIError };
});

import { ClaudeAPIError } from "@/lib/claude";
import {
  isPictureStale,
  numbersIn,
  parsePictureContent,
  pictureEvidence,
  pictureFailureClass,
  PictureValidationError,
  PICTURE_VERSION,
  readStoredPicture,
  unknownNumbers,
  writeHealthPicture,
  type HealthPicture,
} from "./picture";
import { buildHealthSummary, healthFingerprints, type HealthSummaryInput } from "./summary";

const now = new Date("2030-06-15T12:00:00Z");

const lab = (marker: string, date: string, value: number, notes: string | null = null) => ({
  panel: "Lipids",
  marker,
  drawnAt: new Date(`${date}T00:00:00Z`),
  value,
  unit: "mg/dL",
  refLow: null,
  refHigh: 150,
  flag: null,
  notes,
});

const input = (overrides: Partial<HealthSummaryInput> = {}): HealthSummaryInput => ({
  sex: "M",
  birthDate: new Date("1990-01-01T00:00:00Z"),
  notes: "Goal: keep Marker A under 110.",
  medications: [{ name: "Supplement A", dosage: "2,000–5,000 IU" }],
  conditions: null,
  allergies: null,
  labs: [lab("Marker A", "2028-01-10", 120), lab("Marker A", "2030-01-10", 140.5), lab("Free T3", "2030-01-10", 30)],
  visits: [],
  fitness: [],
  dna: [],
  biometrics: [{ kind: "bpSystolic", measuredAt: new Date("2030-05-01T00:00:00Z"), value: 118, unit: "mmHg" }],
  biometricReadings: 1,
  workouts: [],
  recoveryReadings: [],
  nutrition: [],
  ...overrides,
});

const summary = buildHealthSummary(input(), now);

const reply = (overrides: Record<string, unknown> = {}) => ({
  headline: "Marker A went from 120 to 140.5 and is above your goal of 110.",
  focus: [
    {
      title: "Lower Marker A",
      kind: "established",
      why: "It rose 20.5 between draws, while Supplement A at 2,000–5,000 IU was listed.",
      next: "Retest in 3 months.",
      markers: ["Marker A", "Not A Real Marker"],
    },
  ],
  clear: ["Free T3 looks fine at 30"],
  blindSpots: ["No weight data"],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("numbers", () => {
  it("collects numbers from values and from text, ignoring the digit in a marker name", () => {
    const found = numbersIn({ a: 97, b: "dose 2,000–5,000 IU", c: ["1.70"], d: "T3 and A1c", e: "2030-01-10" });
    expect([...found]).toEqual(expect.arrayContaining([97, 2000, 5000, 1.7, 2030, 1, 10]));
    expect(found.has(3)).toBe(false);
  });

  it("flags a number that isn't in the records", () => {
    expect(unknownNumbers("ApoB rose to 131", new Set([97]))).toEqual(["131"]);
  });

  it("treats 1.70 and 1.7 as the same number", () => {
    expect(unknownNumbers("TSH was 1.70", new Set([1.7]))).toEqual([]);
  });

  it("allows small counts and durations but checks decimals", () => {
    expect(unknownNumbers("Across 3 draws, retest in 6 months", new Set())).toEqual([]);
    expect(unknownNumbers("It measured 5.5", new Set())).toEqual(["5.5"]);
  });

  it("ignores digits inside names", () => {
    expect(unknownNumbers("Check T3, A1c, CoQ10 and vitamin D3", new Set())).toEqual([]);
  });
});

describe("parsePictureContent", () => {
  it("accepts a reply whose numbers all come from the records", () => {
    const content = parsePictureContent(reply(), summary);
    expect(content.focus[0].kind).toBe("established");
  });

  it("accepts a number that comes from a biometric reading", () => {
    expect(() => parsePictureContent(reply({ headline: "Systolic blood pressure was 118." }), summary)).not.toThrow();
  });

  it("drops cited markers that don't exist", () => {
    const content = parsePictureContent(reply(), summary);
    expect(content.focus[0].markers).toEqual(["Marker A"]);
  });

  it("keeps at most four evidence rows per focus area", () => {
    const many = buildHealthSummary(
      input({ labs: ["M1", "M2", "M3", "M4", "M5"].map((marker) => lab(marker, "2030-01-10", 30)) }),
      now,
    );
    const content = parsePictureContent(
      {
        headline: "Steady overall.",
        focus: [{ title: "Watch", kind: "established", why: "Steady.", next: "Retest.", markers: ["M1", "M2", "M3", "M4", "M5"] }],
      },
      many,
    );
    expect(content.focus[0].markers).toEqual(["M1", "M2", "M3", "M4"]);
  });

  it("rejects an invented number and reports it", () => {
    let error: unknown;
    try {
      parsePictureContent(reply({ headline: "Marker A reached 187 last year." }), summary);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PictureValidationError);
    expect((error as PictureValidationError).unknownNumbers).toEqual(["187"]);
  });

  it("checks focus text and lists too", () => {
    const badFocus = reply({
      focus: [{ title: "Lower it", kind: "established", why: "Target under 70.5.", next: "Retest.", markers: [] }],
    });
    expect(() => parsePictureContent(badFocus, summary)).toThrow(PictureValidationError);
    expect(() => parsePictureContent(reply({ clear: ["Marker Z is 444"] }), summary)).toThrow(PictureValidationError);
  });

  it("rejects a malformed reply", () => {
    expect(() => parsePictureContent(null, summary)).toThrow(PictureValidationError);
    expect(() => parsePictureContent(reply({ focus: [] }), summary)).toThrow(PictureValidationError);
    expect(() => parsePictureContent(reply({ headline: " " }), summary)).toThrow(PictureValidationError);
    expect(() =>
      parsePictureContent(reply({ focus: [{ title: "A", kind: "certain", why: "B", next: "C", markers: [] }] }), summary),
    ).toThrow(PictureValidationError);
  });
});

describe("writeHealthPicture", () => {
  it("adds the fingerprint and what it's based on", async () => {
    mocks.callClaudeJSON.mockResolvedValue(reply());
    const picture = await writeHealthPicture(summary, now);
    expect(picture.version).toBe(PICTURE_VERSION);
    expect(picture.generatedAt).toBe(now.toISOString());
    expect(picture.fingerprint).toEqual(healthFingerprints(summary));
    expect(picture.basedOn).toEqual({ draws: 2, latestDraw: "2030-01-10" });
    expect(mocks.callClaudeJSON).toHaveBeenCalledTimes(1);
  });

  it("sends no identity to the model", async () => {
    mocks.callClaudeJSON.mockResolvedValue(reply());
    await writeHealthPicture(summary, now);
    const sent = JSON.stringify(mocks.callClaudeJSON.mock.calls[0][0]);
    expect(sent).not.toContain("1990-01-01");
    expect(sent).toContain('\\"age\\":40');
  });

  it("retries once and tells the model which numbers were wrong", async () => {
    mocks.callClaudeJSON.mockResolvedValueOnce(reply({ headline: "Marker A hit 187." })).mockResolvedValueOnce(reply());
    const picture = await writeHealthPicture(summary, now);
    expect(picture.headline).toContain("140.5");
    expect(mocks.callClaudeJSON).toHaveBeenCalledTimes(2);
    expect(mocks.callClaudeJSON.mock.calls[1][0].user).toContain("187");
  });

  it("gives up after a second bad reply", async () => {
    mocks.callClaudeJSON.mockResolvedValue(reply({ headline: "Marker A hit 187." }));
    await expect(writeHealthPicture(summary, now)).rejects.toBeInstanceOf(PictureValidationError);
    expect(mocks.callClaudeJSON).toHaveBeenCalledTimes(2);
  });

  it("retries an unparseable reply but not an API error", async () => {
    mocks.callClaudeJSON.mockRejectedValueOnce(new Error("model did not return JSON")).mockResolvedValueOnce(reply());
    await expect(writeHealthPicture(summary, now)).resolves.toBeTruthy();
    expect(mocks.callClaudeJSON).toHaveBeenCalledTimes(2);

    mocks.callClaudeJSON.mockReset();
    mocks.callClaudeJSON.mockRejectedValue(new ClaudeAPIError(500, "server error"));
    await expect(writeHealthPicture(summary, now)).rejects.toBeInstanceOf(ClaudeAPIError);
    expect(mocks.callClaudeJSON).toHaveBeenCalledTimes(1);
  });
});

describe("pictureFailureClass", () => {
  it("names the failure without its message", () => {
    expect(pictureFailureClass(new ClaudeAPIError(429, "quoted health data"))).toBe("http_429");
    expect(pictureFailureClass(new PictureValidationError("x", ["187"]))).toBe("validation");
    expect(pictureFailureClass(new SyntaxError("quoted health data"))).toBe("parse");
    expect(pictureFailureClass(new Error("model did not return JSON"))).toBe("parse");
    expect(pictureFailureClass(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("timeout");
    expect(pictureFailureClass(Object.assign(new Error("x"), { name: "PrismaClientKnownRequestError" }))).toBe("storage");
    expect(pictureFailureClass(new Error("quoted health data"))).toBe("unknown");
  });
});

describe("stored pictures", () => {
  const stored = (generatedAt: Date, fingerprint = healthFingerprints(summary)): HealthPicture => ({
    version: PICTURE_VERSION,
    ...parsePictureContent(reply(), summary),
    generatedAt: generatedAt.toISOString(),
    fingerprint,
    basedOn: { draws: 2, latestDraw: "2030-01-10" },
  });
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it("reads only a current, complete picture", () => {
    const picture = stored(now);
    expect(readStoredPicture(picture)).toEqual(picture);
    expect(readStoredPicture(null)).toBeNull();
    expect(readStoredPicture({ headline: "old shape" })).toBeNull();
    expect(readStoredPicture({ ...picture, version: PICTURE_VERSION + 1 })).toBeNull();
  });

  it("is stale with no picture, and after a month", () => {
    expect(isPictureStale(null, summary, now)).toBe(true);
    expect(isPictureStale(stored(daysAgo(29)), summary, now)).toBe(false);
    expect(isPictureStale(stored(daysAgo(30)), summary, now)).toBe(true);
  });

  it("is stale right away when labs or notes change", () => {
    const changed = buildHealthSummary(input({ labs: [...input().labs, lab("Marker B", "2030-05-01", 9)] }), now);
    expect(isPictureStale(stored(daysAgo(1)), changed, now)).toBe(true);
  });

  it("waits a week when only activity changed", () => {
    const moved = buildHealthSummary(
      input({ fitness: [{ performedAt: daysAgo(1), kind: "run", durationMin: 20 }] }),
      now,
    );
    expect(isPictureStale(stored(daysAgo(6)), moved, now)).toBe(false);
    expect(isPictureStale(stored(daysAgo(7)), moved, now)).toBe(true);
  });

  it("supplies current values for the cited markers only", () => {
    const evidence = pictureEvidence(stored(now), summary);
    expect(Object.keys(evidence)).toEqual(["Marker A"]);
    expect(evidence["Marker A"].points.map((p) => p.shown)).toEqual(["120.0", "140.5"]);
    expect(evidence["Marker A"].range).toBe("<150");
  });
});
