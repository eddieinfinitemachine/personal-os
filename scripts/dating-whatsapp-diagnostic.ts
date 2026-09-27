/** Diagnostic only: call from the existing authorized sync job with its temporary
 * snapshot. Never opens/copies live databases, changes permissions, or imports
 * messages. Output contains schema metadata and exact-target counts only.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

type Column = { name: string; type: string };
const identifier = (name: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Unsupported schema identifier");
  return `"${name}"`;
};
const fieldLooksLikeIdentity = (name: string) => /JID|PHONE|(?:^|_)LID|ZLID|WHATSAPPID/i.test(name);

export function diagnoseWhatsAppPhone(snapshot: string, phone: string) {
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("An exact E.164 phone is required");
  const path = realpathSync(snapshot);
  if (path.startsWith(join(homedir(), "Library") + sep)) {
    throw new Error("Diagnostics require the authorized sync job's temporary snapshot, never a live Library database");
  }
  const query = <T>(sql: string): T[] => {
    const out = execFileSync("/usr/bin/sqlite3", ["-readonly", "-json", path, sql], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
    });
    return out.trim() ? JSON.parse(out) as T[] : [];
  };
  const tables = query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const schema: Array<{ table: string; columns: Column[] }> = [];
  for (const { name } of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    const columns = query<Column>(`SELECT name, type FROM pragma_table_info('${name}')`);
    if (/CHATSESSION|MESSAGE|CONTACT|ADDRESS|PHONE|IDENTITY|JID|LID/i.test(name) || columns.some((c) => fieldLooksLikeIdentity(c.name))) {
      schema.push({ table: name, columns });
    }
  }

  const digits = phone.slice(1);
  // Exact full number only: punctuation can differ, country codes cannot.
  // No name lookup, partial-number lookup, or LID-number-as-phone assumption.
  const phoneMatch = (column: string) => {
    const normalized = `lower(trim(CAST(${identifier(column)} AS TEXT)))`;
    const unformatted = [" ", "-", "(", ")"].reduce((sql, character) => `replace(${sql}, '${character}', '')`, normalized);
    return `${unformatted} IN ('${phone}', '${digits}', '${digits}@s.whatsapp.net')`;
  };
  const exactPhoneCounts: Array<{ table: string; column: string; rows: number }> = [];
  const coLocatedLidCounts: Array<{ table: string; phoneColumn: string; lidColumn: string; rows: number }> = [];
  for (const { table, columns } of schema) {
    const candidates = columns.filter((c) => fieldLooksLikeIdentity(c.name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.name));
    if (!candidates.length) continue;
    const counts = query<Record<string, number>>(`SELECT ${candidates.map((c, i) => `COALESCE(SUM(CASE WHEN ${phoneMatch(c.name)} THEN 1 ELSE 0 END),0) AS n${i}`).join(", ")} FROM ${identifier(table)}`)[0];
    candidates.forEach((column, i) => {
      exactPhoneCounts.push({ table, column: column.name, rows: counts[`n${i}`] });
      if (!counts[`n${i}`]) return;
      for (const lid of candidates.filter((c) => c.name !== column.name && /LID|JID/i.test(c.name))) {
        // This only reports same-row evidence; it does not approve a mapping or
        // expose the identifier. Review the observed columns before matching.
        const rows = query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${identifier(table)} WHERE ${phoneMatch(column.name)} AND lower(trim(CAST(${identifier(lid.name)} AS TEXT))) GLOB '*@lid'`)[0].n;
        if (rows) coLocatedLidCounts.push({ table, phoneColumn: column.name, lidColumn: lid.name, rows });
      }
    });
  }

  const session = schema.find((s) => s.table === "ZWACHATSESSION");
  const messages = schema.find((s) => s.table === "ZWAMESSAGE");
  const has = (s: typeof session, names: string[]) => names.every((name) => s?.columns.some((c) => c.name === name));
  let directOneToOneSessions: number | null = null;
  let directOneToOneTextRows: number | null = null;
  if (has(session, ["Z_PK", "ZCONTACTJID", "ZSESSIONTYPE"])) {
    const target = `${phoneMatch("ZCONTACTJID")} AND (ZSESSIONTYPE = 0 OR ZSESSIONTYPE IS NULL)`;
    directOneToOneSessions = query<{ n: number }>(`SELECT COUNT(*) AS n FROM ZWACHATSESSION WHERE ${target}`)[0].n;
    if (has(messages, ["ZCHATSESSION", "ZMESSAGETYPE", "ZTEXT"])) {
      directOneToOneTextRows = query<{ n: number }>(`SELECT COUNT(*) AS n FROM ZWAMESSAGE WHERE ZCHATSESSION IN (SELECT Z_PK FROM ZWACHATSESSION WHERE ${target}) AND ZMESSAGETYPE=0 AND ZTEXT IS NOT NULL`)[0].n;
    }
  }
  return { schema, exactPhoneCounts, coLocatedLidCounts, directOneToOneSessions, directOneToOneTextRows };
}
