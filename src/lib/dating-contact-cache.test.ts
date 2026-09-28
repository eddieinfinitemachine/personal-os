import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, utimes, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readDatingContactsCache } from "../../scripts/dating-contact-cache";
const dirs: string[] = [];
const record = {
  name: "Ana Reyes",
  first: "Ana",
  last: "Reyes",
  nick: "",
  org: "",
  phones: ["4155550134"],
  emails: [],
};
async function fixture(value: string) {
  const dir = await mkdtemp(join(tmpdir(), "dating-contact-cache-test-"));
  dirs.push(dir);
  const path = join(dir, "contacts.json");
  await writeFile(path, value);
  return path;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("read-only Contacts cache", () => {
  it("returns records with the actual modification date and freshness", async () => {
    const path = await fixture(JSON.stringify([record]));
    const modified = new Date("2026-09-01T00:00:00Z");
    await utimes(path, modified, modified);
    const fresh = await readDatingContactsCache({
      path,
      now: modified.getTime() + 1000,
    });
    expect(fresh).toEqual({
      status: "ready",
      contacts: [record],
      updatedAt: modified.toISOString(),
      ageMs: 1000,
    });
    const stale = await readDatingContactsCache({
      path,
      now: modified.getTime() + 25 * 60 * 60 * 1000,
    });
    expect(stale).toMatchObject({
      status: "stale",
      contacts: [record],
      updatedAt: modified.toISOString(),
    });
  });
  it("reports missing and unreadable paths without throwing or exposing data", async () => {
    const path = await fixture("[]");
    expect(await readDatingContactsCache({ path: `${path}.missing` })).toEqual({
      status: "missing",
      contacts: [],
      updatedAt: null,
      ageMs: null,
    });
    expect((await readDatingContactsCache({ path: dirs.at(-1)! })).status).toBe(
      "unreadable",
    );
  });
  it("rejects malformed caches as a whole rather than dropping a potentially ambiguous identity", async () => {
    for (const data of [
      "{",
      "{}",
      JSON.stringify([record, null]),
      JSON.stringify([record, { ...record, phones: [42] }]),
    ]) {
      const result = await readDatingContactsCache({
        path: await fixture(data),
      });
      expect(result.status).toBe("invalid");
      expect(result.contacts).toEqual([]);
    }
  });
});

describe("fresh automatic Contacts lookup", () => {
  it("reuses a fresh cache and refreshes an expired one atomically", async () => {
    const { readFreshDatingContacts } = await import(
      "../../scripts/dating-contact-cache"
    );
    const path = await fixture(JSON.stringify([record]));
    let calls = 0;
    const exporter = async () => {
      calls++;
      return [{ ...record, phones: ["4155550999"] }];
    };
    expect(
      (await readFreshDatingContacts({ path, exportContacts: exporter }))
        .contacts,
    ).toEqual([record]);
    expect(calls).toBe(0);
    await readFreshDatingContacts({
      path,
      force: true,
      exportContacts: exporter,
    });
    expect(calls).toBe(1);
    await utimes(path, new Date(0), new Date(0));
    expect(
      (await readFreshDatingContacts({ path, exportContacts: exporter }))
        .contacts[0].phones,
    ).toEqual(["4155550999"]);
    expect(calls).toBe(2);
    expect((await readDatingContactsCache({ path })).status).toBe("ready");
  });
  it("never resolves with stale contacts after denied access or malformed refresh", async () => {
    const { readFreshDatingContacts } = await import(
      "../../scripts/dating-contact-cache"
    );
    const path = await fixture(JSON.stringify([record]));
    await utimes(path, new Date(0), new Date(0));
    for (const exporter of [
      async () => {
        throw Error("denied");
      },
      async () => [record, null],
    ]) {
      const result = await readFreshDatingContacts({
        path,
        exportContacts: exporter,
      });
      expect(result.status).toBe("unreadable");
      expect(result.contacts).toEqual([]);
    }
    expect((await readDatingContactsCache({ path })).contacts).toEqual([
      record,
    ]);
  });
});
