import { describe, expect, it, vi } from "vitest";
import {
  isPublicAddress,
  safeFetch,
  type LookupFn,
} from "@/lib/safe-fetch";

const publicLookup: LookupFn = async () => [
  { address: "93.184.216.34", family: 4 },
];

describe("isPublicAddress", () => {
  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "::8.8.8.8",
  ])("accepts public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "169.254.10.20",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.5",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fdff::1",
    "fe80::1",
    "febf::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::127.0.0.1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("safeFetch", () => {
  it.each(["file:///etc/passwd", "ftp://example.com/file"])(
    "rejects unsupported URL %s",
    async (url) => {
      await expect(safeFetch(url, { lookup: publicLookup })).rejects.toThrow(
        /http\(s\)/i,
      );
    },
  );

  it("rejects a hostname when any DNS result is non-public", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      safeFetch("https://example.com", { lookup, fetchImpl }),
    ).rejects.toThrow(/blocked host/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://[::1]/",
  ])("rejects normalized literal address %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      safeFetch(url, { lookup: publicLookup, fetchImpl }),
    ).rejects.toThrow(/blocked host/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalidates redirect destinations before fetching them", async () => {
    const lookup: LookupFn = async (hostname) => [
      {
        address: hostname === "internal.example" ? "127.0.0.1" : "93.184.216.34",
        family: 4,
      },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://internal.example/secret" },
      });
    });

    await expect(
      safeFetch("https://example.com/start", { lookup, fetchImpl }),
    ).rejects.toThrow(/blocked host/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects more than maxRedirects redirects", async () => {
    let hop = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      hop += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: `/hop-${hop}` },
      });
    });

    await expect(
      safeFetch("https://example.com/start", {
        lookup: publicLookup,
        fetchImpl,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/too many redirects/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("aborts when the streamed body exceeds maxBytes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    await expect(
      safeFetch("https://example.com/large", {
        lookup: publicLookup,
        fetchImpl,
        maxBytes: 5,
      }),
    ).rejects.toThrow(/too large/i);
  });

  it("reports request timeouts clearly", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    await expect(
      safeFetch("https://example.com/slow", {
        lookup: publicLookup,
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/timeout/i);
  });

  it("returns a bounded response without throwing for HTTP status codes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response("created", {
        status: 201,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    });

    const result = await safeFetch("https://example.com/resource", {
      lookup: publicLookup,
      fetchImpl,
    });
    expect(result).toEqual({
      url: "https://example.com/resource",
      status: 201,
      contentType: "text/plain; charset=utf-8",
      body: Buffer.from("created"),
    });
  });
});

describe("connection-time address check", () => {
  it("blocks private answers in the socket's own lookup", async () => {
    const { publicOnlyLookup } = await import("@/lib/safe-fetch");
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      publicOnlyLookup("localhost", { all: true }, (e) => resolve(e)),
    );
    expect(err?.message).toMatch(/blocked host: localhost/);
  });

  it("stops a rebinding host whose first answer looked public", async () => {
    // The pre-check is fooled (lookup says public), but the real connection
    // resolves "localhost" again and must be refused.
    const err = await safeFetch("http://localhost:3000/", { lookup: publicLookup, timeoutMs: 5_000 }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error & { cause?: Error }).cause?.message ?? (err as Error).message)).toMatch(/blocked host/);
  });
});
