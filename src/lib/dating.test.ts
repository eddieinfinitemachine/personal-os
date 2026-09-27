import { describe, expect, it } from "vitest";
import {
  instagramUrl,
  normalizeHandle,
  normalizeInstagram,
  parseHandles,
  parseTranscript,
  pasteExternalId,
  pasteExternalIds,
  threadStats,
  weekStart,
  weeklyVolume,
} from "@/lib/dating";
import { decodeAttributedBody } from "@/lib/imessage-body";

describe("normalizeHandle", () => {
  it.each([
    ["(415) 555-0134", "+14155550134"],
    ["1 415 555 0134", "+14155550134"],
    ["+44 7700 900123", "+447700900123"],
    ["+354 123 4567", "+3541234567"],
    ["Sam@Example.com ", "sam@example.com"],
    ["123", ""],
    ["", ""],
  ])("%s → %s", (raw, want) => expect(normalizeHandle(raw)).toBe(want));

  it("splits and dedupes a free-form field", () => {
    expect(parseHandles("415-555-0134, (415) 555 0134; a@b.co")).toEqual(["+14155550134", "a@b.co"]);
  });
});

describe("normalizeInstagram", () => {
  it.each([
    ["@Jane.Doe", "jane.doe"],
    ["jane_doe99", "jane_doe99"],
    ["  @jane.doe  ", "jane.doe"],
    ["instagram.com/jane.doe", "jane.doe"],
    ["www.instagram.com/jane.doe/", "jane.doe"],
    ["https://www.instagram.com/Jane.Doe/?igsh=MWx3ZGQ5eXBmOWR4", "jane.doe"],
    ["http://instagram.com/jane.doe#top", "jane.doe"],
    ["https://m.instagram.com/jane.doe", "jane.doe"],
    ["https://instagr.am/jane.doe", "jane.doe"],
    ["https://www.instagram.com/stories/jane.doe/3141592653/", "jane.doe"],
    ["a".repeat(30), "a".repeat(30)],
  ])("%s → %s", (raw, want) => expect(normalizeInstagram(raw)).toBe(want));

  it.each([
    [""],
    ["   "],
    ["@"],
    ["jane doe"],
    ["jane-doe"],
    ["jäne"],
    ["a".repeat(31)],
    [".jane"],
    ["jane."],
    ["jane..doe"],
    ["https://www.instagram.com/"],
    ["https://www.instagram.com/p/C8xYz12AbCd/"],
    ["https://www.instagram.com/reel/C8xYz12AbCd/"],
    ["https://twitter.com/jane"],
    ["https://evil.com/instagram.com/jane"],
  ])("rejects %j", (raw) => expect(normalizeInstagram(raw)).toBeNull());

  it("rejects non-strings", () => {
    expect(normalizeInstagram(null)).toBeNull();
    expect(normalizeInstagram(42)).toBeNull();
  });

  it("builds the profile url", () => {
    expect(instagramUrl("jane.doe")).toBe("https://instagram.com/jane.doe");
  });
});

describe("parseTranscript", () => {
  it("parses WhatsApp iOS exports with 12h times", () => {
    const raw = [
      "[1/2/24, 9:41:03 PM] Sam: hey you",
      "[1/2/24, 9:42:10 PM] Eddie: hi!",
      "second line",
      "[1/3/24, 12:05:00 AM] Sam: <Media omitted>",
    ].join("\n");
    const out = parseTranscript(raw, { theirName: "Sam" });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ fromMe: false, text: "hey you" });
    expect(out[0].sentAt).toEqual(new Date(2024, 0, 2, 21, 41, 3));
    expect(out[1]).toMatchObject({ fromMe: true, text: "hi!\nsecond line" });
  });

  it("parses WhatsApp Android exports with 24h times", () => {
    const out = parseTranscript("2/1/24, 21:41 - Sam Lee: dinner?\n2/1/24, 21:45 - Me: yes", {});
    expect(out.map((m) => m.fromMe)).toEqual([false, true]);
    expect(out[0].sentAt.getHours()).toBe(21);
  });

  it("uses myName and keeps order for plain lines", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    const out = parseTranscript("Alex: hi\nEddie: hello\nAlex: see you", { myName: "eddie", fallbackStart: start });
    expect(out.map((m) => m.fromMe)).toEqual([false, true, false]);
    expect(out[2].sentAt.getTime() - out[0].sentAt.getTime()).toBe(2000);
  });

  it("does not treat a URL as a sender", () => {
    const out = parseTranscript("Me: look\nhttps://example.com/x", {});
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("look\nhttps://example.com/x");
  });

  it("hashes identically for identical messages", async () => {
    const m = { sentAt: new Date(0), fromMe: true, text: "hi" };
    expect(await pasteExternalId(m, "p1")).toBe(await pasteExternalId({ ...m }, "p1"));
    expect(await pasteExternalId(m, "p1")).not.toBe(await pasteExternalId(m, "p2"));
  });

  it("dedupes undated re-pastes across import dates without losing repeated lines", async () => {
    const raw = "Ana: hello\nMe: hi\nAna: hello";
    const first = parseTranscript(raw, { fallbackStart: new Date("2026-09-01T12:00:00Z") });
    const later = parseTranscript(raw.replaceAll("\n", "\r\n"), { fallbackStart: new Date("2026-09-26T12:00:00Z") });
    const ids = await pasteExternalIds(first, "p1");
    expect(ids).toEqual(await pasteExternalIds(later, "p1"));
    expect(new Set(ids).size).toBe(3);
    expect(first[0].sentAt).not.toEqual(later[0].sentAt);
    expect(ids).not.toEqual(await pasteExternalIds(first, "p2"));
  });

  it("keeps dated paste IDs compatible and actual timestamps intact", async () => {
    const parsed = parseTranscript("[1/2/24, 9:41:03 PM] Ana: hello\nMe: hi");
    const ids = await pasteExternalIds(parsed, "p1");
    expect(ids[0]).toBe(await pasteExternalId(parsed[0], "p1"));
    expect(parsed[0].sentAt).toEqual(new Date(2024, 0, 2, 21, 41, 3));
  });

  it("does not merge common undated replies from different transcripts", async () => {
    const one = await pasteExternalIds(parseTranscript("Ana: dinner?\nMe: yes"), "p1");
    const two = await pasteExternalIds(parseTranscript("Ana: coffee?\nMe: yes"), "p1");
    expect(one[1]).not.toBe(two[1]);
  });
});

describe("threadStats", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 0, 1) + h * 3_600_000);
  it("counts initiations and median reply times", () => {
    const s = threadStats([
      { sentAt: at(0), fromMe: true },
      { sentAt: at(0.5), fromMe: false }, // they reply in 30 min
      { sentAt: at(1), fromMe: true }, // I reply in 30 min
      { sentAt: at(20), fromMe: false }, // new convo, they start
      { sentAt: at(20.1), fromMe: true }, // I reply in 6 min
    ]);
    expect(s).toMatchObject({ total: 5, mine: 3, theirs: 2, conversations: 2, iInitiate: 0.5 });
    expect(s.theirReplyMin).toBe(30);
    expect(s.myReplyMin).toBeCloseTo(18);
    expect(s.lastFromMe).toBe(true);
  });

  it("handles an empty thread", () => {
    expect(threadStats([])).toMatchObject({ total: 0, iInitiate: null, lastAt: null });
  });
});

describe("weeklyVolume", () => {
  it("fills empty weeks with zeros", () => {
    const w1 = weekStart(new Date(2026, 0, 7));
    const w3 = new Date(w1);
    w3.setDate(w3.getDate() + 15);
    const out = weeklyVolume(
      [
        { sentAt: w1, fromMe: true },
        { sentAt: w1, fromMe: false },
        { sentAt: w3, fromMe: false },
      ],
      w3,
    );
    expect(out.map((b) => [b.mine, b.theirs])).toEqual([
      [1, 1],
      [0, 0],
      [0, 1],
    ]);
  });
});

describe("decodeAttributedBody", () => {
  const body = (text: string) => {
    const t = Buffer.from(text, "utf8");
    const len =
      t.length < 0x81
        ? Buffer.from([t.length])
        : Buffer.concat([Buffer.from([0x81]), Buffer.from([t.length & 0xff, t.length >> 8])]);
    return Buffer.concat([
      Buffer.from("\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+", "latin1"),
      len,
      t,
      Buffer.from("\x86\x84\x02iI", "latin1"),
    ]);
  };

  it("reads short and long strings", () => {
    expect(decodeAttributedBody(body("see you at 8 ❤️"))).toBe("see you at 8 ❤️");
    const long = "x".repeat(300);
    expect(decodeAttributedBody(body(long))).toBe(long);
  });

  it("returns null for garbage", () => {
    expect(decodeAttributedBody(Buffer.from("nothing here"))).toBeNull();
    expect(decodeAttributedBody(null)).toBeNull();
  });
});
