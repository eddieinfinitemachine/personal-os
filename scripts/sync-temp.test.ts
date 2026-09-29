import { mkdtempSync, mkdirSync, rmSync, utimesSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepStaleTempRoots } from "./sync-temp";

const HOUR = 3600_000;
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sweep-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function root(name: string, ageMs: number) {
  const p = join(dir, name);
  mkdirSync(p);
  writeFileSync(join(p, "chat.db"), "x");
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(p, t, t);
  return p;
}

describe("sweepStaleTempRoots", () => {
  it("removes old roots with the prefix and keeps fresh ones, other prefixes and files", () => {
    const old = root("crm-context-sync-aaa", 3 * HOUR);
    const fresh = root("crm-context-sync-bbb", 10 * 60_000);
    const other = root("call-sheet-sync-ccc", 3 * HOUR);
    writeFileSync(join(dir, "crm-context-sync-file"), "not a dir");
    expect(sweepStaleTempRoots("crm-context-sync-", 2 * HOUR, dir)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(dir, "crm-context-sync-file"))).toBe(true);
  });
  it("returns 0 for a missing directory", () => {
    expect(sweepStaleTempRoots("crm-context-sync-", HOUR, join(dir, "missing"))).toBe(0);
  });
});
