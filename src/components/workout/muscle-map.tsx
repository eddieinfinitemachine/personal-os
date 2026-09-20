"use client";

import type { Muscle } from "@/lib/workout";

// Front + back body silhouettes with the worked muscle groups tinted.
// Deliberately schematic: rounded shapes on a neutral outline so it reads at
// 80px wide on a phone and in both themes.

type Region = { muscle: Muscle; d: string };

// viewBox 0 0 100 220 per figure. Shapes are symmetric pairs where relevant.
const FRONT: Region[] = [
  { muscle: "shoulders", d: "M26 52 a9 9 0 1 0 0.1 0 M74 52 a9 9 0 1 0 0.1 0" },
  { muscle: "chest", d: "M35 55 h30 a4 4 0 0 1 4 4 v14 a6 6 0 0 1 -6 6 h-26 a6 6 0 0 1 -6 -6 v-14 a4 4 0 0 1 4 -4z" },
  { muscle: "biceps", d: "M19 63 h10 v22 a5 5 0 0 1 -10 0z M71 63 h10 v22 a5 5 0 0 1 -10 0z" },
  { muscle: "forearms", d: "M17 90 h9 v24 a4.5 4.5 0 0 1 -9 0z M74 90 h9 v24 a4.5 4.5 0 0 1 -9 0z" },
  { muscle: "core", d: "M40 82 h20 v30 a5 5 0 0 1 -5 5 h-10 a5 5 0 0 1 -5 -5z" },
  { muscle: "obliques", d: "M31 82 h7 v30 h-4 a4 4 0 0 1 -4 -4z M62 82 h7 v26 a4 4 0 0 1 -4 4 h-3z" },
  { muscle: "quads", d: "M31 122 h16 v40 a8 8 0 0 1 -16 0z M53 122 h16 v40 a8 8 0 0 1 -16 0z" },
  { muscle: "calves", d: "M33 172 h11 v28 a5.5 5.5 0 0 1 -11 0z M56 172 h11 v28 a5.5 5.5 0 0 1 -11 0z" },
];
const BACK: Region[] = [
  { muscle: "shoulders", d: "M26 52 a9 9 0 1 0 0.1 0 M74 52 a9 9 0 1 0 0.1 0" },
  { muscle: "upper-back", d: "M36 54 h28 v18 h-28z" },
  { muscle: "lats", d: "M32 74 h36 l-6 26 h-24z" },
  { muscle: "triceps", d: "M19 63 h10 v22 a5 5 0 0 1 -10 0z M71 63 h10 v22 a5 5 0 0 1 -10 0z" },
  { muscle: "forearms", d: "M17 90 h9 v24 a4.5 4.5 0 0 1 -9 0z M74 90 h9 v24 a4.5 4.5 0 0 1 -9 0z" },
  { muscle: "lower-back", d: "M41 102 h18 v14 h-18z" },
  { muscle: "glutes", d: "M31 118 h17 v18 a8 8 0 0 1 -17 0z M52 118 h17 v18 a8 8 0 0 1 -17 0z" },
  { muscle: "hamstrings", d: "M31 140 h16 v26 a8 8 0 0 1 -16 0z M53 140 h16 v26 a8 8 0 0 1 -16 0z" },
  { muscle: "calves", d: "M33 172 h11 v28 a5.5 5.5 0 0 1 -11 0z M56 172 h11 v28 a5.5 5.5 0 0 1 -11 0z" },
];

const OUTLINE =
  "M50 8 a12 12 0 1 0 0.1 0 M38 34 h24 l14 14 l6 40 l-10 4 l-4 -28 v46 l4 50 l-6 44 h-12 l-4 -40 l-2 -46 l-2 46 l-4 40 h-12 l-6 -44 l4 -50 v-46 l-4 28 l-10 -4 l6 -40z";

function Figure({ regions, active, label }: { regions: Region[]; active: Set<Muscle>; label: string }) {
  return (
    <svg viewBox="0 0 100 220" className="h-full w-auto" role="img" aria-label={label}>
      <path d={OUTLINE} fill="var(--color-fill)" stroke="var(--color-separator)" strokeWidth={1.5} strokeLinejoin="round" />
      {regions.map((r) => {
        const on = active.has(r.muscle);
        return (
          <path
            key={r.muscle}
            d={r.d}
            fill={on ? "var(--color-tint)" : "var(--color-label-quaternary)"}
            opacity={on ? 0.9 : 0.35}
            className="transition-opacity duration-300"
          />
        );
      })}
    </svg>
  );
}

export function MuscleMap({ muscles, className }: { muscles: Muscle[]; className?: string }) {
  const active = new Set(muscles);
  return (
    <div className={`flex items-stretch justify-center gap-2 ${className ?? ""}`}>
      <Figure regions={FRONT} active={active} label="front muscles" />
      <Figure regions={BACK} active={active} label="back muscles" />
    </div>
  );
}
