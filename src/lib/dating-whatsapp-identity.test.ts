import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWhatsAppIdentityMap, matchWhatsAppSessions } from "./dating-message-sync";
import { readWhatsAppIdentityMap, readWhatsAppMessages, whatsAppSessions } from "./dating-message-readers";

const PHONE = "+15551234567";
const OTHER = "+447700900123";
const LID = "99887766554433@lid";
const row = (phone: string | null = PHONE, jid: string | null = "15551234567@s.whatsapp.net", lid: string | null = LID) => ({ phone, jid, lid });
const temps: string[] = [];
afterEach(() => { for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), "dating-wa-identity-")); temps.push(dir);
  const db = join(dir, "fixture.sqlite");
  execFileSync("/usr/bin/sqlite3", [db, sql]);
  return db;
}

describe("strict WhatsApp contact identity mapping", () => {
  it("accepts explicit identity columns and identical duplicates without guessing a country code", () => {
    expect(buildWhatsAppIdentityMap([
      row(), row("+1 (555) 123-4567", "15551234567", "99887766554433"),
      row(null, "447700900123@s.whatsapp.net", "123456789@lid"),
    ])).toEqual(new Map([[LID, PHONE], ["123456789@lid", OTHER]]));
  });

  it("rejects conflicts in both directions including disagreement within one row", () => {
    expect(buildWhatsAppIdentityMap([row(), row(OTHER, "447700900123@s.whatsapp.net")])).toEqual(new Map());
    expect(buildWhatsAppIdentityMap([row(), row(PHONE, null, "222222222@lid")])).toEqual(new Map());
    expect(buildWhatsAppIdentityMap([row(), row(PHONE, "447700900123@s.whatsapp.net")])).toEqual(new Map());
    expect(buildWhatsAppIdentityMap([row(), row(OTHER, "447700900123@s.whatsapp.net"), row(OTHER, null, "222222222@lid")])).toEqual(new Map());
  });

  it("rejects wrong identity namespaces, invalid phones and unpaired LIDs", () => {
    for (const invalid of [
      row(PHONE, "15551234567@g.us"), row(PHONE, "15551234567@lid"),
      row(PHONE, "status@broadcast"), row(PHONE, null, "99887766554433@g.us"),
      row(null, null), row("555", null), row("+00000000000", null),
    ]) expect(buildWhatsAppIdentityMap([invalid])).toEqual(new Map());
  });

  it("matches mapped 1:1 sessions only and preserves direct-number behavior", () => {
    const sessions = [
      { pk: 1, jid: "15551234567@s.whatsapp.net", type: 0 },
      { pk: 2, jid: LID, type: 0 },
      { pk: 3, jid: LID, type: 1 },
      { pk: 4, jid: "15551234567@lid", type: 0 },
      { pk: 5, jid: "99887766554433@g.us", type: 0 },
      { pk: 6, jid: "99887766554433:4@lid", type: null },
    ];
    expect(matchWhatsAppSessions(sessions, [PHONE])).toEqual([1]);
    expect(matchWhatsAppSessions(sessions, [PHONE], buildWhatsAppIdentityMap([row()]))).toEqual([1, 2, 6]);
    expect(matchWhatsAppSessions(sessions, [OTHER], buildWhatsAppIdentityMap([row()]))).toEqual([]);
    expect(matchWhatsAppSessions(sessions, [PHONE], new Map([["99887766554433@g.us", PHONE]]))).toEqual([1]);
  });
});

describe("WhatsApp identity reader with real synthetic SQLite", () => {
  it("checks schema before selecting identity fields and returns empty for missing schemas", () => {
    for (const sql of [
      "CREATE TABLE OTHER (ZPHONENUMBER TEXT, ZWHATSAPPID TEXT, ZLID TEXT);",
      "CREATE TABLE ZWAADDRESSBOOKCONTACT (ZPHONENUMBER TEXT, ZLID TEXT);",
    ]) expect(readWhatsAppIdentityMap(fixture(sql))).toEqual(new Map());
  });

  it("reads only documented identity columns and rejects cross-mapped rows", () => {
    const db = fixture(`CREATE TABLE ZWAADDRESSBOOKCONTACT (ZPHONENUMBER TEXT, ZWHATSAPPID TEXT, ZLID TEXT);
      INSERT INTO ZWAADDRESSBOOKCONTACT VALUES
      ('15551234567','15551234567@s.whatsapp.net','99887766554433'),
      ('+447700900123','447700900123@s.whatsapp.net','111111111@lid'),
      ('+447700900124','447700900124@s.whatsapp.net','111111111@lid'),
      ('+447700900123','447700900123@s.whatsapp.net','222222222@lid'),
      ('+15559999999','15559999999@g.us','333333333@lid');`);
    expect(readWhatsAppIdentityMap(db)).toEqual(new Map([[LID, PHONE]]));
  });

  it("reads mapped and direct texts together without groups, other people or older messages", () => {
    const db = fixture(`CREATE TABLE ZWAADDRESSBOOKCONTACT (ZPHONENUMBER TEXT, ZWHATSAPPID TEXT, ZLID TEXT);
      INSERT INTO ZWAADDRESSBOOKCONTACT VALUES ('15551234567','15551234567@s.whatsapp.net','99887766554433');
      CREATE TABLE ZWACHATSESSION (Z_PK INTEGER, ZCONTACTJID TEXT, ZSESSIONTYPE INTEGER);
      INSERT INTO ZWACHATSESSION VALUES (1,'15551234567@s.whatsapp.net',0),(2,'99887766554433@lid',0),
      (3,'99887766554433@lid',1),(4,'15559999999@s.whatsapp.net',0),(5,'99887766554433@g.us',0);
      CREATE TABLE ZWAMESSAGE (ZSTANZAID TEXT, ZMESSAGEDATE REAL, ZISFROMME INTEGER, ZTEXT TEXT, ZMESSAGETYPE INTEGER, ZCHATSESSION INTEGER);
      INSERT INTO ZWAMESSAGE VALUES ('direct',100,0,'direct text',0,1),('mapped',101,0,'mapped text',0,2),
      ('group',102,0,'group text',0,3),('other',103,0,'other text',0,4),('badgroup',104,0,'bad group text',0,5),
      ('old',10,0,'old mapped text',0,2),('photo',105,0,'caption',1,2);`);
    const sessions = whatsAppSessions(db);
    expect(readWhatsAppMessages(db, sessions, [PHONE], 50).map((m) => m.guid)).toEqual(["wa:direct"]);
    const messages = readWhatsAppMessages(db, sessions, [PHONE], 50, readWhatsAppIdentityMap(db));
    expect(messages.map((m) => m.guid)).toEqual(["wa:direct", "wa:mapped"]);
    expect(messages.every((m) => m.source === "whatsapp")).toBe(true);
  });
});
