// Pure helpers for per-person dating photos and the taste read in "Find
// patterns". No server imports, so client components can use the types.

export type DatingPhotoDTO = { id: string; url: string; caption: string | null; createdAt: string };

type PhotoRow = { id: string; url: string; caption: string | null; createdAt: Date };

/** Blob folder for a person's photos: users/<userId>/dating/<personId>/. */
export const datingPhotoFolder = (personId: string) => `dating/${personId}`;

export const MAX_CAPTION = 300;

/** Only authenticated app URLs cross the server/client boundary. */
export const datingPhotoUrl = (photoId: string) => `/api/dating/photos/${encodeURIComponent(photoId)}/content`;

export function toPhotoDTO(p: PhotoRow): DatingPhotoDTO {
  return { id: p.id, url: datingPhotoUrl(p.id), caption: p.caption, createdAt: p.createdAt.toISOString() };
}

/** Newest photo's URL (the avatar on /dating cards), or null. */
export function pickAvatar(photos: Array<{ id: string; createdAt: Date | string }>): string | null {
  let best: { id: string; t: number } | null = null;
  for (const p of photos) {
    const t = new Date(p.createdAt).getTime();
    if (!best || t > best.t) best = { id: p.id, t };
  }
  return best ? datingPhotoUrl(best.id) : null;
}

/** Normalize a caption from a request body: trimmed, capped, empty → null. */
export function cleanCaption(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, MAX_CAPTION);
  return s || null;
}

export const TASTE_PER_PERSON = 3;
export const TASTE_MAX_IMAGES = 24;

/**
 * Pick photos for the taste read: each person's newest `perPerson`, capped at
 * `max` overall. Fills round-robin by rank (everyone's newest first, then
 * everyone's second...) so a cap never leaves a person out while another
 * has three. Result keeps the input person order; photos newest first.
 */
export function selectTastePhotos<P extends { url: string; createdAt: Date | string }>(
  people: Array<{ id: string; photos: P[] }>,
  perPerson = TASTE_PER_PERSON,
  max = TASTE_MAX_IMAGES,
): Map<string, P[]> {
  const sorted = people.map((p) => ({
    id: p.id,
    photos: [...p.photos]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.max(0, perPerson)),
  }));
  const out = new Map<string, P[]>(sorted.map((p) => [p.id, []]));
  let total = 0;
  for (let rank = 0; rank < perPerson && total < max; rank++) {
    for (const p of sorted) {
      if (total >= max) break;
      const photo = p.photos[rank];
      if (!photo) continue;
      out.get(p.id)!.push(photo);
      total++;
    }
  }
  return out;
}

/** "3 months", "2 weeks", "5 days": how long from metAt to endedAt (or now). */
export function durationLabel(metAt: Date | null, endedAt: Date | null, now = new Date()): string | null {
  if (!metAt) return null;
  const days = Math.max(0, Math.round(((endedAt ?? now).getTime() - metAt.getTime()) / 86_400_000));
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (days < 14) return unit(days, "day");
  if (days < 60) return unit(Math.round(days / 7), "week");
  if (days < 730) return unit(Math.round(days / 30.44), "month");
  return unit(Math.round((days / 365.25) * 10) / 10, "year");
}

export const TASTE_MARKER = "=== YOUR TASTE ===";

/** Split Claude's reply into the patterns text and the "Your taste" section. */
export function splitTaste(raw: string): { text: string; taste: string | null } {
  const i = raw.indexOf(TASTE_MARKER);
  if (i < 0) return { text: raw.trim(), taste: null };
  const taste = raw.slice(i + TASTE_MARKER.length).trim();
  return { text: raw.slice(0, i).trim(), taste: taste || null };
}
