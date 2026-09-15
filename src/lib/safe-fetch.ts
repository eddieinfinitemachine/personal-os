import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

export const SAFARI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

export type LookupFn = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

type SafeFetchOptions = {
  accept?: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  lookup?: LookupFn;
  fetchImpl?: typeof fetch;
};

export type SafeFetchResult = {
  url: string;
  status: number;
  contentType: string | null;
  body: Buffer;
};

function parseIpv4(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isPublicIpv4([a, b, c, d]: [
  number,
  number,
  number,
  number,
]): boolean {
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a >= 224) return false;
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;
  return true;
}

function parseIpv6(address: string): Uint8Array | null {
  const withoutZone = address.toLowerCase().split("%", 1)[0];
  if (isIP(withoutZone) !== 6) return null;

  let normalized = withoutZone;
  const lastColon = normalized.lastIndexOf(":");
  const dottedTail = normalized.slice(lastColon + 1);
  const ipv4 = parseIpv4(dottedTail);
  if (ipv4) {
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = `${normalized.slice(0, lastColon)}:${high}:${low}`;
  }

  const doubleColon = normalized.indexOf("::");
  if (doubleColon !== normalized.lastIndexOf("::")) return null;

  const left =
    doubleColon >= 0
      ? normalized.slice(0, doubleColon).split(":").filter(Boolean)
      : normalized.split(":");
  const right =
    doubleColon >= 0
      ? normalized.slice(doubleColon + 2).split(":").filter(Boolean)
      : [];
  const missing = 8 - left.length - right.length;
  if (
    (doubleColon >= 0 && missing < 1) ||
    (doubleColon < 0 && missing !== 0)
  ) {
    return null;
  }

  const groups = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => "0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

export function isPublicAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isPublicIpv4(ipv4);

  const ipv6 = parseIpv6(address);
  if (!ipv6) return false;

  const firstTwelveZero = ipv6.slice(0, 12).every((byte) => byte === 0);
  const firstTenZero = ipv6.slice(0, 10).every((byte) => byte === 0);
  const ipv4Mapped =
    firstTenZero && ipv6[10] === 0xff && ipv6[11] === 0xff;
  if (firstTwelveZero || ipv4Mapped) {
    return isPublicIpv4([
      ipv6[12],
      ipv6[13],
      ipv6[14],
      ipv6[15],
    ]);
  }

  if ((ipv6[0] & 0xfe) === 0xfc) return false;
  if (ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0x80) return false;
  if (ipv6[0] === 0xff) return false;
  return true;
}

function parseHttpUrl(raw: string | URL): URL {
  const url = new URL(raw.toString());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be fetched.");
  }
  return url;
}

async function assertPublicHost(url: URL, lookup: LookupFn): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (
    (isIP(hostname) !== 0 && !isPublicAddress(hostname)) ||
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error(`blocked host: ${hostname}`);
  }
}

async function readBody(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new Error(`response too large (maximum ${maxBytes} bytes)`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, byteLength);
}

export async function safeFetch(
  raw: string | URL,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (maxBytes < 0 || timeoutMs <= 0 || maxRedirects < 0) {
    throw new Error("Invalid safeFetch limits.");
  }

  const lookup: LookupFn = opts.lookup ?? dnsLookup;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = new Headers({
    "User-Agent": SAFARI_USER_AGENT,
    ...opts.headers,
  });
  if (opts.accept) headers.set("Accept", opts.accept);

  let url = parseHttpUrl(raw);
  let redirects = 0;

  while (true) {
    await assertPublicHost(url, lookup);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (
        [301, 302, 303, 307, 308].includes(response.status) &&
        response.headers.has("location")
      ) {
        if (redirects >= maxRedirects) {
          throw new Error("too many redirects");
        }
        await response.body?.cancel().catch(() => undefined);
        url = parseHttpUrl(new URL(response.headers.get("location")!, url));
        redirects += 1;
        continue;
      }

      const body = await readBody(response, maxBytes, controller);
      return {
        url: url.toString(),
        status: response.status,
        contentType: response.headers.get("content-type"),
        body,
      };
    } catch (error) {
      if (
        timedOut ||
        (controller.signal.aborted &&
          error instanceof Error &&
          error.name === "AbortError")
      ) {
        throw new Error(`timeout after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
