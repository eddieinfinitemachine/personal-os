import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDiscoveryThreads, readDiscoveryPage, runDiscoverySync } from "./dating-discovery-sync";
import { toAppleNs } from "../src/lib/dating-message-sync";
let temp: string;
let db: string;
const date = toAppleNs("2026-09-27T12:00:00Z");
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "synthetic-discovery-test-")); db = join(temp, "chat.db");
  execFileSync("/usr/bin/sqlite3", [db, `CREATE TABLE chat(style INTEGER); CREATE TABLE handle(id TEXT); CREATE TABLE chat_handle_join(chat_id INTEGER,handle_id INTEGER); CREATE TABLE chat_message_join(chat_id INTEGER,message_id INTEGER); CREATE TABLE message(guid TEXT,date INTEGER,is_from_me INTEGER,text TEXT,attributedBody BLOB,associated_message_type INTEGER); INSERT INTO chat VALUES(45),(43),(45); INSERT INTO handle VALUES('+15551234567'),('+15557654321'); INSERT INTO chat_handle_join VALUES(1,1),(2,1),(2,2),(3,2); INSERT INTO message VALUES('first',${date},0,'Another date?',NULL,0),('second',${date},1,'Yes, Friday.',NULL,0),('group',${date},0,'Group text',NULL,0); INSERT INTO chat_message_join VALUES(1,1),(1,2),(2,3);`]);
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

describe("synthetic Mac discovery readers", () => {
  it("selects only direct threads and uses row ID to resume shared timestamps", () => {
    const threads = listDiscoveryThreads(db, null);
    expect(threads.map((thread) => thread.id)).toEqual(["1", "3"]);
    const page = readDiscoveryPage(db, threads[0], null, "2026-09-01T00:00:00Z");
    expect(page.messages.map((message) => message.guid)).toEqual(["first", "second"]);
    const resumed = readDiscoveryPage(db, threads[0], { date: String(date), id: 1 }, "2026-09-01T00:00:00Z");
    expect(resumed.messages.map((message) => message.guid)).toEqual(["first", "second"]); // one overlap, one new
    expect(resumed.through).toEqual({ date: String(date), id: 2 });
    expect(readDiscoveryPage(db, threads[0], resumed.through, "2026-09-01T00:00:00Z").through).toBeNull();
  });

  it("round-trips nanosecond positions that cannot be represented as JavaScript numbers", () => {
    const precise = (BigInt(date) + 1n).toString();
    execFileSync("/usr/bin/sqlite3", [db, `INSERT INTO message VALUES('precise',${precise},0,'Another date on Saturday?',NULL,0); INSERT INTO chat_message_join VALUES(1,4);`]);
    const thread = listDiscoveryThreads(db, null)[0];
    const page = readDiscoveryPage(db, thread, null, "2026-09-01T00:00:00Z");
    expect(page.through).toEqual({ date: precise, id: 4 });
    expect(readDiscoveryPage(db, thread, page.through, "2026-09-01T00:00:00Z").through).toBeNull();
  });

  it("uses exact WhatsApp phone identities while excluding groups, broadcasts and unresolved privacy IDs", () => {
    const wa = join(temp, "wa.sqlite");
    execFileSync("/usr/bin/sqlite3", [wa, "CREATE TABLE ZWACHATSESSION(Z_PK INTEGER,ZCONTACTJID TEXT,ZSESSIONTYPE INTEGER); INSERT INTO ZWACHATSESSION VALUES(1,'15551234567@s.whatsapp.net',0),(2,'123@g.us',1),(3,'status@broadcast',0),(4,'123@lid',0),(5,'456@lid',0);"]);
    const threads = listDiscoveryThreads(null, wa, new Map([["123@lid", "+15557654321"]]));
    expect(threads.map((thread) => thread.id)).toEqual(["1", "4"]);
    expect(threads.map((thread) => thread.handle)).toEqual(["+15551234567", "+15557654321"]);
  });

  it("never reads a local database before the server opt-in and refuses insecure origins", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enabled: false }) });
    expect(await runDiscoverySync({ base: "https://example.invalid", token: "synthetic", chatDbPath: "/unreadable/no-permission", fetch })).toMatchObject({ skipped: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    await expect(runDiscoverySync({ base: "http://example.invalid", token: "synthetic", fetch })).rejects.toThrow("HTTPS");
  });
});
