import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const popup = readFileSync(new URL("./popup.js", import.meta.url), "utf8");
const response = (data = { ok: true }) => ({ ok: true, json: async () => data });
function backgroundContext(fetcher: ReturnType<typeof vi.fn>, sessionData: Record<string, unknown> = {}) {
  let extraction = 0;
  const context = {
    crypto: { randomUUID }, URL, fetch: fetcher,
    chrome: {
      storage: {
        local: { get: async () => ({ token: "test-token", endpoint: "https://example.test" }) },
        session: {
          get: async (key: string | null) => key ? { [key]: sessionData[key] } : { ...sessionData },
          set: async (data: Record<string, unknown>) => Object.assign(sessionData, data),
          remove: async (keys: string[]) => { for (const key of keys) delete sessionData[key]; },
        },
      },
      runtime: { onInstalled: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() }, openOptionsPage: vi.fn() },
      notifications: { create: vi.fn() }, commands: { onCommand: { addListener: vi.fn() } },
      contextMenus: { onClicked: { addListener: vi.fn() } },
      scripting: { executeScript: vi.fn(async () => [{ result: { html: `page ${++extraction}`, title: "Page" } }]) },
    },
  };
  runInNewContext(background, context); return context;
}
describe("Chrome capture requests", () => {
  it.each([
    ['sendCapture({ text: "Read this", url: "https://example.test/page", requestId: "same-action" })', "/api/capture/smart/auto"],
    ['saveToBoard({ url: "https://example.test/page", requestId: "same-action" })', "/api/board"],
    ['saveReadLater({ tab: { id: 1, url: "https://example.test/page" }, requestId: "same-action" })', "/api/reader"],
  ])("keeps its action identity and payload on retry for %s", async (call, path) => {
    const fetcher = vi.fn().mockRejectedValueOnce(Error("Offline")).mockResolvedValue(response());
    const context = backgroundContext(fetcher);
    await runInNewContext(call, context); await runInNewContext(call, context);
    expect(fetcher.mock.calls[0][0]).toBe(`https://example.test${path}`);
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ "X-Capture-Source": "chrome", "X-Capture-ID": "same-action" });
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("retains Reader HTML when the background saved but the popup missed its reply", async () => {
    const fetcher = vi.fn().mockResolvedValue(response()); const context = backgroundContext(fetcher);
    const call = 'saveReadLater({ tab: { id: 1, url: "https://example.test/page" }, requestId: "lost-popup-reply" })';
    await runInNewContext(call, context); await runInNewContext(call, context);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("restores the exact Reader body if its service worker restarts before retry", async () => {
    const sessionData = {};
    const fetcher = vi.fn().mockRejectedValueOnce(Error("Offline")).mockResolvedValue(response());
    const first = backgroundContext(fetcher, sessionData);
    const call = 'saveReadLater({ tab: { id: 1, url: "https://example.test/page" }, requestId: "worker-restart" })';
    await runInNewContext(call, first);
    const restarted = backgroundContext(fetcher, sessionData);
    restarted.chrome.scripting.executeScript.mockResolvedValue([{ result: { html: "Changed page", title: "Changed" } }]);
    await runInNewContext(call, restarted);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("uses separate request IDs for deliberate repeated quick-capture actions", async () => {
    const fetcher = vi.fn().mockResolvedValue(response()); const context = backgroundContext(fetcher);
    await runInNewContext('sendCapture({ text: "Repeated" })', context);
    await runInNewContext('sendCapture({ text: "Repeated" })', context);
    const ids = fetcher.mock.calls.map(c => c[1].headers["X-Capture-ID"]);
    expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/); expect(ids[0]).not.toBe(ids[1]);
  });
  it.each(["send", "board", "readLater"])("retains the popup %s action ID on retry and resets it when the note changes", async (action) => {
    const elements = new Map<string, { value: string; focus: () => void; addEventListener: ReturnType<typeof vi.fn> }>();
    for (const id of ["url", "note", "send", "cancel", "readLater", "board", "status", "settings"]) elements.set(id, { value: "Read this", focus: () => {}, addEventListener: vi.fn() });
    const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: "Offline" });
    const context = { crypto: { randomUUID }, document: { getElementById: (id: string) => elements.get(id) }, chrome: { tabs: { query: async () => [{ title: "Page", url: "https://example.test/page" }] }, runtime: { sendMessage } }, setTimeout: vi.fn(), window: { close: vi.fn() } };
    await runInNewContext(popup, context);
    await runInNewContext(`${action}()`, context); await runInNewContext(`${action}()`, context);
    const id = (message: Record<string, any>) => message.payload?.requestId ?? message.requestId;
    expect(id(sendMessage.mock.calls[0][0])).toMatch(/^[a-f0-9-]{36}$/);
    expect(id(sendMessage.mock.calls[0][0])).toBe(id(sendMessage.mock.calls[1][0]));
    elements.get("note")!.addEventListener.mock.calls.find(([event]) => event === "input")?.[1]();
    await runInNewContext(`${action}()`, context);
    expect(id(sendMessage.mock.calls[2][0])).not.toBe(id(sendMessage.mock.calls[0][0]));
  });
});
