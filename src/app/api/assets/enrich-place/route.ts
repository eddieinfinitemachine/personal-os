import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  NOMINATIM_HEADERS,
  composeLocation,
  mapCategory,
  type NominatimAddress,
} from "@/lib/place-enrich";

// Enrich a place from a shared Google Maps link — no Places API key needed.
// The shared URL itself carries the place name and coordinates; Nominatim
// (OpenStreetMap) turns the coordinates into a neighborhood + category.

const ALLOWED_HOST = /(^|\.)google\.[a-z.]{2,6}$|(^|\.)goo\.gl$/i;

function assertAllowed(u: string): URL {
  const url = new URL(u);
  if (url.protocol !== "https:" || !ALLOWED_HOST.test(url.hostname)) {
    throw new Error("Only Google Maps links are supported.");
  }
  return url;
}

async function expandUrl(input: string): Promise<string> {
  let current = input;
  for (let hop = 0; hop < 5; hop++) {
    const url = assertAllowed(current);
    // Google's EU consent interstitial carries the real target in ?continue=
    if (url.hostname.startsWith("consent.")) {
      const cont = url.searchParams.get("continue");
      if (cont) {
        current = cont;
        continue;
      }
    }
    if (url.pathname.includes("/maps/place/")) return current;
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (personal-os place enrichment)" },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    // Some short links resolve to an HTML page that embeds the full URL.
    const html = await res.text();
    const m = html.match(/https:\/\/www\.google\.com\/maps\/place\/[^"'\\\s]+/);
    if (m) return m[0].replace(/\\u0026/g, "&");
    return current;
  }
  return current;
}

function parseMapsUrl(u: string): {
  title: string | null;
  lat: number | null;
  lng: number | null;
} {
  const url = new URL(u);
  let title: string | null = null;
  const place = url.pathname.match(/\/maps\/place\/([^/]+)/);
  if (place) {
    try {
      title = decodeURIComponent(place[1].replace(/\+/g, " ")).trim();
    } catch {
      title = place[1].replace(/\+/g, " ").trim();
    }
  }
  if (!title) {
    const q = url.searchParams.get("q");
    if (q && !/^-?\d+(\.\d+)?\s*,/.test(q)) title = q.trim();
  }
  // The !3d…!4d… pair is the place marker itself; @lat,lng is just the viewport.
  let lat: number | null = null;
  let lng: number | null = null;
  const marker = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const viewport = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  // Dropped-pin shares: /maps/search/<lat>,+<lng> or ?q=<lat>,<lng>
  const pin = decodeURIComponent(url.pathname + " " + (url.searchParams.get("q") ?? ""))
    .replace(/\+/g, " ")
    .match(/(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  const pair = marker ?? viewport ?? pin;
  if (pair) {
    lat = Number(pair[1]);
    lng = Number(pair[2]);
  }
  return { title, lat, lng };
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  try {
    const expanded = await expandUrl(body.url.trim());
    const { title, lat, lng } = parseMapsUrl(expanded);

    const UA = NOMINATIM_HEADERS;
    let location: string | null = null;
    let category: string | null = null;
    if (lat != null && lng != null) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`,
        { headers: UA }
      );
      if (res.ok) {
        const geo = (await res.json()) as {
          category?: string;
          type?: string;
          address?: NominatimAddress;
        };
        if (geo.address) location = composeLocation(geo.address);
        category = mapCategory(geo.category, geo.type);
      }
      // The coordinate often lands on the building, not the venue — retry by
      // name in a small box around the marker to recover the venue type.
      if (!category && title) {
        const box = 0.002; // ~200m
        const viewbox = `${lng - box},${lat + box},${lng + box},${lat - box}`;
        const res2 = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(title)}&viewbox=${viewbox}&bounded=1&limit=1&accept-language=en`,
          { headers: UA }
        );
        if (res2.ok) {
          const hits = (await res2.json()) as { category?: string; type?: string }[];
          if (hits[0]) category = mapCategory(hits[0].category, hits[0].type);
        }
      }
    }

    if (!title && !location && !category) {
      return NextResponse.json(
        { error: "Couldn't read a place from that link." },
        { status: 422 }
      );
    }
    return NextResponse.json({ title, location, category });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Enrichment failed." },
      { status: 422 }
    );
  }
}
