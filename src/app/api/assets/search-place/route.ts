import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import {
  NOMINATIM_HEADERS,
  composeLocation,
  mapCategory,
  type NominatimAddress,
} from "@/lib/place-enrich";

// Search places by name for the editor's autocomplete. Each result carries a
// Google Maps link so a picked place round-trips with the enrich flow.

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return NextResponse.json({ results: [] });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=6&addressdetails=1&accept-language=en&dedupe=1`,
    { headers: NOMINATIM_HEADERS }
  );
  if (!res.ok) return NextResponse.json({ results: [] });

  const rows = (await res.json()) as {
    name?: string;
    display_name: string;
    category?: string;
    type?: string;
    address?: NominatimAddress;
  }[];

  const results = rows.map((r) => {
    const title = r.name?.trim() || r.display_name.split(",")[0].trim();
    const location = r.address ? composeLocation(r.address) : null;
    const category = mapCategory(r.category, r.type);
    // Human-readable context for disambiguation in the dropdown.
    const subtitle = r.display_name
      .split(",")
      .slice(1, 4)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${title}, ${subtitle || r.display_name}`
    )}`;
    return { title, subtitle, location, category, url };
  });

  return NextResponse.json({ results });
}
