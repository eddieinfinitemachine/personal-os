import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvidenceRow, HealthPicture } from "@/lib/health/picture";
import { HealthPictureCard, PictureBody } from "./health-picture";
import { LabGrid, type LabRow } from "./lab-grid";
import { LabTrends, type MarkerSeries } from "./lab-trends";

const picture: HealthPicture = {
  version: 1,
  headline: "Overall things look steady, and Marker A matters most.",
  focus: [
    { title: "Lower Marker A", kind: "established", why: "It rose.", next: "Retest it.", markers: ["Marker A"] },
    { title: "Check Marker B", kind: "hypothesis", why: "It might connect.", next: "Add weight data.", markers: ["Missing"] },
  ],
  clear: ["Blood sugar looks fine"],
  blindSpots: ["No sleep data"],
  generatedAt: "2030-06-15T12:00:00.000Z",
  fingerprint: { core: "a", activity: "b" },
  basedOn: { draws: 2, latestDraw: "2030-01-10" },
};

const evidence: Record<string, EvidenceRow> = {
  "Marker A": {
    marker: "Marker A",
    unit: "mg/dL",
    range: "<90",
    status: "high",
    points: [
      { date: "2028-01-10", shown: "80" },
      { date: "2030-01-10", shown: "95" },
    ],
  },
};

describe("PictureBody", () => {
  const html = renderToStaticMarkup(<PictureBody picture={picture} evidence={evidence} />);

  it("shows the headline, ranked focus areas and next steps", () => {
    expect(html).toContain("Overall things look steady");
    expect(html.indexOf("Lower Marker A")).toBeLessThan(html.indexOf("Check Marker B"));
    expect(html).toContain("Retest it.");
  });

  it("labels only inferred focus areas as a hypothesis", () => {
    expect(html.match(/Hypothesis/g)).toHaveLength(1);
    expect(html.indexOf("Hypothesis")).toBeGreaterThan(html.indexOf("Check Marker B"));
  });

  it("shows real values next to the claim, and skips a marker with no data", () => {
    expect(html).toContain("80 → 95 mg/dL (range &lt;90)");
    expect(html).not.toContain("Missing");
  });

  it("says what it's based on and that it isn't a diagnosis", () => {
    expect(html).toContain("Written by AI from 2 lab draws through Jan 10, 2030");
    expect(html).toContain("isn&#x27;t a diagnosis");
  });

  it("includes both secondary lists", () => {
    expect(html).toContain("Blood sugar looks fine");
    expect(html).toContain("No sleep data");
  });
});

describe("HealthPictureCard", () => {
  it("shows when the picture was updated", () => {
    const html = renderToStaticMarkup(
      <HealthPictureCard projectId="p1" initial={picture} initialEvidence={evidence} stale={false} />,
    );
    expect(html).toContain("Updated Jun 15, 2030");
  });

  it("says it's working on a first picture", () => {
    const html = renderToStaticMarkup(<HealthPictureCard projectId="p1" initial={null} initialEvidence={{}} stale />);
    expect(html).toContain("Reading your data");
  });

  it("keeps showing the last picture while updating", () => {
    const html = renderToStaticMarkup(<HealthPictureCard projectId="p1" initial={picture} initialEvidence={evidence} stale />);
    expect(html).toContain("Updating…");
    expect(html).toContain("Lower Marker A");
  });
});

describe("LabGrid with reporting limits", () => {
  const row = (overrides: Partial<LabRow>): LabRow => ({
    id: "r1",
    drawnAt: "2030-01-10",
    panel: "Thyroid",
    marker: "Marker C",
    value: 2,
    unit: "IU/mL",
    refLow: null,
    refHigh: 1,
    flag: null,
    notes: null,
    ...overrides,
  });

  it("shows the limit as reported, doesn't call it high and shows no change", () => {
    const html = renderToStaticMarkup(
      <LabGrid
        labs={[row({ notes: "<2" })]}
        priorByMarker={new Map([["Marker C", row({ id: "r0", value: 1, notes: "<1", drawnAt: "2028-01-10" })]])}
      />,
    );
    expect(html).toContain("&lt;2");
    expect(html).not.toContain(">high<");
    expect(html).not.toContain("+1");
  });

  it("still calls a real measurement high and shows its change", () => {
    const html = renderToStaticMarkup(
      <LabGrid labs={[row({})]} priorByMarker={new Map([["Marker C", row({ id: "r0", value: 1, drawnAt: "2028-01-10" })]])} />,
    );
    expect(html).toContain(">high<");
    expect(html).toContain("+1");
  });

  it("shows the range when there is one and no range line when there isn't", () => {
    const withRange = renderToStaticMarkup(<LabGrid labs={[row({ refLow: 1, refHigh: 3 })]} />);
    expect(withRange).toContain("range 1–3");
    const without = renderToStaticMarkup(<LabGrid labs={[row({ refHigh: null })]} />);
    expect(without).not.toContain("range");
    expect(without).not.toContain("optimal");
  });

  it("shows a whole number at the same decimals as the draw before it", () => {
    const html = renderToStaticMarkup(
      <LabGrid labs={[row({ value: 5 })]} priorByMarker={new Map([["Marker C", row({ id: "r0", value: 5.1, drawnAt: "2028-01-10" })]])} />,
    );
    expect(html).toContain(">5.0<");
  });
});

describe("LabTrends", () => {
  const series = (overrides: Partial<MarkerSeries> = {}): MarkerSeries => ({
    marker: "Marker D",
    unit: "mg/dL",
    refLow: null,
    refHigh: 90,
    higherIsBetter: false,
    points: [
      { date: "2028-01-10", value: 95.5 },
      { date: "2030-01-10", value: 97 },
    ],
    ...overrides,
  });

  it("draws dots outside the stretched chart, so they stay round", () => {
    const html = renderToStaticMarkup(<LabTrends series={[series()]} />);
    expect(html).not.toContain("<circle");
    expect(html.match(/rounded-full/g)).toHaveLength(2);
    expect(html).toContain("non-scaling-stroke");
  });

  it("shows the latest value at the marker's decimals", () => {
    expect(renderToStaticMarkup(<LabTrends series={[series()]} />)).toContain(">97.0<");
  });

  it("keeps the range band visible when every value is outside it", () => {
    const html = renderToStaticMarkup(<LabTrends series={[series()]} />);
    const height = Number(html.match(/<rect[^>]*height="([\d.]+)"/)?.[1]);
    expect(height).toBeGreaterThan(1);
  });
});
