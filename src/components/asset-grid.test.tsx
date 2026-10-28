// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetGrid, type AssetRow } from "./asset-grid";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const row = (over: Partial<AssetRow>): AssetRow => ({
  id: "x", kind: "inventory", title: "Thing", subtitle: null, category: "Watch", status: "owned",
  amountUsd: null, currentValue: null, costBasis: null, returnPercent: null, url: null, imageUrl: null,
  location: null, rating: null, acquiredAt: null, notes: null, ...over,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("AssetGrid category headers", () => {
  it("shows cost basis then value for each category, even when collapsed", async () => {
    const assets = [
      row({ id: "a", category: "Watch", costBasis: 1000, currentValue: 1500 }),
      row({ id: "b", category: "Watch", costBasis: 250, currentValue: 300 }),
      row({ id: "c", category: "Book", costBasis: null, currentValue: 40 }),
    ];
    await act(async () => root.render(
      <AssetGrid kind="inventory" initialAssets={assets} fields={[]} showMoneyTotal spreadsheet defaultGroupBy="category" />,
    ));
    const headers = [...container.querySelectorAll("button")].filter((b) => /^(Watch|Book)/i.test(b.textContent ?? ""));
    const watch = headers.find((b) => /watch/i.test(b.textContent ?? ""))!;
    const book = headers.find((b) => /book/i.test(b.textContent ?? ""))!;
    // Cost ($1,250) precedes value ($1,800) in the header text.
    expect(watch.textContent).toMatch(/\$1,250.*\$1,800/);
    // A category with no cost basis shows value only.
    expect(book.textContent).not.toMatch(/\$0/);
    expect(book.textContent).toMatch(/\$40/);
    // Collapse the Watch group: the figures stay visible.
    await act(async () => watch.click());
    const watchAfter = [...container.querySelectorAll("button")].find((b) => /^watch/i.test(b.textContent ?? ""))!;
    expect(watchAfter.textContent).toMatch(/\$1,250.*\$1,800/);
  });
});
