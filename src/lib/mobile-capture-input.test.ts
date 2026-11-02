import { describe, expect, it } from "vitest";
import { readMobileCapture, MobileCaptureError, mobileCaptureHash, mobileReceiptId } from "./mobile-capture-input";
const requestId = "12345678-1234-4234-8234-123456789abc";
const json = (body: unknown, headers: Record<string, string> = {}) => new Request("https://example.com/api/capture/mobile", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("mobile capture input", () => {
  it("accepts URL-only captures", async () => {
    const input = await readMobileCapture(json({ requestId, text: "", url: "https://example.com/article" }));
    expect(input.text).toBe(""); expect(input.url).toBe("https://example.com/article");
  });
  it("rejects empty captures and invalid identifiers", async () => {
    await expect(readMobileCapture(json({ requestId, text: " " }))).rejects.toMatchObject({ status: 400 });
    await expect(readMobileCapture(json({ requestId: "x", text: "hello" }))).rejects.toBeInstanceOf(MobileCaptureError);
  });
  it("rejects unsupported links and wrong field types", async () => {
    await expect(readMobileCapture(json({ requestId, text: 5 }))).rejects.toMatchObject({ status: 400 });
    await expect(readMobileCapture(json({ requestId, text: "hello", url: "file:///etc/passwd" }))).rejects.toMatchObject({ status: 400 });
  });
  it("enforces actual bytes without trusting Content-Length", async () => {
    const request = new Request("https://example.com", { method: "POST", headers: { "content-type": "application/json", "content-length": "20" }, body: JSON.stringify({ requestId, text: "x".repeat(3_500_001) }) });
    await expect(readMobileCapture(request)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects too much text and too many attachments", async () => {
    await expect(readMobileCapture(json({ requestId, text: "x".repeat(50_001) }))).rejects.toMatchObject({ status: 400 });
    const form = new FormData(); form.append("requestId", requestId);
    for (let i = 0; i < 11; i++) form.append("file", new File(["x"], `${i}.txt`, { type: "text/plain" }));
    await expect(readMobileCapture(new Request("https://example.com", { method: "POST", body: form }))).rejects.toMatchObject({ status: 400 });
  });
  it("preserves multipart files and rejects duplicate scalar fields", async () => {
    const form = new FormData(); form.append("requestId", requestId); form.append("text", "receipt"); form.append("file", new File(["image bytes"], "receipt.jpg", { type: "image/jpeg" }));
    const input = await readMobileCapture(new Request("https://example.com", { method: "POST", body: form }));
    expect(input.files[0].name).toBe("receipt.jpg"); expect(await input.files[0].text()).toBe("image bytes");
    form.append("requestId", requestId);
    await expect(readMobileCapture(new Request("https://example.com", { method: "POST", body: form }))).rejects.toMatchObject({ status: 400 });
  });
  it("hashes file contents and scopes receipts to users", async () => {
    const input = await readMobileCapture(json({ requestId, text: "hello" }));
    expect(await mobileCaptureHash(input)).toBe(await mobileCaptureHash({ ...input }));
    expect(await mobileCaptureHash(input)).not.toBe(await mobileCaptureHash({ ...input, text: "different" }));
    expect(mobileReceiptId("alice", requestId)).not.toBe(mobileReceiptId("bob", requestId));
    expect(mobileReceiptId("alice", requestId.toUpperCase())).toBe(mobileReceiptId("alice", requestId));
    const a = { ...input, files: [new File(["a"], "image.jpg", { type: "image/jpeg" })] };
    const b = { ...input, files: [new File(["b"], "image.jpg", { type: "image/jpeg" })] };
    expect(await mobileCaptureHash(a)).not.toBe(await mobileCaptureHash(b));
  });
});
