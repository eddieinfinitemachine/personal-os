import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { whatsappBackfillKey, readWhatsAppBackfills, markWhatsAppBackfill } from "../../scripts/dating-whatsapp-checkpoint";

const dirs: string[] = [];
function path() {
  const dir = mkdtempSync(join(tmpdir(), "dating-wa-checkpoint-")); dirs.push(dir);
  return join(dir, "state.json");
}
const phone = "+15551234567";
const mapping = new Map([["123456789@lid", phone]]);
const key = (base = "https://example.test", handles = [phone], map = mapping) => whatsappBackfillKey(base, "person-secret", handles, map)!;
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("local WhatsApp backfill checkpoint", () => {
  it("keys exact identity evidence and changes when the destination, person, handles or matching mappings change", () => {
    const original = key();
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(key("https://other.test")).not.toBe(original);
    expect(whatsappBackfillKey("https://example.test", "different", [phone], mapping)).not.toBe(original);
    expect(key(undefined, [phone, "second@example.test"])).not.toBe(original);
    expect(key(undefined, ["+447700900123"], new Map([["123456789@lid", "+447700900123"]]))).not.toBe(original);
    expect(key(undefined, undefined, new Map([...mapping, ["222222222@lid", phone]]))).not.toBe(original);
    expect(key(undefined, undefined, new Map([...mapping, ["999999999@lid", "+447700900123"]]))).toBe(original);
    expect(key(undefined, [phone, phone])).toBe(original);
    expect(whatsappBackfillKey("https://example.test", "person-secret", [phone], new Map())).toBeNull();
    expect(whatsappBackfillKey("https://example.test", "person-secret", [phone], new Map([["123456789@g.us", phone]]))).toBeNull();
  });

  it("treats missing, corrupt, wrong-version and malformed checkpoints as not completed", () => {
    const file = path();
    expect(readWhatsAppBackfills(file).size).toBe(0);
    for (const value of ["{", "null", '{"version":2,"keys":[]}', '{"version":1,"keys":["phone-secret"]}', '{"version":1,"keys":{}}']) {
      writeFileSync(file, value);
      expect(readWhatsAppBackfills(file).size).toBe(0);
    }
  });

  it("persists only hashes atomically with private permissions and keeps concurrent completed keys", async () => {
    const file = path();
    const first = key(), second = key("https://other.test");
    await Promise.all([markWhatsAppBackfill(first, file), markWhatsAppBackfill(second, file)]);
    await markWhatsAppBackfill(first, file);
    expect(readWhatsAppBackfills(file)).toEqual(new Set([first, second]));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, keys: [first, second].sort() });
    expect(readFileSync(file, "utf8")).not.toMatch(/person-secret|15551234567|123456789|example\.test/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("does not mark failed persistence as completed and allows a later retry", async () => {
    const parent = path();
    writeFileSync(parent, "blocks directory creation");
    const file = join(parent, "state.json");
    await expect(markWhatsAppBackfill(key(), file)).rejects.toThrow();
    expect(readWhatsAppBackfills(file).has(key())).toBe(false);
    rmSync(parent);
    await markWhatsAppBackfill(key(), file);
    expect(readWhatsAppBackfills(file).has(key())).toBe(true);
  });

  it("cleans its lock after a failed atomic replacement so the next attempt can succeed", async () => {
    const file = path();
    mkdirSync(file);
    await expect(markWhatsAppBackfill(key(), file)).rejects.toThrow();
    expect(existsSync(`${file}.lock`)).toBe(false);
    expect(readWhatsAppBackfills(file).has(key())).toBe(false);
    rmSync(file, { recursive: true });
    await markWhatsAppBackfill(key(), file);
    expect(readWhatsAppBackfills(file).has(key())).toBe(true);
  });
});
