// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartCaptureForm } from "./smart-capture-form";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/image-compress", () => ({ compressImage: async (file: File) => file }));
let container: HTMLDivElement, root: Root;
const response = (body: unknown) => ({ ok: true, json: async () => body });
const button = (label: string) => [...container.querySelectorAll("button")].find(b => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
async function input(text: string) {
  await act(async () => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); router.push.mockReset(); router.refresh.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SmartCaptureForm />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
describe("capture form intake identity", () => {
  it("reuses its request and original text on Save retry, then announces a successful save", async () => {
    const proposal = { type: "asset", assetKind: "media", title: "Article", photoUrl: "https://files.example.test/photo.jpg" };
    const fetcher = vi.fn().mockResolvedValueOnce(response({ proposal })).mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const saved = vi.fn(); window.addEventListener("personalos:capture-saved", saved);
    await input("Read https://example.test/article"); await click("Parse with Claude"); await click("Approve & save");
    expect(saved).not.toHaveBeenCalled(); await click("Approve & save");
    const first = fetcher.mock.calls[1][1], second = fetcher.mock.calls[2][1];
    expect(first.body).toBe(second.body);
    const body = JSON.parse(first.body);
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/); expect(first.headers["X-Capture-ID"]).toBe(body.requestId);
    expect(body.input).toEqual({ text: "Read https://example.test/article", url: "https://example.test/article" });
    expect(body.proposal.photoUrl).toBe(proposal.photoUrl);
    expect(saved).toHaveBeenCalledOnce(); expect(router.push).toHaveBeenCalledWith("/media");
    window.removeEventListener("personalos:capture-saved", saved);
  });
  it("keeps the uploaded photo reference and metadata without sending its preview bytes", async () => {
    const proposal = { type: "asset", assetKind: "inventory", title: "Lamp", photoUrl: "https://files.example.test/lamp.jpg" };
    const fetcher = vi.fn().mockResolvedValueOnce(response({ proposal })).mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("FileReader", class {
      result = "data:image/jpeg;base64,cHJldmlldyBieXRlcw==";
      onload: (() => void) | null = null;
      readAsDataURL() { this.onload?.(); }
      abort() {}
    });
    const photo = new File(["photo bytes"], "lamp.jpg", { type: "image/jpeg" });
    const field = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      Object.defineProperty(field, "files", { value: [photo] });
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await input("Vintage lamp"); await click("Parse with Claude"); await click("Approve & save");
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.proposal.photoUrl).toBe(proposal.photoUrl);
    expect(body.input.files).toEqual([{ name: "lamp.jpg", mimeType: "image/jpeg", size: photo.size, url: proposal.photoUrl }]);
    expect(fetcher.mock.calls[1][1].body).not.toContain("base64");
  });
  it("starts a new capture ID after Discard even when the text repeats", async () => {
    const proposal = { type: "todo", title: "Repeated", notes: null };
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/parse")) return response({ proposal });
      throw Error("Offline");
    }); vi.stubGlobal("fetch", fetcher);
    await input("Repeated"); await click("Parse with Claude"); await click("Approve & save");
    const first = JSON.parse(fetcher.mock.calls[1][1].body).requestId;
    await click("Discard"); await input("Repeated"); await click("Parse with Claude"); await click("Approve & save");
    const second = JSON.parse(fetcher.mock.calls[3][1].body).requestId;
    expect(first).toBeTypeOf("string"); expect(second).toBeTypeOf("string"); expect(first).not.toBe(second);
  });
});
