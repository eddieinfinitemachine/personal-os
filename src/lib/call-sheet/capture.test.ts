import { describe, expect, it, vi } from "vitest";
vi.mock("./extract", () => ({ extractCallSheetCues: vi.fn() }));
import { parseCapture } from "./capture";
const now = new Date("2026-09-28T16:00:00Z");
const valid = {
  type: "person",
  source: "imessage",
  sourceEpoch: "epoch",
  personId: "person",
  identityKey: "a".repeat(64),
  handles: ["+15555550101"],
  capturedAt: now.toISOString(),
  coverageStart: "2025-09-28T16:00:00.000Z",
  lastContactAt: "2026-09-10T00:00:00.000Z",
  messageCount: 1,
  messages: [
    {
      guid: "m",
      sentAt: "2026-09-10T00:00:00.000Z",
      fromMe: false,
      text: "How was the trip?",
    },
  ],
};
describe("capture validation", () => {
  it("accepts bounded exact source context", () =>
    expect(parseCapture(valid, now)).toEqual(valid));
  it("rejects unknown fields and invalid timestamps", () => {
    expect(() => parseCapture({ ...valid, userId: "other" }, now)).toThrow(
      "Unknown field",
    );
    expect(() =>
      parseCapture({ ...valid, capturedAt: "2027-01-01T00:00:00.000Z" }, now),
    ).toThrow("timestamp");
    expect(() => parseCapture({ ...valid, lastContactAt: "bad" }, now)).toThrow(
      "timestamp",
    );
  });
  it("rejects count, size and identifier inconsistencies", () => {
    expect(() => parseCapture({ ...valid, messageCount: 0 }, now)).toThrow();
    expect(() =>
      parseCapture(
        {
          ...valid,
          messages: [...valid.messages, ...valid.messages],
          messageCount: 2,
        },
        now,
      ),
    ).toThrow("Duplicate");
    expect(() =>
      parseCapture(
        {
          ...valid,
          messages: [{ ...valid.messages[0], text: "a".repeat(20001) }],
        },
        now,
      ),
    ).toThrow();
  });
  it("rejects missing handles and non-normalized handles", () => {
    expect(() => parseCapture({ ...valid, handles: [] }, now)).toThrow(
      "handles",
    );
    expect(() =>
      parseCapture({ ...valid, handles: ["555-555-0101"] }, now),
    ).toThrow("normalized");
  });
  it("accepts no-match metadata but forbids transcripts in metadata-only pass", () => {
    expect(
      parseCapture(
        {
          ...valid,
          extract: false,
          handles: [],
          messages: [],
          messageCount: 0,
          lastContactAt: null,
        },
        now,
      ),
    ).toMatchObject({ extract: false });
    expect(() => parseCapture({ ...valid, extract: false }, now)).toThrow(
      "Metadata-only",
    );
  });
});
