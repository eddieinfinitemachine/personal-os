import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  projectFind: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/prisma", () => ({ prisma: { project: { findFirst: mocks.projectFind } } }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/projects/[id]/page", () => ({ default: () => null }));

import ProjectPage from "@/app/projects/[id]/page";
import HealthPage from "./page";

const searchParams = Promise.resolve({ tab: "notes" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: "u1" });
  mocks.projectFind.mockResolvedValue({ id: "p1" });
});

describe("/health", () => {
  it("shows the signed-in person's own record, with the tab they asked for", async () => {
    const page = await HealthPage({ searchParams });
    expect(mocks.projectFind.mock.calls[0][0].where).toEqual({ userId: "u1", kind: "human", archived: false });
    expect(page.type).toBe(ProjectPage);
    await expect(page.props.params).resolves.toEqual({ id: "p1" });
    expect(page.props.searchParams).toBe(searchParams);
  });

  it("is not found without a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(HealthPage({ searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.projectFind).not.toHaveBeenCalled();
  });

  it("is not found for someone with no health record", async () => {
    mocks.projectFind.mockResolvedValue(null);
    await expect(HealthPage({ searchParams })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
