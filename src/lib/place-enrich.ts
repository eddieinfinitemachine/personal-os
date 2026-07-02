// Shared helpers for place enrichment/search via Nominatim (OpenStreetMap).
// Keyless by design — swap these call sites for Google Places if a
// GOOGLE_MAPS_API_KEY ever lands in the env.

export const NOMINATIM_HEADERS = {
  "User-Agent": "personal-os/1.0 (place enrichment)",
};

export type NominatimAddress = Record<string, string | undefined>;

export function composeLocation(addr: NominatimAddress): string | null {
  const hood = addr.neighbourhood ?? addr.suburb ?? addr.quarter;
  const city =
    addr.borough ?? addr.city_district ?? addr.city ?? addr.town ?? addr.village;
  const seen = new Set<string>();
  const out = [hood, city].filter((p): p is string => {
    if (!p || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  return out.length ? out.join(", ") : null;
}

export function mapCategory(category?: string, type?: string): string | null {
  const t = type ?? "";
  if (category === "shop") return "shop";
  switch (t) {
    case "restaurant":
    case "fast_food":
    case "food_court":
      return "restaurant";
    case "cafe":
      return "cafe";
    case "bar":
    case "pub":
    case "biergarten":
    case "nightclub":
      return "bar";
    case "hotel":
    case "hostel":
    case "guest_house":
    case "motel":
      return "hotel";
    case "peak":
    case "trailhead":
    case "nature_reserve":
      return "hike";
    default:
      return null;
  }
}
