// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FriendsList, type PersonRow } from "./friends-list";
import type { PersonContext } from "@/lib/person-context/types";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const now = new Date("2026-09-28T12:00:00Z");
function context(): PersonContext {
  return { version: "test", generatedAt: "2026-09-27T12:00:00Z", model: "test-model",
    summary: "Avery is a former teammate who now runs a small studio. They talk every few months.",
    relationship: { text: "Worked together at a previous job.", basis: "inferred" },
    topics: ["studio launch", "running"],
    facts: [{ text: "Moved to a new city this spring.", confidence: "high", evidence: { source: "imessage", at: "2026-04-02T12:00:00Z", quote: "Finally unpacked the last box." } },
      { text: "Might be training for a marathon.", confidence: "low" }],
    openLoops: [{ text: "Promised to send the studio deck.", confidence: "medium" }],
    publicContext: { text: "Founder of an example studio.", sources: [{ title: "Example Studio", url: "https://example.test/studio" }] },
    inputs: { imessage: { messages: 40, from: "2025-10-01", to: "2026-09-20" }, granolaMeetings: 1, webSearched: true, interactions: 3 },
    sourceFingerprint: "fp" };
}
function person(id: string, firstName: string, ctx: PersonContext | null): PersonRow {
  return { id, externalId: null, firstName, lastName: "Example", strength: null, circles: [], tags: [], email: null, phone: null,
    company: null, role: null, city: null, country: null, socialUrls: null, howWeMet: null, interests: [], birthday: null,
    lastInteractionAt: null, lastInteractionTitle: null, lastInteractionKind: null, createdAt: null, notes: null, imageUrl: null,
    starred: false, context: ctx, contextAt: ctx ? "2026-09-27T12:00:00Z" : null };
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ interactions: [] }) }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const render = (people: PersonRow[]) => act(async () => root.render(<FriendsList initialPeople={people} />));
const rowFor = (name: string) => [...container.querySelectorAll("li")].find(li => li.textContent?.includes(`${name} Example`))!;
describe("friends list AI context", () => {
  it("shows the first summary sentence on the row only when context exists", async () => {
    await render([person("a", "Avery", context()), person("b", "Blake", null)]);
    const summary = rowFor("Avery").querySelector('[data-testid="person-row-summary"]')!;
    expect(summary.textContent).toBe("Avery is a former teammate who now runs a small studio.");
    expect(summary.className).toContain("truncate");
    expect(rowFor("Blake").querySelector('[data-testid="person-row-summary"]')).toBeNull();
  });
  it("renders a read-only Context card in the editor", async () => {
    await render([person("a", "Avery", context()), person("b", "Blake", null)]);
    const nameButton = [...rowFor("Avery").querySelectorAll("button")].find(b => b.textContent?.includes("Avery Example"))!;
    await act(async () => nameButton.click());
    const card = container.querySelector('section[aria-label="Context"]')!;
    expect(card).not.toBeNull();
    const meta = card.querySelector('[data-testid="context-meta"]')!.textContent!;
    expect(meta).toContain("AI-written from iMessage, Granola, web, CRM");
    expect(meta).not.toContain("WhatsApp");
    expect(meta).toContain(`Updated ${new Date("2026-09-27T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`);
    expect(card.textContent).toContain("They talk every few months.");
    expect(card.textContent).toContain("Worked together at a previous job. (inferred)");
    expect([...card.querySelectorAll('[data-testid="context-topics"] span')].map(s => s.textContent)).toEqual(["studio launch", "running"]);
    const quote = card.querySelector("details blockquote")!;
    expect(quote.textContent).toContain("Finally unpacked the last box.");
    expect(quote.textContent).toContain("iMessage");
    expect(quote.closest("details")!.querySelector("summary")!.textContent).toBe("why");
    expect(card.textContent).toContain("Might be training for a marathon. · low confidence");
    expect(card.textContent).toContain("Promised to send the studio deck.");
    const link = card.querySelector('a[href="https://example.test/studio"]')!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // Context sits above Notes and nothing in it is editable.
    expect(card.querySelector("input, textarea, select")).toBeNull();
    const notesLabel = [...container.querySelectorAll("label")].find(l => l.textContent === "Notes")!;
    expect(card.compareDocumentPosition(notesLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("omits the Context card for a person without context", async () => {
    await render([person("b", "Blake", null)]);
    const nameButton = [...rowFor("Blake").querySelectorAll("button")].find(b => b.textContent?.includes("Blake Example"))!;
    await act(async () => nameButton.click());
    expect(container.querySelector('[aria-label="Context"]')).toBeNull();
    expect([...container.querySelectorAll("label")].some(l => l.textContent === "Notes")).toBe(true);
  });
});
