import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  projectFindMany: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findMany: mocks.projectFindMany } } }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <span data-photo={src} aria-label={alt} />,
}));

import PetsPage from "./page";

const pet = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  pet: { name, species: "dog", breed: null, photos: [], ...over },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: "u1" });
  mocks.projectFindMany.mockResolvedValue([]);
});

describe("/pets", () => {
  it("lists the signed-in person's active pets", async () => {
    await PetsPage();
    expect(mocks.projectFindMany.mock.calls[0][0].where).toEqual({ userId: "u1", kind: "pet", archived: false });
  });

  it("links each pet to its dashboard, with its photo or a placeholder", async () => {
    mocks.projectFindMany.mockResolvedValue([
      pet("p1", "Pet A", { breed: "Breed A", photos: [{ url: "https://files.example.test/a.jpg" }] }),
      pet("p2", "Pet B", { species: "cat" }),
    ]);
    const html = renderToStaticMarkup(await PetsPage());
    expect(html).toContain('href="/projects/p1"');
    expect(html).toContain('href="/projects/p2"');
    expect(html).toContain('data-photo="https://files.example.test/a.jpg"');
    expect(html).toContain("dog · Breed A");
    expect(html).toContain("Pet B");
    expect(html).not.toContain("No pets yet.");
  });

  it("says so when there are no pets", async () => {
    expect(renderToStaticMarkup(await PetsPage())).toContain("No pets yet.");
  });

  it("sends a signed-out visitor to login", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(PetsPage()).rejects.toThrow("redirect:/login");
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });
});
