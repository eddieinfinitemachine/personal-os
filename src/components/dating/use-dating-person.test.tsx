// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatingPersonDTO } from "@/lib/dating-server";
import { useDatingPerson } from "./use-dating-person";

const initial: DatingPersonDTO = {
  id: "save-person", name: "Ana", stage: "talking", handles: [], instagram: null,
  metAt: null, metVia: null, endedAt: null, age: null, city: null, work: null,
  remember: [], greenFlags: [], redFlags: [], notes: null, lessons: null,
  insights: null, insightsAt: null, lastMessageAt: null, createdAt: "2026-09-26T12:00:00Z",
};
let current: ReturnType<typeof useDatingPerson>;
let error: string | null;
let root: Root;
let container: HTMLDivElement;
function Harness() {
  const [failure, setError] = useState<string | null>(null);
  current = useDatingPerson(initial, setError);
  error = failure;
  return <div>{current.person.name}</div>;
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (fields: Partial<DatingPersonDTO>) => ({ ok: true, json: async () => ({ person: { ...initial, ...fields } }) });
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("queued person saves", () => {
  it.each(["http", "network"])("rolls back a failed %s save and permits retry", async (kind) => {
    const fetch = vi.fn();
    if (kind === "http") fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Save rejected" }) });
    else fetch.mockRejectedValueOnce(new Error("offline"));
    fetch.mockResolvedValueOnce(response({ name: "Anabelle" }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => current.patch({ name: "Anabelle" }));
    expect(current.person.name).toBe("Ana");
    expect(error).toBeTruthy();
    await act(async () => current.patch({ name: "Anabelle" }));
    expect(current.person.name).toBe("Anabelle");
    expect(error).toBeNull();
  });

  it("serializes rapid saves and keeps the newer optimistic value after the first response", async () => {
    const first = deferred();
    const second = deferred();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetch);
    let save1!: Promise<void>;
    let save2!: Promise<void>;
    await act(async () => {
      save1 = current.patch({ stage: "dating" });
      save2 = current.patch({ stage: "exclusive" });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(current.person.stage).toBe("exclusive");
    await act(async () => { first.resolve(response({ stage: "dating" })); await save1; });
    expect(current.person.stage).toBe("exclusive");
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(response({ stage: "exclusive" })); await save2; });
    expect(current.person.stage).toBe("exclusive");
  });

  it("drops only the failed change while a later field save completes", async () => {
    const first = deferred();
    const second = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    let save1!: Promise<void>;
    let save2!: Promise<void>;
    await act(async () => {
      save1 = current.patch({ name: "Anabelle" });
      save2 = current.patch({ city: "Brooklyn" });
    });
    await act(async () => { first.reject(new Error("offline")); await save1; });
    expect(current.person).toMatchObject({ name: "Ana", city: "Brooklyn" });
    await act(async () => { second.resolve(response({ city: "Brooklyn" })); await save2; });
    expect(current.person).toMatchObject({ name: "Ana", city: "Brooklyn" });
    expect(error).toBeTruthy(); // a queued success must not hide the earlier lost edit
  });

  it("normalizes optimistic phone input without changing the request body", async () => {
    const pending = deferred();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    let save!: Promise<void>;
    await act(async () => { save = current.patch({ handles: "(415) 555-0134" }); });
    expect(current.person.handles).toEqual(["+14155550134"]);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ handles: "(415) 555-0134" });
    await act(async () => { pending.reject(new Error("offline")); await save; });
    expect(current.person.handles).toEqual([]);
  });

  it("keeps a newer analysis when an older profile response arrives", async () => {
    const pending = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    let save!: Promise<void>;
    await act(async () => { save = current.patch({ stage: "ended" }); });
    await act(async () => current.setPerson({ insights: { summary: "New analysis" } }));
    await act(async () => {
      pending.resolve(response({ stage: "ended", endedAt: "2026-09-26T12:00:00Z" }));
      await save;
    });
    expect(current.person).toMatchObject({
      stage: "ended", endedAt: "2026-09-26T12:00:00Z", insights: { summary: "New analysis" },
    });
  });
});
