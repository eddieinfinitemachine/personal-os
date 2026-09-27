import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDatingContactsCache } from "../../scripts/dating-contact-cache";
const dirs: string[] = [];
const record = { name: "Ana Reyes", first: "Ana", last: "Reyes", nick: "", org: "", phones: ["4155550134"], emails: [] };
async function fixture(value: string) {
  const dir = await mkdtemp(join(tmpdir(), "dating-contact-cache-test-")); dirs.push(dir);
  const path = join(dir, "contacts.json"); await writeFile(path, value); return path;
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe("read-only Contacts cache", () => {
  it("returns records with the actual modification date and freshness", async () => {
    const path = await fixture(JSON.stringify([record]));
    const modified = new Date("2026-09-01T00:00:00Z"); await utimes(path, modified, modified);
    const fresh = await readDatingContactsCache({ path, now: modified.getTime() + 1000 });
    expect(fresh).toEqual({ status: "ready", contacts: [record], updatedAt: modified.toISOString(), ageMs: 1000 });
    const stale = await readDatingContactsCache({ path, now: modified.getTime() + 25 * 60 * 60 * 1000 });
    expect(stale).toMatchObject({ status: "stale", contacts: [record], updatedAt: modified.toISOString() });
  });
  it("reports missing and unreadable paths without throwing or exposing data", async () => {
    const path = await fixture("[]");
    expect(await readDatingContactsCache({ path: `${path}.missing` })).toEqual({ status: "missing", contacts: [], updatedAt: null, ageMs: null });
    expect((await readDatingContactsCache({ path: dirs.at(-1)! })).status).toBe("unreadable");
  });
  it("rejects malformed caches as a whole rather than dropping a potentially ambiguous identity", async () => {
    for (const data of ["{", "{}", JSON.stringify([record, null]), JSON.stringify([record, { ...record, phones: [42] }])]) {
      const result = await readDatingContactsCache({ path: await fixture(data) });
      expect(result.status).toBe("invalid"); expect(result.contacts).toEqual([]);
    }
  });
});
