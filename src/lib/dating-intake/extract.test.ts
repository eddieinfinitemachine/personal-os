import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { ClaudeAPIError } from "@/lib/claude";
import { IntakeError, type Envelope } from "./contracts";
import {
  classifyFailure,
  failureMessage,
  SYSTEM,
  validateExtraction,
} from "./extract";

const text =
  "Second date with Alex Rivera on 2026-09-01; we held hands on the walk home.";
const env = { text, title: "Journal", identities: [] } as unknown as Envelope;
const good = (extra = {}) => ({
  name: "Alex Rivera",
  summary: "Second date with Alex",
  quote: text,
  eventDate: null,
  ...extra,
});

describe("validateExtraction", () => {
  it("drops unprovable mentions instead of failing the segment", () => {
    const kept = validateExtraction(
      {
        mentions: [
          good({ quote: "a paraphrase that is not in the source" }),
          good({ name: "Sam Lee" }),
          "not an object",
          good(),
        ],
      },
      env,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: "Alex Rivera", quote: text });
  });

  it("caps at 12 mentions rather than rejecting a 13th", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      good({ quote: text.slice(i, i + 40) }),
    );
    expect(validateExtraction({ mentions: many }, env)).toHaveLength(12);
  });

  it("keeps one mention per name and quote even when dates differ", () => {
    const kept = validateExtraction(
      {
        mentions: [
          good({ eventDate: "2026-09-01" }),
          good({ name: "alex rivera", eventDate: null }),
        ],
      },
      env,
    );
    expect(kept).toEqual([expect.objectContaining({ eventDate: "2026-09-01" })]);
  });

  it("keeps only the correspondent from a direct conversation", () => {
    const thread = {
      text: `2026-09-27T00:00:00Z +15551234567: ${text}`,
      title: "+15551234567",
      identities: ["+15551234567"],
    } as unknown as Envelope;
    const kept = validateExtraction(
      {
        mentions: [
          good({ correspondent: false }),
          good({ name: "+15551234567", correspondent: true }),
        ],
      },
      thread,
    );
    expect(kept).toEqual([
      expect.objectContaining({ name: "+15551234567", correspondent: true }),
    ]);
    expect(
      validateExtraction({ mentions: [good({ correspondent: false })] }, thread),
    ).toEqual([]);
    // Journals keep the people they discuss.
    expect(
      validateExtraction({ mentions: [good({ correspondent: false })] }, env),
    ).toHaveLength(1);
  });

  it("tells the model a direct thread is only about the correspondent", () => {
    expect(SYSTEM).toMatch(/directConversation is true/);
    expect(SYSTEM).toMatch(/Never report people the two of them talk about/);
  });

  it("still fails a reply without a mentions array", () => {
    expect(() => validateExtraction({ people: [] }, env)).toThrow(IntakeError);
  });
});

describe("classifyFailure", () => {
  const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  it.each([
    [new ClaudeAPIError(401, "x"), false, { kind: "config", status: 401 }],
    [new ClaudeAPIError(404, "x"), false, { kind: "config", status: 404 }],
    [new ClaudeAPIError(529, "x"), false, { kind: "provider", status: 529 }],
    [new Error("ANTHROPIC_API_KEY not set"), false, { kind: "config" }],
    [timeout, true, { kind: "budget" }],
    [timeout, false, { kind: "timeout" }],
    [new SyntaxError("Unexpected end of JSON input"), false, { kind: "invalid" }],
    [new Error("model did not return JSON"), false, { kind: "invalid" }],
    [new Error("Transaction already closed"), false, { kind: "storage" }],
  ])("%s → %j", (error, budgetLimited, expected) => {
    expect(classifyFailure(error, budgetLimited)).toEqual(expected);
  });

  it("explains configuration problems specifically and never echoes provider bodies", () => {
    const message = failureMessage({ kind: "config", status: 401 });
    expect(message).toMatch(/HTTP 401/);
    expect(message).toMatch(/ANTHROPIC_API_KEY/);
    expect(failureMessage({ kind: "config" })).toMatch(/not set/);
    expect(failureMessage({ kind: "timeout" })).toBe(
      "Some evidence could not be analyzed. It will retry automatically.",
    );
  });
});
