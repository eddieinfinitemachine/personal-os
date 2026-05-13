"use client";

import { cn } from "@/lib/utils";

type TrendPoint = { date: string; value: number };

export type MarkerSeries = {
  marker: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  higherIsBetter: boolean;
  points: TrendPoint[]; // sorted ascending by date
};

function isOutOfRange(v: number, refLow: number | null, refHigh: number | null) {
  if (refLow != null && v < refLow) return "low";
  if (refHigh != null && v > refHigh) return "high";
  return "in";
}

function Sparkline({ series }: { series: MarkerSeries }) {
  const w = 160;
  const h = 40;
  const pad = 4;
  const values = series.points.map((p) => p.value);
  const refs = [series.refLow, series.refHigh].filter(
    (v): v is number => v != null
  );
  const allValues = [...values, ...refs];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const x = (i: number) =>
    pad + (i * (w - pad * 2)) / Math.max(1, series.points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);

  const path = series.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full h-10"
      preserveAspectRatio="none"
    >
      {/* reference band */}
      {series.refLow != null && series.refHigh != null && (
        <rect
          x={pad}
          y={y(series.refHigh)}
          width={w - pad * 2}
          height={Math.max(2, y(series.refLow) - y(series.refHigh))}
          className="fill-emerald-500/10"
        />
      )}
      {series.refHigh != null && series.refLow == null && (
        <rect
          x={pad}
          y={y(series.refHigh)}
          width={w - pad * 2}
          height={h - pad - y(series.refHigh)}
          className="fill-emerald-500/10"
        />
      )}
      {series.refLow != null && series.refHigh == null && (
        <rect
          x={pad}
          y={pad}
          width={w - pad * 2}
          height={Math.max(2, y(series.refLow) - pad)}
          className="fill-emerald-500/10"
        />
      )}
      <path
        d={path}
        fill="none"
        className="stroke-[var(--color-foreground)]"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {series.points.map((p, i) => {
        const status = isOutOfRange(p.value, series.refLow, series.refHigh);
        return (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={2.5}
            className={cn(
              status === "high" && "fill-rose-500",
              status === "low" && "fill-amber-500",
              status === "in" && "fill-emerald-500"
            )}
          />
        );
      })}
    </svg>
  );
}

export function LabTrends({ series }: { series: MarkerSeries[] }) {
  if (series.length === 0) return null;
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {series.map((s) => {
        const last = s.points[s.points.length - 1];
        const first = s.points[0];
        const delta = last.value - first.value;
        const better =
          (delta > 0 && s.higherIsBetter) ||
          (delta < 0 && !s.higherIsBetter);
        const status = isOutOfRange(last.value, s.refLow, s.refHigh);
        return (
          <div
            key={s.marker}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-xs font-semibold truncate">{s.marker}</div>
              <div className="text-[10px] text-[var(--color-muted-foreground)]">
                {s.points.length} draw{s.points.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <div
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  status === "high" && "text-rose-500",
                  status === "low" && "text-amber-500"
                )}
              >
                {last.value}
              </div>
              <div className="text-[10px] text-[var(--color-muted-foreground)]">
                {s.unit}
              </div>
              {s.points.length > 1 && Math.abs(delta) > 0.001 ? (
                <div
                  className={cn(
                    "ml-auto text-[11px] font-medium tabular-nums",
                    better ? "text-emerald-500" : "text-rose-500"
                  )}
                  title={`first draw ${s.points[0].date}: ${s.points[0].value}`}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(Math.abs(delta) < 1 ? 1 : 0)}
                </div>
              ) : null}
            </div>
            <Sparkline series={s} />
          </div>
        );
      })}
    </div>
  );
}
