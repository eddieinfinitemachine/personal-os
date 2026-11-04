import { alignDecimals, labDate } from "@/lib/health/lab-value";
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
  const lowest = Math.min(...allValues);
  const highest = Math.max(...allValues);
  // Headroom past both ends, so a range band stays visible when every value sits outside it.
  const margin = (highest - lowest || 1) * 0.15;
  const min = lowest - margin;
  const max = highest + margin;
  const x = (i: number) =>
    pad + (i * (w - pad * 2)) / Math.max(1, series.points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);

  const path = series.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`)
    .join(" ");

  return (
    <div className="relative h-10 w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="absolute inset-0 size-full"
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
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Outside the SVG: it stretches to the card, which would turn circles into ovals. */}
      {series.points.map((p, i) => {
        const status = isOutOfRange(p.value, series.refLow, series.refHigh);
        return (
          <span
            key={i}
            title={`${labDate(p.date)}: ${p.value} ${series.unit}`}
            style={{ left: `${(x(i) / w) * 100}%`, top: `${(y(p.value) / h) * 100}%` }}
            className={cn(
              "absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
              status === "high" && "bg-rose-500",
              status === "low" && "bg-amber-500",
              status === "in" && "bg-emerald-500"
            )}
          />
        );
      })}
    </div>
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
        const shown = alignDecimals(s.points.map((p) => String(p.value)));
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
                {shown[shown.length - 1]}
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
                  title={`first draw ${labDate(first.date)}: ${shown[0]}`}
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
