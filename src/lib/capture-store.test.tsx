// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureProvider, useCapture, type CaptureStore } from "./capture-store";

const proposal = { type: "todo", title: "Read this", notes: null, listName: "Inbox" };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
let container: HTMLDivElement, root: Root, store: CaptureStore;
function Consumer() { store = useCapture(); return null; }
const render = () => act(async () => root.render(<CaptureProvider><Consumer /></CaptureProvider>));
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("queued capture saves", () => {
  it("retries the same committed proposal, action ID and original input after a lost response", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ proposal })).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const saved = vi.fn(); window.addEventListener("personalos:capture-saved", saved);
    await render();
    let id = "";
    await act(async () => { id = store.enqueue("Read https://example.test/article"); });
    await act(async () => store.commit(id));
    expect(store.captures[0].status).toBe("error"); expect(saved).not.toHaveBeenCalled();
    await act(async () => store.retry(id));
    expect(fetcher.mock.calls.map(c => c[0])).toEqual(["/api/capture/smart/parse", "/api/capture/smart/commit", "/api/capture/smart/commit"]);
    const first = fetcher.mock.calls[1][1], second = fetcher.mock.calls[2][1];
    expect(first.body).toBe(second.body);
    expect(first.headers["X-Capture-ID"]).toBe(id);
    expect(JSON.parse(first.body)).toEqual({ requestId: id, input: { text: "Read https://example.test/article", url: "https://example.test/article" }, proposal });
    expect(store.captures[0].status).toBe("saved"); expect(saved).toHaveBeenCalledOnce();
    window.removeEventListener("personalos:capture-saved", saved);
  });
  it("keeps separate IDs for intentional repeated captures and restores failed saves for retry", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ proposal })); vi.stubGlobal("fetch", fetcher); await render();
    let first = "", second = "";
    await act(async () => { first = store.enqueue("Read this"); second = store.enqueue("Read this"); });
    expect(first).not.toBe(second);
    fetcher.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => store.commit(first));
    await act(async () => root.unmount()); root = createRoot(container); await render();
    expect(store.captures.find(c => c.id === first)?.proposal).toEqual(proposal);
    fetcher.mockResolvedValue(response({ ok: true })); await act(async () => store.retry(first));
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/capture/smart/commit");
    expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body).requestId).toBe(first);
  });
});
