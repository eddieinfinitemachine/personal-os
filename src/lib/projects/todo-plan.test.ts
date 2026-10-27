import { describe, expect, it } from "vitest";
import { parseTodoPlan } from "./todo-plan";

describe("parseTodoPlan", () => {
  it("returns open items tagged with the nearest #–### heading, in file order", () => {
    const md = [
      "Intro - [ ] not a list item",
      "- [ ] Before any heading",
      "# Feature A — in progress",
      "- [x] Done already",
      "- [ ] Write the lib",
      "  - [ ] Nested item",
      "## Tasks",
      "* [ ] Star bullet",
      "#### Too deep (not a section)",
      "- [ ] Under h4 stays in Tasks",
      "- [X] Done uppercase",
      "```md",
      "- [ ] inside a code fence",
      "```",
      "### Later",
      "+ [ ] Plus bullet",
      "- [] malformed",
    ].join("\n");
    const { items, total } = parseTodoPlan(md);
    expect(items).toEqual([
      { text: "Before any heading", section: null },
      { text: "Write the lib", section: "Feature A — in progress" },
      { text: "Nested item", section: "Feature A — in progress" },
      { text: "Star bullet", section: "Tasks" },
      { text: "Under h4 stays in Tasks", section: "Tasks" },
      { text: "Plus bullet", section: "Later" },
    ]);
    expect(total).toBe(6);
  });

  it("joins an item's wrapped continuation lines, but not nested items", () => {
    const md = "- [ ] Verify the import (7-day\n  window) on prod\n  - [ ] Nested\n    more of nested\n\n  not continued after a blank";
    expect(parseTodoPlan(md).items).toEqual([
      { text: "Verify the import (7-day window) on prod", section: null },
      { text: "Nested more of nested", section: null },
    ]);
  });

  it("caps items at 8 but counts them all", () => {
    const md = Array.from({ length: 12 }, (_, i) => `- [ ] item ${i}`).join("\n");
    const { items, total } = parseTodoPlan(md);
    expect(items).toHaveLength(8);
    expect(items[7].text).toBe("item 7");
    expect(total).toBe(12);
  });

  it("handles CRLF, empty files and very long items", () => {
    expect(parseTodoPlan("")).toEqual({ items: [], total: 0 });
    expect(parseTodoPlan("# H\r\n- [ ] a\r\n").items).toEqual([{ text: "a", section: "H" }]);
    const long = parseTodoPlan(`- [ ] ${"x".repeat(500)}`).items[0].text;
    expect(long.length).toBe(200);
    expect(long.endsWith("…")).toBe(true);
  });
});
