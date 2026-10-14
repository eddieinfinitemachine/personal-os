// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ founder: true }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        email: "owner@example.invalid",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        lastSeenAt: new Date("2026-10-01T00:00:00Z"),
        kindleEmail: null,
        kindleAutoSend: false,
      }),
    },
    attachment: { aggregate: async () => ({ _sum: { size: 0 } }) },
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/cron", () => ({ isFounderUser: async () => mocks.founder }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/logout-button", () => ({ LogoutButton: () => null }));
vi.mock("@/components/push-settings", () => ({ PushSettings: () => null }));
vi.mock("@/components/reading-settings", () => ({ ReadingSettings: () => null }));
vi.mock("@/components/dating/granola-sync", () => ({ GranolaSync: () => <button>Sync now</button> }));
vi.mock("@/components/dating/sync-help", () => ({ SyncHelp: () => <p>Sync iMessage and WhatsApp from your Mac</p> }));
vi.mock("@/components/dating/source-status", () => ({
  DatingSourcesProvider: ({ children }: { children: ReactNode }) => <div data-testid="sources-provider">{children}</div>,
  SourceSettings: ({ children }: { children: ReactNode }) => <div><button>Refresh source status</button>{children}</div>,
}));
import SettingsPage from "./page";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  mocks.founder = true;
});
const render = async () => {
  const page = await SettingsPage();
  await act(async () => root.render(page));
};

describe("Settings › Imports and sync", () => {
  it("renders every source control under its own anchored section", async () => {
    await render();
    const section = container.querySelector("section#imports-and-sync")!;
    expect(section.querySelector("h2")?.textContent).toBe("Imports and sync");
    const provider = section.querySelector('[data-testid="sources-provider"]')!;
    expect(provider.textContent).toContain("Refresh source status");
    expect(provider.textContent).toContain("Sync now");
    expect(provider.textContent).toContain("Sync iMessage and WhatsApp from your Mac");
  });

  it("hides the personal Granola sync from non-founders", async () => {
    mocks.founder = false;
    await render();
    const section = container.querySelector("section#imports-and-sync")!;
    expect(section.textContent).not.toContain("Sync now");
    expect(section.textContent).toContain("Refresh source status");
  });
});
