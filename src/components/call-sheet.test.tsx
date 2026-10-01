// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallSheet } from "./call-sheet";
import type { CallSheetResponse } from "@/lib/call-sheet/types";
const now = new Date("2026-09-28T12:00:00Z");
function sheet(): CallSheetResponse {
  return { day: { id: "day", localDate: "2026-09-28", version: 0 }, timezone: "America/New_York", hidden: [], upcoming: [],
    sources: { imessage: { enabled: true, status: "ready", lastSuccessAt: now.toISOString(), error: null }, whatsapp: { enabled: false, status: "not_connected", lastSuccessAt: null, error: null } },
    entries: [{ id: "entry", personId: "person", name: "Avery Example", imageUrl: null, phone: "+15551234567", email: "avery@example.test", reason: "Time for a check-in.", topic: "Ask how the project went.", lastContactAt: "2026-08-01T12:00:00Z", lastContactSource: "imessage", status: "pending", cadenceDays: 30, cues: [{ kind: "topic", text: "Ask how the project went.", evidence: [{ source: "imessage", messageId: "m1", sentAt: "2026-08-01T12:00:00Z", excerpt: "Starting the project next week." }] }] }] };
}
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = () => act(async () => root.render(<CallSheet />));
const button = (label: string) => [...container.querySelectorAll("button")].find(b => b.textContent === label)!;
describe("daily call sheet", () => {
  it("renders grounded context collapsed and never links to the dialer or Messages", async () => {
    const fetch = vi.fn().mockResolvedValue(response(sheet())); vi.stubGlobal("fetch", fetch); await render();
    expect(container.textContent).toContain("Avery Example"); expect(container.textContent).toContain("Ask how the project went.");
    expect(container.querySelector("blockquote")!.closest("details")!.open).toBe(false);
    expect(container.querySelector('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]')).toBeNull();
    expect(button("Call").getAttribute("aria-label")).toBe("Log a call with Avery Example");
    expect(button("Text").getAttribute("aria-label")).toBe("Log a text with Avery Example");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("asks before saving, pauses refresh while choosing, and cancels without a check-in", async () => {
    const fetch = vi.fn().mockResolvedValue(response(sheet())); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Done").click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("How did you reach out?");
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => button("Cancel").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("0 of 1 checked in");
    expect(fetch).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("sends WhatsApp and keeps the choice available after a save failure", async () => {
    const done = sheet(); done.entries[0].status = "done"; done.entries[0].method = "whatsapp";
    const fetch = vi.fn().mockResolvedValueOnce(response(sheet())).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response(done));
    vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Done").click());
    await act(async () => button("WhatsApp").click());
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe("Offline");
    await act(async () => button("WhatsApp").click());
    expect(JSON.parse(fetch.mock.calls[2][1].body).method).toBe("whatsapp");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("1 of 1 checked in");
  });
  it("logs a call from the row without asking, with the current version, and supports the server undo token", async () => {
    const done = sheet(); done.day.version = 1; done.entries[0].status = "done"; done.entries[0].method = "call"; done.undoToken = "undo";
    const fetch = vi.fn().mockResolvedValueOnce(response(sheet())).mockResolvedValueOnce(response(done)).mockResolvedValueOnce(response(sheet())); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Call").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ dayId: "day", version: 0, entryId: "entry", action: "done", method: "call" });
    expect(container.textContent).toContain("1 of 1 checked in");
    expect(button("Call")).toBeUndefined();
    await act(async () => button("Undo last change").click());
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ dayId: "day", version: 1, action: "undo", undoToken: "undo" });
    expect(container.textContent).toContain("0 of 1 checked in");
  });
  it("logs a text from the row as a text check-in", async () => {
    const done = sheet(); done.entries[0].status = "done"; done.entries[0].method = "text";
    const fetch = vi.fn().mockResolvedValueOnce(response(sheet())).mockResolvedValueOnce(response(done)); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Text").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ dayId: "day", version: 0, entryId: "entry", action: "done", method: "text" });
    expect(container.textContent).toContain("1 of 1 checked in");
  });
  it("refreshes conflicts without replaying the action", async () => {
    const latest = sheet(); latest.day.version = 4;
    const fetch = vi.fn().mockResolvedValueOnce(response(sheet())).mockResolvedValueOnce(response({}, 409)).mockResolvedValueOnce(response(latest)); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Call").click());
    expect(container.textContent).toContain("Review the refreshed list");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.filter(c => c[1]?.method === "POST")).toHaveLength(1);
  });
  it("keeps the current row on failure and allows retry", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(sheet())).mockRejectedValueOnce(new Error("Offline")); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Call").click());
    expect(container.textContent).toContain("Offline"); expect(button("Call").disabled).toBe(false); expect(button("Done").disabled).toBe(false);
    expect(container.textContent).toContain("0 of 1 checked in");
  });
  it("shows authentication and initial load failures honestly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 401))); await render();
    expect(container.textContent).toContain("Sign in again"); expect(button("Refresh")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
  it("snoozes, hides, and changes sources only from explicit clicks", async () => {
    const fetch = vi.fn().mockResolvedValue(response(sheet())); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Remind me in a week").click());
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ action: "snooze", days: 7 });
    await act(async () => button("Don’t suggest").click());
    expect(JSON.parse(fetch.mock.calls[2][1].body).action).toBe("hide");
    await act(async () => button("Use WhatsApp").click());
    expect(fetch.mock.calls[3][0]).toBe("/api/call-sheet/settings");
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ source: "whatsapp", enabled: true });
  });
  it("adds someone for a day by parsing with the type pinned, committing without a preview, and reloading", async () => {
    const withGrace = sheet(); withGrace.upcoming = [{ personId: "grace", name: "Grace Kotick", dueOn: "2026-10-06", note: null }];
    const proposal = { type: "call_sheet", firstName: "Grace", lastName: "Kotick", date: "2026-10-06", note: null };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(sheet()))
      .mockResolvedValueOnce(response({ proposal }))
      .mockResolvedValueOnce(response({ callSheet: { personId: "grace" }, message: "Grace Kotick will be on your call sheet Tue, Oct 6" }))
      .mockResolvedValueOnce(response(withGrace));
    vi.stubGlobal("fetch", fetch); await render();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Add someone for a day"]')!;
    expect(input.placeholder).toBe("Add someone for a day — “Grace Kotick Tuesday”");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Grace Kotick Tuesday");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(fetch.mock.calls[1][0]).toBe("/api/capture/smart/parse");
    const form = fetch.mock.calls[1][1].body as FormData;
    expect(form.get("text")).toBe("Grace Kotick Tuesday");
    expect(form.get("forceType")).toBe("call_sheet");
    expect(fetch.mock.calls[2][0]).toBe("/api/capture/smart/commit");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ proposal });
    expect(fetch.mock.calls[3][0]).toBe("/api/call-sheet");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Grace Kotick will be on your call sheet Tue, Oct 6");
    expect(input.value).toBe("");
    expect(container.textContent).toContain("Grace Kotick · Tue, Oct 6");
  });
  it("shows an ambiguous name without guessing and keeps the text", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(sheet()))
      .mockResolvedValueOnce(response({ proposal: { type: "call_sheet", firstName: "Grace", lastName: null, date: "2026-09-29", note: null } }))
      .mockResolvedValueOnce(response({ error: "More than one person is called Grace: Grace Dayan, Grace Kotick. Use their full name.", candidates: ["Grace Dayan", "Grace Kotick"] }, 409))
      .mockResolvedValueOnce(response(sheet()));
    vi.stubGlobal("fetch", fetch); await render();
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Add someone for a day"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Grace tomorrow");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Grace Dayan, Grace Kotick");
    expect(input.value).toBe("Grace tomorrow");
    expect(button("Add").disabled).toBe(false);
  });
  it("shows upcoming reminders, cancels one, and shows a reminder's note on its row", async () => {
    const data = sheet();
    data.entries[0].reminder = { note: "the lease" }; data.entries[0].reason = "You asked to be reminded today.";
    data.upcoming = [{ personId: "maya", name: "Maya Example", dueOn: "2026-10-02", note: "her trip" }];
    const cancelled = sheet(); cancelled.day.version = 1;
    const fetch = vi.fn().mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(cancelled)); vi.stubGlobal("fetch", fetch); await render();
    expect(container.textContent).toContain("the lease");
    expect(container.textContent).not.toContain("Ask how the project went.");
    expect(container.textContent).toContain("Maya Example · Fri, Oct 2 · her trip");
    const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel reminder for Maya Example"]')!;
    await act(async () => cancel.click());
    expect(fetch.mock.calls[1][0]).toBe("/api/call-sheet/reminders");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ personId: "maya", dueOn: null });
    expect(container.textContent).not.toContain("Maya Example");
    expect(container.textContent).not.toContain("Upcoming");
  });
  it("does not poll while a save is pending or after unmount", async () => {
    let finish!: (r: unknown) => void;
    const fetch = vi.fn().mockResolvedValueOnce(response(sheet())).mockImplementationOnce(() => new Promise(r => { finish = r; })); vi.stubGlobal("fetch", fetch); await render();
    await act(async () => button("Call").click());
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => finish(response(sheet())));
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(fetch).toHaveBeenCalledTimes(2);
    root = createRoot(container);
  });
});
