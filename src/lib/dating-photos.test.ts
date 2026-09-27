import { describe, expect, it } from "vitest";
import {
  TASTE_MARKER,
  TASTE_MAX_IMAGES,
  cleanCaption,
  datingPhotoFolder,
  durationLabel,
  pickAvatar,
  selectTastePhotos,
  splitTaste,
  toPhotoDTO,
} from "@/lib/dating-photos";
import { ownsUserImage } from "@/lib/user-image";

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const photos = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ url: `${id}-${i + 1}`, createdAt: at(i + 1) }));

describe("selectTastePhotos", () => {
  it("takes each person's newest three", () => {
    const got = selectTastePhotos([{ id: "a", photos: photos("a", 5) }]);
    expect(got.get("a")!.map((p) => p.url)).toEqual(["a-5", "a-4", "a-3"]);
  });

  it("caps the total at 24 and fills round-robin so nobody is left out", () => {
    const people = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, photos: photos(`p${i}`, 3) }));
    const got = selectTastePhotos(people);
    const total = [...got.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(TASTE_MAX_IMAGES);
    for (const list of got.values()) expect(list.length).toBe(2);
    // Newest first per person.
    expect(got.get("p0")!.map((p) => p.url)).toEqual(["p0-3", "p0-2"]);
  });

  it("with 30 people everyone before the cap gets one, later ones none", () => {
    const people = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, photos: photos(`p${i}`, 3) }));
    const got = selectTastePhotos(people);
    expect(got.get("p23")!.length).toBe(1);
    expect(got.get("p24")!.length).toBe(0);
    expect([...got.values()].reduce((n, l) => n + l.length, 0)).toBe(24);
  });

  it("handles people without photos and a custom cap", () => {
    const got = selectTastePhotos(
      [
        { id: "a", photos: photos("a", 1) },
        { id: "b", photos: [] },
        { id: "c", photos: photos("c", 4) },
      ],
      3,
      3,
    );
    expect(got.get("a")!.length).toBe(1);
    expect(got.get("b")).toEqual([]);
    expect(got.get("c")!.map((p) => p.url)).toEqual(["c-4", "c-3"]);
  });
});

describe("pickAvatar", () => {
  it("is the newest photo, or null without photos", () => {
    expect(pickAvatar([])).toBeNull();
    expect(pickAvatar([{ id: "old", createdAt: at(1) }, { id: "new", createdAt: at(9) }, { id: "mid", createdAt: at(4) }])).toBe("/api/dating/photos/new/content");
    expect(pickAvatar([{ id: "iso", createdAt: at(3).toISOString() }])).toBe("/api/dating/photos/iso/content");
  });
});

describe("toPhotoDTO / cleanCaption", () => {
  it("serializes dates and normalizes captions", () => {
    expect(toPhotoDTO({ id: "1", url: "u", caption: null, createdAt: at(2) })).toEqual({
      id: "1",
      url: "/api/dating/photos/1/content",
      caption: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(cleanCaption("  first   date  ")).toBe("first date");
    expect(cleanCaption("   ")).toBeNull();
    expect(cleanCaption(42)).toBeNull();
    expect(cleanCaption("x".repeat(500))!.length).toBe(300);
  });
});

describe("durationLabel", () => {
  it("scales units", () => {
    expect(durationLabel(null, null)).toBeNull();
    expect(durationLabel(at(1), at(2))).toBe("1 day");
    expect(durationLabel(at(1), at(22))).toBe("3 weeks");
    expect(durationLabel(at(1), new Date(Date.UTC(2026, 4, 1)))).toBe("4 months");
    expect(durationLabel(at(1), new Date(Date.UTC(2028, 6, 1)))).toBe("2.5 years");
  });
});

describe("splitTaste", () => {
  it("splits on the marker", () => {
    expect(splitTaste(`## Patterns\n- a\n\n${TASTE_MARKER}\n## Drawn to\n- b`)).toEqual({
      text: "## Patterns\n- a",
      taste: "## Drawn to\n- b",
    });
    expect(splitTaste("just patterns")).toEqual({ text: "just patterns", taste: null });
  });
});

describe("ownsUserImage (delete/fetch prefix guard)", () => {
  const u = "cuser1";
  const folder = datingPhotoFolder("cperson1");
  const blob = "https://abc123.public.blob.vercel-storage.com";

  it("accepts this user's own dating blobs and local uploads", () => {
    expect(ownsUserImage(u, folder, `${blob}/users/cuser1/dating/cperson1/1-x.webp`)).toBe(true);
    expect(ownsUserImage(u, folder, "https://abc.private.blob.vercel-storage.com/users/cuser1/dating/cperson1/1.webp")).toBe(true);
    expect(ownsUserImage(u, folder, "private-local:/dating/cuser1/cperson1/1.webp")).toBe(true);
    expect(ownsUserImage(u, folder, "/uploads/dating/cuser1/cperson1/1-x.webp")).toBe(true);
    expect(ownsUserImage(u, "board", `${blob}/users/cuser1/board/1.webp`)).toBe(true);
    expect(ownsUserImage(u, "board", "/uploads/board/cuser1/1.webp")).toBe(true);
  });

  it("rejects other users, other people, other folders and foreign hosts", () => {
    expect(ownsUserImage(u, folder, `${blob}/users/cuser2/dating/cperson1/1.webp`)).toBe(false);
    expect(ownsUserImage(u, folder, `${blob}/users/cuser1/dating/cperson2/1.webp`)).toBe(false);
    expect(ownsUserImage(u, folder, `${blob}/users/cuser1/board/1.webp`)).toBe(false);
    expect(ownsUserImage(u, folder, "https://evil.example.com/users/cuser1/dating/cperson1/1.webp")).toBe(false);
    expect(ownsUserImage(u, folder, "http://abc.public.blob.vercel-storage.com/users/cuser1/dating/cperson1/1.webp")).toBe(false);
    expect(ownsUserImage(u, folder, "/uploads/dating/cuser2/cperson1/1.webp")).toBe(false);
    expect(ownsUserImage(u, folder, null)).toBe(false);
    expect(ownsUserImage(u, folder, "")).toBe(false);
  });

  it("rejects traversal and prefix tricks", () => {
    expect(ownsUserImage(u, folder, "/uploads/dating/cuser1/cperson1/../../cuser2/x.webp")).toBe(false);
    expect(ownsUserImage(u, folder, `${blob}/users/cuser1/dating/cperson1/../../../cuser2/x.webp`)).toBe(false);
    expect(ownsUserImage(u, folder, `${blob}/users/cuser1/dating/cperson10/x.webp`)).toBe(false);
    expect(ownsUserImage("cuser", folder, `${blob}/users/cuser1/dating/cperson1/x.webp`)).toBe(false);
    expect(ownsUserImage(u, "dating/../board", `${blob}/users/cuser1/board/x.webp`)).toBe(false);
    expect(ownsUserImage("../x", folder, "/uploads/dating/../x/cperson1/a.webp")).toBe(false);
    expect(ownsUserImage(u, folder, "private-local:/dating/cuser1/cperson1/%2e%2e/secret")).toBe(false);
    expect(ownsUserImage(u, folder, "private-local:/dating/cuser1/cperson2/a.webp")).toBe(false);
  });
});
