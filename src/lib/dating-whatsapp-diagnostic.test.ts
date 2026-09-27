import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diagnoseWhatsAppPhone } from "../../scripts/dating-whatsapp-diagnostic";

let temp: string;
afterEach(() => { if (temp) rmSync(temp, { recursive: true, force: true }); });
const fixture = () => {
  temp = mkdtempSync(join(tmpdir(), "wa-schema-fixture-"));
  const db = join(temp, "fixture.sqlite");
  execFileSync("/usr/bin/sqlite3", [db, `
    CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZSESSIONTYPE INTEGER, ZPARTNERNAME TEXT);
    CREATE TABLE ZWAMESSAGE (ZCHATSESSION INTEGER, ZMESSAGETYPE INTEGER, ZTEXT TEXT);
    CREATE TABLE ZUNKNOWNMAPPING (ZPHONENUMBER TEXT, ZLIDJID TEXT, ZDISPLAYNAME TEXT);
    INSERT INTO ZWACHATSESSION VALUES (1,'447590108584@s.whatsapp.net',0,'Target private name'),
      (2,'447590108584@g.us',1,'Group private name'), (3,'777777777777@lid',0,'Target private name'),
      (4,'447590108584@s.whatsapp.net',1,'Do not include group');
    INSERT INTO ZWAMESSAGE VALUES (1,0,'TARGET SECRET'),(2,0,'GROUP SECRET'),(3,0,'LID SECRET'),(4,0,'GROUP SECRET TWO');
    INSERT INTO ZUNKNOWNMAPPING VALUES ('+44 7590 108584','777777777777@lid','Target private name'),
      ('+19999999999','888888888888@lid','Unrelated private name');
  `]);
  return db;
};

describe("target-only WhatsApp schema diagnostic", () => {
  it("reports structural mapping evidence and exact target counts without content or identity dumps", () => {
    const report = diagnoseWhatsAppPhone(fixture(), "+447590108584");
    expect(report.directOneToOneSessions).toBe(1);
    expect(report.directOneToOneTextRows).toBe(1);
    expect(report.coLocatedLidCounts).toEqual([{ table: "ZUNKNOWNMAPPING", phoneColumn: "ZPHONENUMBER", lidColumn: "ZLIDJID", rows: 1 }]);
    expect(report.exactPhoneCounts).toContainEqual({ table: "ZUNKNOWNMAPPING", column: "ZPHONENUMBER", rows: 1 });
    const serialized = JSON.stringify(report);
    for (const hidden of ["SECRET", "private name", "777777777777", "888888888888", "19999999999", "447590108584"]) {
      expect(serialized).not.toContain(hidden);
    }
  });
  it("does not interpret a LID as a phone or infer identity from a name", () => {
    const report = diagnoseWhatsAppPhone(fixture(), "+777777777777");
    expect(report.directOneToOneSessions).toBe(0);
    expect(report.directOneToOneTextRows).toBe(0);
    expect(report.coLocatedLidCounts).toEqual([]);
  });
  it("rejects incomplete phones and SQL-like input before opening a database", () => {
    for (const phone of ["7590108584", "+44", "+447590108584' OR 1=1"]) {
      expect(() => diagnoseWhatsAppPhone("/does-not-exist", phone)).toThrow("exact E.164");
    }
  });
});
