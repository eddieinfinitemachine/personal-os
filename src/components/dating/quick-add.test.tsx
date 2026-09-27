// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickAdd } from "./quick-add";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const paragraph = "Ana Reyes — we met through a friend.\nWe broke up, but I don't remember the dates.";
const extracted = {
  name: "Ana Reyes", stage: "ended", handles: [], instagram: null, metVia: "A friend",
  metAt: null, endedAt: null, age: null, city: null, work: null, notes: paragraph,
  remember: ["Enjoys hiking"], greenFlags: [], redFlags: [], lessons: null,
};
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const prepared = (draft = extracted) => response({ draft, warnings: [], existingPerson: null });
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.refresh.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QuickAdd onClose={() => {}} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const input = (id: string) => container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#qa-${id}`)!;
async function fill(id: string, value: string) {
  await act(async () => {
    const element = input(id);
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
const click = async (label: string) => act(async () => button(label).click());
const submitTwice = async () => act(async () => {
  const form = container.querySelector("form")!;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
});
async function prepare() { await fill("context", paragraph); await click("Fill in details"); }
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }

describe("paragraph dating quick add", () => {
  it("sends the paragraph with today's local date and keeps unknown dates blank", async () => {
    const fetch = vi.fn().mockResolvedValue(prepared()); vi.stubGlobal("fetch", fetch);
    await prepare();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    expect(fetch).toHaveBeenCalledWith("/api/dating/prepare", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ text: paragraph, today });
    expect(input("metat").value).toBe(""); expect(input("endedat").value).toBe("");
    expect(input("notes").value).toBe(paragraph);
    expect(container.querySelector("h2")?.textContent).toBe("Check the details");
  });

  it("preserves the paragraph after a network failure and allows retry", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(prepared()); vi.stubGlobal("fetch", fetch);
    await prepare();
    expect(input("context").value).toBe(paragraph);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(button("Fill in details").disabled).toBe(false);
    await click("Fill in details");
    expect(input("name").value).toBe("Ana Reyes"); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("saves reviewed edits and original context while preserving unknown endedAt as null", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response({ person: { id: "new-person", name: "Anna Reyes" } }));
    vi.stubGlobal("fetch", fetch); await prepare();
    await fill("name", "Anna Reyes"); await fill("phone", "+14155550134"); await fill("instagram", "@anna.reyes");
    await fill("metat", "2025-07-04"); await fill("city", "Brooklyn");
    await click("Add person");
    expect(fetch.mock.calls[1][0]).toBe("/api/dating");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      name: "Anna Reyes", handles: "+14155550134", instagram: "@anna.reyes", metAt: "2025-07-04T12:00:00.000Z", endedAt: null,
      notes: paragraph, city: "Brooklyn", remember: ["Enjoys hiking"], stage: "ended",
    });
    expect(container.querySelector('a[href="/dating/new-person"]')).not.toBeNull();
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it.each(["network", "server"])("retains reviewed fields after a %s save failure and allows retry", async (kind) => {
    const fetch = vi.fn().mockResolvedValueOnce(prepared());
    if (kind === "network") fetch.mockRejectedValueOnce(new Error("offline"));
    else fetch.mockResolvedValueOnce(response({ error: "Could not save" }, false));
    fetch.mockResolvedValueOnce(response({ person: { id: "saved", name: "Ana Reyes" } }));
    vi.stubGlobal("fetch", fetch); await prepare(); await fill("notes", `${paragraph}\nExtra detail.`); await fill("phone", "+14155550134");
    await click("Add person");
    expect(input("notes").value).toBe(`${paragraph}\nExtra detail.`); expect(input("phone").value).toBe("+14155550134");
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); expect(button("Add person").disabled).toBe(false);
    await click("Add person");
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body); expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("offers the existing page without silently creating another person", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ draft: extracted, warnings: ["Check the matching saved record."], existingPerson: { id: "existing", name: "Ana Reyes" } }));
    vi.stubGlobal("fetch", fetch); await prepare();
    expect(container.querySelector('a[href="/dating/existing"]')?.textContent).toContain("Open existing page");
    expect(container.textContent).toContain("Only add another if this is a different person.");
    expect(fetch).toHaveBeenCalledTimes(1);
    await fill("name", "Another Person"); expect(container.querySelector('a[href="/dating/existing"]')).toBeNull();
  });

  it("blocks duplicate prepare and save submissions while requests are pending", async () => {
    const first = deferred(); const second = deferred();
    const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); vi.stubGlobal("fetch", fetch);
    await fill("context", paragraph); await submitTwice();
    expect(fetch).toHaveBeenCalledTimes(1); expect(input("context").disabled).toBe(true);
    await act(async () => first.resolve(prepared()));
    await submitTwice();
    expect(fetch).toHaveBeenCalledTimes(2); expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await act(async () => second.resolve(response({ person: { id: "saved", name: "Ana Reyes" } })));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("requires an explicit stage and supports manual entry without preparing", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ person: { id: "manual", name: "Ana Reyes" } })); vi.stubGlobal("fetch", fetch);
    await fill("context", paragraph); await click("Enter details myself"); await fill("name", "Ana Reyes");
    expect(input("notes").value).toBe(paragraph); expect(input("metat").value).toBe(""); expect(button("Add person").disabled).toBe(true);
    await fill("stage", "talking"); expect(input("stage").textContent).toContain("Pursuing");
    await click("Add person"); expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ notes: paragraph, metAt: null, endedAt: null, stage: "talking" });
  });

  it("clears a previous person's contact and matching record when switching to manual entry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({
        draft: { ...extracted, handles: ["+14155550134"] },
        warnings: ["Details came from Ana's saved contact."],
        existingPerson: { id: "ana-existing", name: "Ana Reyes" },
      }))
      .mockResolvedValueOnce(response({ person: { id: "bea-new", name: "Bea Smith" } }));
    vi.stubGlobal("fetch", fetch);
    await prepare();
    expect(input("phone").value).toBe("+14155550134");
    await click("Back to paragraph");
    await fill("context", "Bea Smith — I'd like to ask her out.");
    await click("Enter details myself");
    expect(input("phone").value).toBe("");
    expect(container.querySelector('a[href="/dating/ana-existing"]')).toBeNull();
    expect(container.textContent).not.toContain("Details came from Ana's saved contact.");
    await fill("name", "Bea Smith");
    await fill("stage", "talking");
    await click("Add person");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      name: "Bea Smith", handles: "", notes: "Bea Smith — I'd like to ask her out.",
    });
  });
});
