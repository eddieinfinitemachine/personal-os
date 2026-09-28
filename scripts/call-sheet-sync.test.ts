import { describe, expect, it, vi } from "vitest";
import { boundMessages, resolveCallSheetTargets, syncCallSheet, type Checkpoint } from "./call-sheet-sync";
import type { CaptureConfig } from "../src/lib/call-sheet/types";
const now = new Date("2026-09-28T12:00:00Z");
const person = { id: "one", name: "Avery Example", phone: "+15551234567", email: null, identityKey: "v1", starred: true };
const config: CaptureConfig = { sourceEpochs: { imessage: "epoch-i", whatsapp: "epoch-w" }, sources: { imessage: true, whatsapp: false }, people: [person], blockedHandles: [] };
const fresh = (): Checkpoint => ({ version: 1, metadata: {}, cues: {} });
const message = { guid: "m1", sentAt: "2026-08-01T12:00:00Z", fromMe: false, text: "How is the new project going?" };
const reader = { activity: () => ({ lastContactAt: message.sentAt, messageCount: 3 }), messages: () => [message] };
describe("call sheet local connector", () => {
  it("does not read Contacts or messages when disabled", async () => {
    const contacts = vi.fn(), open = vi.fn();
    await syncCallSheet({ api: async () => ({ ...config, sources: { imessage: false, whatsapp: false } }), contacts, open, checkpoint: fresh(), save: async () => {}, now });
    expect(contacts).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("requires an exact complete name and removes shared/blocked identities", () => {
    const contacts = [{ name: person.name, first: "Avery", last: "Example", phones: ["+15559999999"], emails: [] }];
    const result = resolveCallSheetTargets({ ...config, people: [{ ...person, phone: null }, { ...person, id: "two", name: "Different Person" }], blockedHandles: ["+15551234567"] }, contacts);
    expect(result[0].handles).toEqual(["+15559999999"]); expect(result[1].handles).toEqual([]);
    expect(resolveCallSheetTargets({ ...config, people: [{ ...person, name: "Avery", phone: null }] }, contacts)[0].handles).toEqual([]);
    expect(resolveCallSheetTargets({ ...config, people: [person, { ...person, id: "two" }] }, contacts).every(p => p.handles.length === 0)).toBe(true);
  });
  it("records metadata before summaries and checkpoints only successful extraction", async () => {
    const posted: any[] = [], checkpoint = fresh();
    const api = async (body?: object) => { if (!body) return config; posted.push(body); return { ok: true, extracted: true }; };
    const result = await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(result).toEqual({ checked: 1, extracted: 1 });
    expect(posted.find(p => p.type === "person" && p.extract === false).messages).toEqual([]);
    expect(posted.findIndex(p => p.status === "ready")).toBeLessThan(posted.findIndex(p => p.type === "person" && p.extract !== false));
    const again = await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(again).toEqual({ checked: 0, extracted: 0 });
  });
  it("does not mark a partial source ready or checkpoint failed metadata", async () => {
    const posted: any[] = [], checkpoint = fresh();
    const api = async (body?: any) => { if (!body) return config; posted.push(body); if (body.type === "person") throw Error("failed"); return {}; };
    await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(posted.some(p => p.status === "ready")).toBe(false);
    expect(posted.some(p => p.status === "error")).toBe(true);
    expect(checkpoint.metadata).toEqual({}); expect(checkpoint.cues).toEqual({});
  });
  it("retries model failure without resending unchanged metadata", async () => {
    const checkpoint = fresh(), api = vi.fn(async (body?: any) => !body ? config : { ok: true, extracted: false });
    await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(checkpoint.cues).toEqual({});
    api.mockClear();
    await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(api.mock.calls.filter(([body]) => body?.type === "person")).toHaveLength(1);
  });
  it("refreshes metadata daily and when identities change", async () => {
    const checkpoint = fresh(), api = vi.fn(async (body?: any) => !body ? config : { extracted: true });
    await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    const next = await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now: new Date("2026-09-29T12:00:00Z") });
    expect(next.checked).toBe(1);
    api.mockImplementation(async (body?: any) => !body ? { ...config, people: [{ ...person, identityKey: "changed" }] } : { extracted: true });
    const changed = await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(changed).toEqual({ checked: 1, extracted: 1 });
  });
  it("resends unchanged evidence when a source is re-enabled with a new epoch", async () => {
    const checkpoint = fresh();
    let current = config;
    const posted: any[] = [];
    const api = async (body?: any) => { if (!body) return current; posted.push(body); return { extracted: true }; };
    await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    current = { ...config, sourceEpochs: { ...config.sourceEpochs!, imessage: "new-epoch" } };
    posted.length = 0;
    const result = await syncCallSheet({ api, contacts: async () => [], open: async () => reader, checkpoint, save: async () => {}, now });
    expect(result).toEqual({ checked: 1, extracted: 1 });
    expect(posted.every(p => p.sourceEpoch === "new-epoch")).toBe(true);
  });
  it("uses the latest contact across both sources to suppress unnecessary summaries", async () => {
    const api = vi.fn(async (body?: any) => !body ? { ...config, sources: { imessage: true, whatsapp: true } } : { extracted: true });
    const result = await syncCallSheet({ api, contacts: async () => [], open: async s => s === "imessage" ? reader : { ...reader, activity: () => ({ lastContactAt: now.toISOString(), messageCount: 1 }) }, checkpoint: fresh(), save: async () => {}, now });
    expect(result).toEqual({ checked: 2, extracted: 0 });
  });
  it("bounds the context and ignores duplicate, future, and stale messages", () => {
    const values = Array.from({ length: 250 }, (_, i) => ({ ...message, guid: "m" + i, text: "x".repeat(3000) }));
    const result = boundMessages([...values, values[0], { ...message, guid: "old", sentAt: "2025-01-01" }, { ...message, guid: "future", sentAt: "2027-01-01" }], now);
    expect(result.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(20000);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(new Set(result.map(m => m.guid)).size).toBe(result.length);
    expect(result.some(m => m.guid === "old" || m.guid === "future")).toBe(false);
  });
});

describe("local database fixtures", () => {
  it("counts only matching direct activity and reads its text", async () => {
    const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const { openCallSheetSource } = await import("./call-sheet-sync");
    const dir = mkdtempSync(join(tmpdir(), "call-sheet-fixture-"));
    const db = join(dir, "chat.db"), snapshots = join(dir, "snapshots");
    mkdirSync(snapshots);
    const apple = (iso: string) => (Date.parse(iso) - 978307200000) * 1e6;
    execFileSync("/usr/bin/sqlite3", [db, `CREATE TABLE handle(ROWID INTEGER PRIMARY KEY,id TEXT);
      CREATE TABLE message(ROWID INTEGER PRIMARY KEY,guid TEXT,text TEXT,attributedBody BLOB,date INTEGER,is_from_me INTEGER,associated_message_type INTEGER);
      CREATE TABLE chat_handle_join(chat_id INTEGER,handle_id INTEGER);
      CREATE TABLE chat_message_join(chat_id INTEGER,message_id INTEGER);
      INSERT INTO handle VALUES(1,'+15551234567'),(2,'+15559999999');
      INSERT INTO chat_handle_join VALUES(1,1),(2,1),(2,2),(3,2);
      INSERT INTO message VALUES(1,'direct','Hello',NULL,${apple(message.sentAt)},0,0),(2,'group','Group',NULL,${apple(now.toISOString())},0,0),(3,'other','Other',NULL,${apple(now.toISOString())},0,0),(4,'reaction','Liked',NULL,${apple(now.toISOString())},0,2000);
      INSERT INTO chat_message_join VALUES(1,1),(2,2),(3,3),(1,4);`]);
    vi.stubEnv("CALL_SHEET_CHATDB", db);
    try {
      const source = await openCallSheetSource(snapshots, "imessage", now);
      const target = { ...person, handles: [person.phone] };
      expect(source.activity(target)).toEqual({ lastContactAt: message.sentAt.replace("00Z", "00.000Z"), messageCount: 1 });
      expect(source.messages(target).map(m => m.guid)).toEqual(["direct"]);
    } finally { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("matches WhatsApp privacy IDs through verified contacts and excludes groups", async () => {
    const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const { openCallSheetSource } = await import("./call-sheet-sync");
    const dir = mkdtempSync(join(tmpdir(), "call-sheet-wa-")), db = join(dir, "ChatStorage.sqlite"), contacts = join(dir, "ContactsV2.sqlite"), snapshots = join(dir, "snapshots");
    mkdirSync(snapshots);
    const date = (Date.parse(message.sentAt) - 978307200000) / 1000;
    execFileSync("/usr/bin/sqlite3", [db, `CREATE TABLE ZWACHATSESSION(Z_PK INTEGER,ZCONTACTJID TEXT,ZSESSIONTYPE INTEGER);
      CREATE TABLE ZWAMESSAGE(Z_PK INTEGER,ZCHATSESSION INTEGER,ZISFROMME INTEGER,ZTEXT TEXT,ZMESSAGEDATE REAL,ZSTANZAID TEXT,ZMESSAGETYPE INTEGER);
      INSERT INTO ZWACHATSESSION VALUES(1,'999999@lid',0),(2,'123@g.us',1);
      INSERT INTO ZWAMESSAGE VALUES(1,1,0,'Hello',${date},'direct',0),(2,2,0,'Group',${date+1000},'group',0);`]);
    execFileSync("/usr/bin/sqlite3", [contacts, "CREATE TABLE ZWAADDRESSBOOKCONTACT(ZPHONENUMBER TEXT,ZWHATSAPPID TEXT,ZLID TEXT);INSERT INTO ZWAADDRESSBOOKCONTACT VALUES('15551234567','15551234567@s.whatsapp.net','999999');"]);
    vi.stubEnv("CALL_SHEET_WADB", db); vi.stubEnv("CALL_SHEET_WA_CONTACTS_DB", contacts);
    try {
      const source = await openCallSheetSource(snapshots, "whatsapp", now), target = { ...person, handles: [person.phone] };
      expect(source.activity(target).messageCount).toBe(1);
      expect(source.messages(target).map(m => m.guid)).toEqual(["wa:direct"]);
    } finally { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); }
  });
});
