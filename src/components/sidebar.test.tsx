import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
import { Sidebar } from "./sidebar";

describe("Sidebar Improve button", () => {
  it("explains itself on hover", () => {
    const html = renderToStaticMarkup(<Sidebar canImprove />);
    expect(html).toMatch(/<button[^>]*title="Ask for a change to this app"[^>]*>(?:(?!<\/button>).)*Improve/);
  });

  it("is hidden for everyone but the founder", () => {
    expect(renderToStaticMarkup(<Sidebar />)).not.toContain("Ask for a change to this app");
  });
});
