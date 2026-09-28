// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactLookup, type ContactLookupResult } from "./contact-lookup";
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const checkedAt = "2026-09-28T12:00:00.000Z";
function state(
  status: ContactLookupResult["lookup"]["status"],
  options: Partial<ContactLookupResult> = {},
): ContactLookupResult {
  return {
    lookup: {
      status,
      name: "Ana Reyes",
      checkedAt,
      messagesCheckedAt: null,
      candidates: [],
    },
    messageCount: 0,
    lastMessageAt: null,
    ...options,
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  return {
    promise: new Promise((done) => {
      resolve = done;
    }),
    resolve: (value: unknown) => resolve(value),
  };
}
let container: HTMLDivElement;
let root: Root;
let visibility: "visible" | "hidden";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.refresh.mockReset();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const render = (personId = "ana", name = "Ana Reyes") =>
  act(async () =>
    root.render(<ContactLookup personId={personId} name={name} />),
  );
const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  )!;

describe("automatic contact lookup", () => {
  it("checks every five seconds while waiting and refreshes when messages arrive", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(state("pending")))
      .mockResolvedValueOnce(response(state("matched")))
      .mockResolvedValue(
        response(
          state("matched", { messageCount: 8, lastMessageAt: checkedAt }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(container.textContent).toContain("Finding her in Contacts");
    expect(container.textContent).toContain(
      "within a minute while your Mac is awake",
    );
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toContain("Checking matching messages");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toBe("");
    expect(navigation.refresh).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("finishes honestly when the Mac found no messages", async () => {
    const data = state("matched");
    data.lookup.messagesCheckedAt = checkedAt;
    const fetch = vi.fn().mockResolvedValue(response(data));
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(container.textContent).toContain("No matching messages found yet");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledOnce();
    expect(button("Check again")).toBeTruthy();
  });

  it.each([0, 10])("reports blocked message access even with %i existing messages", async (messageCount) => {
    const data = state("matched", { messageCount });
    data.lookup.messagesError = true;
    const fetch = vi.fn().mockResolvedValue(response(data));
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(container.textContent).toContain("could not check messages");
    expect(container.textContent).toContain("Check iMessage access");
    expect(button("Check again")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires a contact choice and preserves options after a failed save", async () => {
    const data = state("ambiguous");
    data.lookup.candidates = [
      { name: "Ana Reyes", phones: ["+14155550111"], emails: [] },
      {
        name: "Ana Reyes",
        phones: ["+14155550112"],
        emails: ["ana@example.test"],
      },
    ];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(data))
      .mockResolvedValueOnce(
        response({ error: "That contact changed. Check again." }, false),
      )
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValue(response(state("matched")));
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(fetch).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("ana@example.test");
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>("li button")[1].click(),
    );
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      action: "choose",
      index: 1,
      checkedAt,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "That contact changed",
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>("li button")[1].click(),
    );
    expect(container.textContent).toContain("Contact found");
  });

  it.each([
    ["not_found", "full name saved in Contacts"],
    ["insufficient_name", "Add her full name above"],
    ["unavailable", "contact access needs attention"],
  ] as const)(
    "provides an actionable %s result and retry",
    async (status, text) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response(state(status)))
        .mockResolvedValueOnce(response({ ok: true }))
        .mockResolvedValue(response(state("pending")));
      vi.stubGlobal("fetch", fetch);
      await render();
      expect(container.textContent).toContain(text);
      await act(async () => button("Check again").click());
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
        action: "retry",
      });
      expect(container.textContent).toContain("Finding her in Contacts");
    },
  );

  it("rejects old reads after changing to another person", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(response(state("not_found")));
    vi.stubGlobal("fetch", fetch);
    await render();
    await render("bea", "Bea Smith");
    await act(async () =>
      old.resolve(response(state("matched", { messageCount: 12 }))),
    );
    expect(container.textContent).toContain("No matching contact found");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("ignores an old lookup read that finishes after a retry", async () => {
    const old = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(state("not_found")))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValue(response(state("pending")));
    vi.stubGlobal("fetch", fetch);
    await render();
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await act(async () => button("Check again").click());
    await act(async () =>
      old.resolve(response(state("matched", { messageCount: 12 }))),
    );
    expect(container.textContent).toContain("Finding her in Contacts");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("pauses hidden-page polling and resumes on return", async () => {
    const fetch = vi.fn().mockResolvedValue(response(state("pending")));
    vi.stubGlobal("fetch", fetch);
    visibility = "hidden";
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).not.toHaveBeenCalled();
    visibility = "visible";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(fetch).toHaveBeenCalledOnce();
    visibility = "hidden";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledOnce();
    visibility = "visible";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops claiming active work when the Mac has not checked yet", async () => {
    const fetch = vi.fn().mockResolvedValue(response(state("pending")));
    vi.stubGlobal("fetch", fetch);
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(container.textContent).toContain("Waiting for your Mac");
    const calls = fetch.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(fetch).toHaveBeenCalledTimes(calls);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(fetch).toHaveBeenCalledTimes(calls + 1);
  });

  it("keeps choices disabled during duplicate clicks and ignores old-person saves", async () => {
    const saving = deferred();
    const data = state("ambiguous");
    data.lookup.candidates = [
      { name: "Ana Reyes", phones: ["+14155550111"], emails: [] },
    ];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(data))
      .mockReturnValueOnce(saving.promise)
      .mockResolvedValue(response(state("not_found")));
    vi.stubGlobal("fetch", fetch);
    await render();
    await act(async () => {
      button("Use this contact").click();
      button("Use this contact").click();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(button("Use this contact").disabled).toBe(true);
    await render("bea", "Bea Smith");
    await act(async () => saving.resolve(response({ ok: true })));
    expect(container.textContent).toContain("No matching contact found");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("shows failed reads as retryable errors instead of an endless progress claim", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not check saved contacts",
    );
    expect(button("Check again")).toBeTruthy();
  });
});
