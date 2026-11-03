import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
import { Sidebar } from "./sidebar";

describe("Sidebar Improve button", () => {
  it("explains itself on hover", () => {
    const html = renderToStaticMarkup(<Sidebar projects={[]} canImprove />);
    expect(html).toMatch(/<button[^>]*title="Ask for a change to this app"[^>]*>(?:(?!<\/button>).)*Improve/);
  });

  it("is hidden for everyone but the founder", () => {
    expect(renderToStaticMarkup(<Sidebar projects={[]} />)).not.toContain("Ask for a change to this app");
  });
});

describe("Sidebar projects", () => {
  const project = (id: string, name: string, todos = 1) => ({ id, name, icon: "Folder", _count: { todos } });

  it("leaves Inbox out: it is the To Do list on Home", () => {
    const html = renderToStaticMarkup(<Sidebar projects={[project("in", "Inbox", 3), project("pr", "Reading")]} />);
    expect(html).toContain('href="/projects/pr"');
    expect(html).not.toContain('href="/projects/in"');
  });
});
