"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { weekStart, weeklyVolume, type WeekBucket } from "@/lib/dating";
import type { DatingEventDTO } from "@/lib/dating-server";

type Meta = { sentAt: string; fromMe: boolean };

const THEM = "var(--color-label-quaternary)";
const ME = "var(--color-tint)";
const PAD = { l: 28, r: 8 };
const BARS_H = 120;
const VIBE_H = 110;

const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
// Month name, plus the year on January and the first tick so "Jul 26" never reads as a day.
const fmtMonth = (d: Date, first: boolean) =>
  d.toLocaleDateString(undefined, first || d.getMonth() === 0 ? { month: "short", year: "numeric" } : { month: "short" });

/**
 * Two charts on one time axis: messages per week (stacked, them + you) and
 * how each dated moment felt (vibe 1-10). Separate y-scales, never a dual axis.
 */
export function RelationshipChart({
  messages,
  events,
  name,
  metAt,
}: {
  messages: Meta[];
  events: DatingEventDTO[];
  name: string;
  metAt: string | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { weeks, t0, t1 } = useMemo(() => {
    const starts = [
      ...messages.map((m) => new Date(m.sentAt).getTime()),
      ...events.map((e) => new Date(e.occurredAt).getTime()),
      ...(metAt ? [new Date(metAt).getTime()] : []),
    ];
    const now = Date.now();
    const first = starts.length ? Math.min(...starts) : now - 28 * 86_400_000;
    const t0 = weekStart(new Date(Math.min(first, now - 28 * 86_400_000))).getTime();
    const t1 = weekStart(new Date(now)).getTime() + 7 * 86_400_000;
    // Pad the volume series back to t0 so bars line up with events before the first text.
    const vol = weeklyVolume(messages);
    const byWeek = new Map(vol.map((w) => [new Date(w.week).getTime(), w]));
    const weeks: WeekBucket[] = [];
    for (let w = new Date(t0); w.getTime() < t1; w.setDate(w.getDate() + 7)) {
      weeks.push(byWeek.get(w.getTime()) ?? { week: w.toISOString(), mine: 0, theirs: 0 });
    }
    return { weeks, t0, t1 };
  }, [messages, events, metAt]);

  const innerW = Math.max(0, width - PAD.l - PAD.r);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * innerW;
  const maxWeek = Math.max(1, ...weeks.map((w) => w.mine + w.theirs));
  const yMax = niceMax(maxWeek);
  const barW = Math.max(1, innerW / weeks.length - 2);
  const vibes = events
    .filter((e) => e.vibe)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const vy = (v: number) => 12 + (1 - (v - 1) / 9) * (VIBE_H - 30);

  const ticks = useMemo(() => {
    const out: number[] = [];
    const span = t1 - t0;
    const stepMonths = span > 400 * 86_400_000 ? 3 : span > 150 * 86_400_000 ? 2 : 1;
    const d = new Date(t0);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    for (; d.getTime() < t1; d.setMonth(d.getMonth() + stepMonths)) out.push(d.getTime());
    return out;
  }, [t0, t1]);

  const show = (e: React.MouseEvent, lines: string[]) => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, lines });
  };

  const table = (
    <table className="sr-only">
      <caption>Messages per week</caption>
      <thead>
        <tr>
          <th>Week</th>
          <th>{name}</th>
          <th>You</th>
        </tr>
      </thead>
      <tbody>
        {weeks
          .filter((w) => w.mine + w.theirs)
          .map((w) => (
            <tr key={w.week}>
              <td>{fmtDay(new Date(w.week))}</td>
              <td>{w.theirs}</td>
              <td>{w.mine}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );

  return (
    <div ref={wrap} className="relative select-none" onMouseLeave={() => setHover(null)}>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-medium text-[var(--color-muted-foreground)]">Messages per week</div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)]">
          <Swatch color={THEM} label={name} />
          <Swatch color={ME} label="You" />
        </div>
      </div>
      {width > 0 && (
        <svg width={width} height={BARS_H + 4} role="img" aria-label={`Messages per week with ${name}`}>
          {[0, yMax / 2, yMax].map((v) => {
            const y = BARS_H - (v / yMax) * (BARS_H - 8);
            return (
              <g key={v}>
                <line x1={PAD.l} x2={width - PAD.r} y1={y} y2={y} stroke="var(--color-separator)" strokeWidth={1} />
                <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--color-label-tertiary)">
                  {v}
                </text>
              </g>
            );
          })}
          {weeks.map((w) => {
            const t = new Date(w.week).getTime();
            const bx = x(t) + 1;
            const scale = (n: number) => (n / yMax) * (BARS_H - 8);
            const hT = scale(w.theirs);
            const hM = scale(w.mine);
            return (
              <g
                key={w.week}
                onMouseMove={(e) =>
                  show(e, [`Week of ${fmtDay(new Date(w.week))}`, `${name}: ${w.theirs}`, `You: ${w.mine}`])
                }
              >
                <rect x={bx - 1} y={0} width={barW + 2} height={BARS_H} fill="transparent" />
                {w.theirs > 0 && <Bar x={bx} y={BARS_H - hT} w={barW} h={hT} fill={THEM} top={!w.mine} />}
                {w.mine > 0 && (
                  <Bar x={bx} y={BARS_H - hT - hM - (w.theirs ? 2 : 0)} w={barW} h={hM} fill={ME} top />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {table}

      <div className="text-xs font-medium text-[var(--color-muted-foreground)] mt-4 mb-1">
        How it felt {vibes.length ? "" : "(rate a date on the timeline to plot it)"}
      </div>
      {width > 0 && (
        <svg width={width} height={VIBE_H + 18} role="img" aria-label="Vibe over time, 1 to 10">
          {[1, 5, 10].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={width - PAD.r} y1={vy(v)} y2={vy(v)} stroke="var(--color-separator)" strokeWidth={1} />
              <text x={PAD.l - 6} y={vy(v) + 3} textAnchor="end" fontSize={10} fill="var(--color-label-tertiary)">
                {v}
              </text>
            </g>
          ))}
          {vibes.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--color-foreground)"
              strokeWidth={2}
              strokeLinejoin="round"
              points={vibes.map((e) => `${x(new Date(e.occurredAt).getTime())},${vy(e.vibe!)}`).join(" ")}
            />
          )}
          {events.map((e) => {
            const cx = x(new Date(e.occurredAt).getTime());
            const lines = [
              `${fmtDay(new Date(e.occurredAt))} · ${e.kind}`,
              e.title,
              ...(e.vibe ? [`Vibe ${e.vibe}/10`] : []),
            ];
            return e.vibe ? (
              <g key={e.id} onMouseMove={(ev) => show(ev, lines)}>
                <circle cx={cx} cy={vy(e.vibe)} r={12} fill="transparent" />
                <circle
                  cx={cx}
                  cy={vy(e.vibe)}
                  r={e.kind === "conflict" ? 5 : 4.5}
                  fill={e.kind === "conflict" ? "var(--color-destructive)" : "var(--color-foreground)"}
                  stroke="var(--color-card)"
                  strokeWidth={2}
                />
              </g>
            ) : (
              <g key={e.id} onMouseMove={(ev) => show(ev, lines)}>
                <rect x={cx - 6} y={VIBE_H - 22} width={12} height={20} fill="transparent" />
                <line x1={cx} x2={cx} y1={VIBE_H - 16} y2={VIBE_H - 6} stroke="var(--color-label-tertiary)" strokeWidth={2} strokeLinecap="round" />
              </g>
            );
          })}
          {ticks.map((t, i) => (
            <text key={t} x={x(t)} y={VIBE_H + 12} textAnchor="middle" fontSize={10} fill="var(--color-label-tertiary)">
              {fmtMonth(new Date(t), i === 0)}
            </text>
          ))}
        </svg>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-elevated)] px-2.5 py-1.5 text-xs shadow-popover"
          style={{ left: Math.min(hover.x + 12, Math.max(0, width - 180)), top: hover.y + 12 }}
        >
          <div className="font-medium">{hover.lines[0]}</div>
          {hover.lines.slice(1).map((l, i) => (
            <div key={i} className="text-[var(--color-muted-foreground)]">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Bar({ x, y, w, h, fill, top }: { x: number; y: number; w: number; h: number; fill: string; top: boolean }) {
  // Round only the data end (top) of the stack; the baseline end stays square.
  const r = Math.min(top ? 4 : 0, w / 2, h);
  if (!r) return <rect x={x} y={y} width={w} height={h} fill={fill} />;
  return (
    <path
      d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`}
      fill={fill}
    />
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function niceMax(n: number): number {
  for (const step of [2, 4, 10, 20, 40, 100, 200, 400, 1000]) {
    if (n <= step) return step;
  }
  return Math.ceil(n / 1000) * 1000;
}
