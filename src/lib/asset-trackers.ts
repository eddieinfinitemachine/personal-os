// Sidebar trackers whose items live in the Asset table, keyed by the
// template slug (src/lib/templates.ts) with the Asset.kind they store. Used by
// "Send to tracker" on a todo row and its API route. Dependency-free so both
// the client bundle and the route can import it.

export type AssetTrackerKind = "media" | "place" | "inventory" | "investment" | "practice";

export type AssetTracker = {
  slug: "media" | "places" | "inventory" | "investments" | "best-practices";
  kind: AssetTrackerKind;
  label: string;
  href: string;
};

export const ASSET_TRACKERS: readonly AssetTracker[] = [
  { slug: "media", kind: "media", label: "Media", href: "/media" },
  { slug: "places", kind: "place", label: "Places", href: "/places" },
  { slug: "inventory", kind: "inventory", label: "Inventory", href: "/inventory" },
  { slug: "investments", kind: "investment", label: "Investments", href: "/investments" },
  { slug: "best-practices", kind: "practice", label: "Best practices", href: "/best-practices" },
];

export function assetTrackerByKind(kind: unknown): AssetTracker | undefined {
  return ASSET_TRACKERS.find((t) => t.kind === kind);
}

// Meeting-import provenance ("From meeting: GTM 9/28 (2026-09-28)" and the
// note URL on the next line) says where the todo came from, not what the
// item is, so it's left out of what Claude reads.
export function todoCaptureText(title: string, notes: string | null | undefined): string {
  const lines = (notes ?? "").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*From meeting:/i.test(lines[i])) {
      if (/^\s*https?:\/\/\S+\s*$/.test(lines[i + 1] ?? "")) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  const body = kept.join("\n").trim();
  return body ? `${title.trim()}\n${body}` : title.trim();
}
