import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type LabRow = {
  id: string;
  drawnAt: Date | string;
  panel: string;
  marker: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  flag: string | null;
};

function classifyFlag(r: LabRow): "low" | "high" | "normal" | "unknown" {
  if (r.flag === "low" || r.flag === "high" || r.flag === "normal") return r.flag;
  if (r.refLow != null && r.value < r.refLow) return "low";
  if (r.refHigh != null && r.value > r.refHigh) return "high";
  if (r.refLow != null || r.refHigh != null) return "normal";
  return "unknown";
}

function flagStyles(flag: ReturnType<typeof classifyFlag>) {
  switch (flag) {
    case "high":
      return { dot: "bg-rose-500", text: "text-rose-500", label: "high" };
    case "low":
      return { dot: "bg-amber-500", text: "text-amber-500", label: "low" };
    case "normal":
      return { dot: "bg-emerald-500", text: "text-emerald-500", label: "in range" };
    default:
      return { dot: "bg-zinc-500", text: "text-zinc-400", label: "—" };
  }
}

function fmtRange(r: LabRow): string {
  if (r.refLow != null && r.refHigh != null) return `${r.refLow}–${r.refHigh}`;
  if (r.refLow != null) return `> ${r.refLow}`;
  if (r.refHigh != null) return `< ${r.refHigh}`;
  return "—";
}

// Markers where a HIGHER value is the goal (most are inverted — lower=better).
const HIGHER_IS_BETTER = new Set([
  "HDL Cholesterol",
  "HDL Large",
  "LDL Peak Size",
  "Vitamin D 25-OH",
  "Free T3",
  "Free T4",
  "OmegaCheck (EPA+DPA+DHA)",
  "EPA",
  "DPA",
  "DHA",
  "% Saturation",
  "eGFR",
]);

function trend(curr: number, prev: number, marker: string) {
  const delta = curr - prev;
  if (Math.abs(delta) < 0.001) return null;
  const higherIsBetter = HIGHER_IS_BETTER.has(marker);
  const direction = delta > 0 ? "up" : "down";
  // For "in-range" markers, treat any change as neutral unless out of range.
  const better =
    (direction === "up" && higherIsBetter) ||
    (direction === "down" && !higherIsBetter);
  return { delta, direction, better };
}

export function LabGrid({
  labs,
  priorByMarker,
}: {
  labs: LabRow[];
  priorByMarker?: Map<string, LabRow>;
}) {
  if (labs.length === 0) {
    return (
      <p className="text-sm text-[var(--color-muted-foreground)]">
        No lab results yet.
      </p>
    );
  }

  const byPanel = new Map<string, LabRow[]>();
  for (const r of labs) {
    const arr = byPanel.get(r.panel) ?? [];
    arr.push(r);
    byPanel.set(r.panel, arr);
  }

  return (
    <div className="space-y-5">
      {[...byPanel.entries()].map(([panel, rows]) => (
        <div key={panel}>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-2">
            {panel}
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const flag = classifyFlag(r);
              const fs = flagStyles(flag);
              const prior = priorByMarker?.get(r.marker);
              const t = prior ? trend(r.value, prior.value, r.marker) : null;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">{r.marker}</div>
                    <span
                      className={cn(
                        "text-[10px] uppercase tracking-wider font-semibold inline-flex items-center gap-1",
                        fs.text
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", fs.dot)} />
                      {fs.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <div className="text-lg font-semibold tabular-nums">
                      {r.value}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {r.unit}
                    </div>
                    {t ? (
                      <div
                        className={cn(
                          "ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
                          t.better ? "text-emerald-500" : "text-rose-500"
                        )}
                        title={`vs ${new Date(prior!.drawnAt).toLocaleDateString()}: ${prior!.value} ${prior!.unit}`}
                      >
                        {t.direction === "up" ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {t.delta > 0 ? "+" : ""}
                        {t.delta.toFixed(t.delta % 1 === 0 ? 0 : 1)}
                      </div>
                    ) : prior ? (
                      <div className="ml-auto inline-flex items-center text-[11px] text-[var(--color-muted-foreground)]">
                        <Minus className="size-3" />
                      </div>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-[var(--color-muted-foreground)] tabular-nums mt-0.5">
                    optimal {fmtRange(r)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
