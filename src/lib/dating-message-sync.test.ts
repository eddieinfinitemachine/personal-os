import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appleDate,
  captureSource,
  coreDataDate,
  mapIMessageRow,
  mapWhatsAppRow,
  matchWhatsAppSessions,
  summaryLine,
  toAppleNs,
  toCoreDataSeconds,
  whatsappJidPhone,
} from "./dating-message-sync";
import {
  dbStatus,
  iMessageHandleIndex,
  readIMessages,
  readWhatsAppMessages,
  snapshotDb,
  whatsAppSchemaProblems,
  whatsAppSessions,
} from "./dating-message-readers";
import { normalizeHandle } from "./dating";

describe("whatsappJidPhone", () => {
  it("maps a 1:1 JID to the same E.164 handle normalizeHandle produces", () => {
    expect(whatsappJidPhone("15551234567@s.whatsapp.net")).toBe("+15551234567");
    expect(whatsappJidPhone("15551234567@s.whatsapp.net")).toBe(normalizeHandle("(555) 123-4567"));
    expect(whatsappJidPhone("447700900123@s.whatsapp.net")).toBe(normalizeHandle("+44 7700 900123"));
    expect(whatsappJidPhone(" 15551234567:12@S.WhatsApp.net ")).toBe("+15551234567");
  });

  it("rejects groups, broadcasts, status, @lid ids and junk", () => {
    for (const jid of [
      "120363025246125486@g.us",
      "15551234567-1600000000@g.us",
      "status@broadcast",
      "1600000000@broadcast",
      "123456789012345@lid",
      "120363000000000000@newsletter",
      "abc@s.whatsapp.net",
      "123@s.whatsapp.net",
      "",
      null,
      undefined,
    ]) {
      expect(whatsappJidPhone(jid)).toBeNull();
    }
  });
});

describe("matchWhatsAppSessions", () => {
  const sessions = [
    { pk: 1, jid: "15551234567@s.whatsapp.net", type: 0 },
    { pk: 2, jid: "120363025246125486@g.us", type: 1 },
    { pk: 3, jid: "status@broadcast", type: 0 },
    { pk: 4, jid: "15551234567@lid", type: 0 },
    { pk: 5, jid: "15559999999@s.whatsapp.net", type: 0 },
    { pk: 6, jid: "15551234567@s.whatsapp.net", type: 1 }, // not 1:1 by type
    { pk: 7, jid: "15551234567@s.whatsapp.net", type: null }, // older rows without a type
  ];
  it("keeps only 1:1 sessions whose phone is one of the person's handles", () => {
    expect(matchWhatsAppSessions(sessions, ["+15551234567", "ana@example.com"])).toEqual([1, 7]);
    expect(matchWhatsAppSessions(sessions, ["+15550000000"])).toEqual([]);
    expect(matchWhatsAppSessions(sessions, [])).toEqual([]);
  });
});

describe("dates", () => {
  it("converts Core Data seconds since 2001", () => {
    expect(coreDataDate(0).toISOString()).toBe("2001-01-01T00:00:00.000Z");
    expect(coreDataDate(780000000.5).toISOString()).toBe("2025-09-19T18:40:00.500Z");
    expect(toCoreDataSeconds("2025-09-19T18:40:00.500Z")).toBe(780000000.5);
  });
  it("converts iMessage seconds and nanoseconds", () => {
    expect(appleDate(780000000).toISOString()).toBe("2025-09-19T18:40:00.000Z");
    expect(appleDate(780000000 * 1e9).toISOString()).toBe("2025-09-19T18:40:00.000Z");
    expect(toAppleNs("2025-09-19T18:40:00.000Z")).toBe(780000000 * 1e9);
  });
});

describe("mapWhatsAppRow", () => {
  const row = { stanza: "3EB0ABC", date: 780000000, from_me: 1, text: "  see you at 8 ", type: 0 };
  it("maps a text message", () => {
    expect(mapWhatsAppRow(row)).toEqual({
      guid: "wa:3EB0ABC",
      sentAt: "2025-09-19T18:40:00.000Z",
      fromMe: true,
      text: "see you at 8",
      source: "whatsapp",
    });
    expect(mapWhatsAppRow({ ...row, from_me: 0 })?.fromMe).toBe(false);
  });
  it("drops non-text, empty and id-less rows", () => {
    expect(mapWhatsAppRow({ ...row, type: 1 })).toBeNull();
    expect(mapWhatsAppRow({ ...row, type: null })).toBeNull();
    expect(mapWhatsAppRow({ ...row, text: "   " })).toBeNull();
    expect(mapWhatsAppRow({ ...row, text: null })).toBeNull();
    expect(mapWhatsAppRow({ ...row, stanza: null })).toBeNull();
    expect(mapWhatsAppRow({ ...row, date: null })).toBeNull();
  });
});

describe("mapIMessageRow", () => {
  it("prefers text, falls back to the decoded body, strips attachment glyphs", () => {
    const r = { guid: "G1", date: 780000000 * 1e9, from_me: 0, text: "hi", decoded: null };
    expect(mapIMessageRow(r)).toEqual({ guid: "G1", sentAt: "2025-09-19T18:40:00.000Z", fromMe: false, text: "hi", source: "imessage" });
    expect(mapIMessageRow({ ...r, text: null, decoded: "from body" })?.text).toBe("from body");
    expect(mapIMessageRow({ ...r, text: "￼", decoded: null })).toBeNull();
  });
});

describe("captureSource", () => {
  it("allowlists imessage and whatsapp, defaulting when absent", () => {
    expect(captureSource(undefined, "imessage")).toBe("imessage");
    expect(captureSource(null, "whatsapp")).toBe("whatsapp");
    expect(captureSource("whatsapp", "imessage")).toBe("whatsapp");
    expect(captureSource("imessage", "whatsapp")).toBe("imessage");
    expect(captureSource("paste", "imessage")).toBeNull();
    expect(captureSource("WhatsApp", "imessage")).toBeNull();
    expect(captureSource(1, "imessage")).toBeNull();
  });
});

it("summaryLine", () => {
  expect(summaryLine("Ana", 12, 3, 4)).toBe("Ana: 12 iMessage, 3 WhatsApp messages (4 new)");
  expect(summaryLine("Ana", 0, 2, null)).toBe("Ana: 0 iMessage, 2 WhatsApp messages (dry run)");
});

// ---------------------------------------------------------------------------
// Fixture databases with the real schemas (only the columns we touch, plus a
// few neighbours), built with the same sqlite3 CLI the script uses.

const ANA = "+15551234567";
let dir: string;
let chatDb: string;
let waDb: string;
let writer: ChildProcess | undefined;

function sql(db: string, script: string) {
  execFileSync("/usr/bin/sqlite3", [db], { input: script });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "dating-sync-test-"));
  chatDb = join(dir, "chat.db");
  sql(
    chatDb,
    `CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
     CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT);
     CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT UNIQUE, text TEXT, attributedBody BLOB,
       date INTEGER, is_from_me INTEGER, associated_message_type INTEGER DEFAULT 0, handle_id INTEGER);
     CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
     CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
     INSERT INTO handle VALUES (1, '+15551234567', 'iMessage'), (2, '(555) 123-4567', 'SMS'), (3, '+15559999999', 'iMessage');
     INSERT INTO chat VALUES (1, 'ana-1to1'), (2, 'ana-sms'), (3, 'group'), (4, 'bo-1to1');
     INSERT INTO chat_handle_join VALUES (1, 1), (2, 2), (3, 1), (3, 3), (4, 3);
     INSERT INTO message VALUES
       (1, 'im-1', 'hey', NULL, 780000000000000000, 0, 0, 1),
       (2, 'im-2', 'hi back', NULL, 780000060000000000, 1, 0, 0),
       (3, 'im-3', 'Loved "hey"', NULL, 780000070000000000, 1, 2000, 0),
       (4, 'im-4', 'sms thread', NULL, 780000080000000000, 0, 0, 2),
       (5, 'im-group', 'group chat', NULL, 780000090000000000, 0, 0, 1),
       (6, 'im-bo', 'someone else', NULL, 780000100000000000, 0, 0, 3),
       (7, 'im-empty', '', NULL, 780000110000000000, 0, 0, 1);
     INSERT INTO chat_message_join VALUES (1, 1), (1, 2), (1, 3), (2, 4), (3, 5), (4, 6), (1, 7);`,
  );

  // WhatsApp Desktop keeps ChatStorage.sqlite in WAL mode; keep the last
  // inserts in the -wal file to prove the snapshot copies it.
  const live = join(dir, "live");
  mkdirSync(live);
  waDb = join(live, "ChatStorage.sqlite");
  sql(
    waDb,
    `PRAGMA journal_mode=WAL;
     CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZSESSIONTYPE INTEGER,
       ZCONTACTJID VARCHAR, ZPARTNERNAME VARCHAR, ZLASTMESSAGEDATE TIMESTAMP);
     CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZCHATSESSION INTEGER, ZISFROMME INTEGER,
       ZMESSAGETYPE INTEGER, ZMESSAGEDATE TIMESTAMP, ZSENTDATE TIMESTAMP, ZFROMJID VARCHAR, ZTOJID VARCHAR,
       ZSTANZAID VARCHAR, ZTEXT VARCHAR, ZGROUPMEMBER INTEGER);
     INSERT INTO ZWACHATSESSION (Z_PK, ZSESSIONTYPE, ZCONTACTJID, ZPARTNERNAME) VALUES
       (1, 0, '15551234567@s.whatsapp.net', 'Ana'),
       (2, 1, '120363025246125486@g.us', 'Friends'),
       (3, 3, 'status@broadcast', NULL),
       (4, 0, '99887766554433@lid', 'Ana (lid)'),
       (5, 0, '15559999999@s.whatsapp.net', 'Bo');
     INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZISFROMME, ZMESSAGETYPE, ZMESSAGEDATE, ZSTANZAID, ZTEXT) VALUES
       (1, 1, 0, 0, 780000000.25, '3EB0A1', 'drinks thursday?'),
       (2, 1, 1, 0, 780000100, '3EB0A2', 'yes!'),
       (3, 1, 0, 1, 780000200, '3EB0A3', NULL),
       (4, 1, 0, 0, 780000300, '3EB0A4', '   '),
       (5, 1, 0, 0, 780000400, '3EB0A5', NULL),
       (6, 1, 0, 7, 780000450, '3EB0A6', 'https://link.example'),
       (7, 2, 0, 0, 780000500, '3EB0G1', 'group text'),
       (8, 3, 0, 0, 780000600, '3EB0S1', 'status text'),
       (9, 4, 0, 0, 780000700, '3EB0L1', 'lid text'),
       (10, 5, 0, 0, 780000800, '3EB0B1', 'bo text');
     PRAGMA wal_checkpoint(TRUNCATE);`,
  );
  // A live app keeps its connection open, so recent writes sit in the -wal
  // file. Hold a writer open (no checkpoint) while the snapshot is taken.
  writer = spawn("/usr/bin/sqlite3", [waDb], { stdio: ["pipe", "ignore", "ignore"] });
  writer.stdin!.write(
    `PRAGMA wal_autocheckpoint=0;
     INSERT INTO ZWAMESSAGE (Z_PK, ZCHATSESSION, ZISFROMME, ZMESSAGETYPE, ZMESSAGEDATE, ZSTANZAID, ZTEXT)
       VALUES (11, 1, 1, 0, 780000900, '3EB0A7', 'from the wal');\n`,
  );
  for (let i = 0; i < 200; i++) {
    const n = execFileSync("/usr/bin/sqlite3", [waDb, "SELECT COUNT(*) FROM ZWAMESSAGE"], { encoding: "utf8" });
    if (n.trim() === "11") return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("WAL writer never committed");
});

afterAll(() => {
  writer?.stdin?.end();
  writer?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("iMessage reader (fixture)", () => {
  it("returns only 1:1 text messages with the person's handles", () => {
    const idx = iMessageHandleIndex(chatDb);
    expect(idx.get(ANA)).toEqual([1, 2]);
    const msgs = readIMessages(chatDb, idx.get(ANA)!, 0);
    expect(msgs.map((m) => m.guid)).toEqual(["im-1", "im-2", "im-4"]);
    expect(msgs.every((m) => m.source === "imessage")).toBe(true);
    expect(msgs[1]).toMatchObject({ fromMe: true, text: "hi back", sentAt: "2025-09-19T18:41:00.000Z" });
  });
  it("respects since", () => {
    const idx = iMessageHandleIndex(chatDb);
    expect(readIMessages(chatDb, idx.get(ANA)!, 780000030e9).map((m) => m.guid)).toEqual(["im-2", "im-4"]);
    expect(readIMessages(chatDb, [], 0)).toEqual([]);
  });
});

describe("WhatsApp reader (fixture)", () => {
  it("snapshots the db with its WAL and reads only matching 1:1 text messages", () => {
    const snapDir = join(dir, "snap");
    mkdirSync(snapDir);
    expect(statSync(`${waDb}-wal`).size).toBeGreaterThan(0);
    const snap = snapshotDb(waDb, snapDir);
    expect(whatsAppSchemaProblems(snap)).toEqual([]);

    const msgs = readWhatsAppMessages(snap, whatsAppSessions(snap), [ANA, "ana@example.com"], 0);
    expect(msgs).toEqual([
      { guid: "wa:3EB0A1", sentAt: "2025-09-19T18:40:00.250Z", fromMe: false, text: "drinks thursday?", source: "whatsapp" },
      { guid: "wa:3EB0A2", sentAt: "2025-09-19T18:41:40.000Z", fromMe: true, text: "yes!", source: "whatsapp" },
      { guid: "wa:3EB0A7", sentAt: "2025-09-19T18:55:00.000Z", fromMe: true, text: "from the wal", source: "whatsapp" },
    ]);
  });

  it("respects since and ignores people with no WhatsApp thread", () => {
    const sessions = whatsAppSessions(waDb);
    expect(readWhatsAppMessages(waDb, sessions, [ANA], 780000050).map((m) => m.guid)).toEqual(["wa:3EB0A2", "wa:3EB0A7"]);
    expect(readWhatsAppMessages(waDb, sessions, ["+15550000000"], 0)).toEqual([]);
  });

  it("reports schema drift instead of crashing", () => {
    const odd = join(dir, "odd.sqlite");
    sql(odd, "CREATE TABLE ZWACHATSESSION (Z_PK INTEGER, ZCONTACTJID VARCHAR); CREATE TABLE ZWAMESSAGE (Z_PK INTEGER);");
    expect(whatsAppSchemaProblems(odd)).toContain("ZWACHATSESSION.ZSESSIONTYPE");
    expect(whatsAppSchemaProblems(odd)).toContain("ZWAMESSAGE.ZSTANZAID");
  });

  it("dbStatus says missing for an absent file", () => {
    expect(dbStatus(join(dir, "nope.sqlite"))).toBe("missing");
    expect(dbStatus(waDb)).toBe("ok");
  });
});
