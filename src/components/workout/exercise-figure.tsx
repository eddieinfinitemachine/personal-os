"use client";

import { useSyncExternalStore } from "react";
import type { MovementPattern } from "@/lib/workout";

// Animated side-view stick figure, one loop per movement pattern.
//
// A pose is a set of joint angles (degrees). Each pattern is a short list of
// keyframes; we sample an eased ping-pong through them once at render time
// and let SVG's own <animate> (SMIL) play the loop — no per-frame JavaScript,
// no React re-renders, and the markup is identical on server and client.
// Angles:
//   torso     from vertical-up; + leans forward (toward +x)
//   thigh     from vertical-down at the hip; + swings forward (+x)
//   knee      bend relative to the thigh; + folds the shin backward
//   upperArm  relative to the torso line; 0 hangs along the torso, + raises forward
//   elbow     bend relative to the upper arm; + folds the forearm forward/up
//   lift      px the whole body is raised off the ground (jumps)
//   head      tilt from the torso line
// The hip height is solved so the lowest foot sits on the ground line, which
// keeps squats/hinges grounded without hand-placing every keyframe.

type Pose = {
  torso: number;
  thigh: number;
  knee: number;
  upperArm: number;
  elbow: number;
  lift?: number;
  head?: number;
  /** Optional second leg/arm (defaults mirror the first) for lunges. */
  thigh2?: number;
  knee2?: number;
  upperArm2?: number;
  elbow2?: number;
  /** A prop line: dumbbell at the hands, bar overhead, etc. */
  prop?: "dumbbell" | "bar" | "band" | "none";
};

type Loop = { frames: Pose[]; periodMs: number; ground?: boolean };

const P = (p: Pose): Pose => ({ prop: "none", ...p });

const LOOPS: Record<MovementPattern, Loop> = {
  squat: {
    periodMs: 2600,
    frames: [
      P({ torso: 5, thigh: 5, knee: 5, upperArm: 25, elbow: 100, prop: "dumbbell" }),
      P({ torso: 30, thigh: 85, knee: 110, upperArm: 10, elbow: 100, prop: "dumbbell" }),
    ],
  },
  hinge: {
    periodMs: 2800,
    frames: [
      P({ torso: 5, thigh: 3, knee: 5, upperArm: -5, elbow: 0, prop: "dumbbell" }),
      P({ torso: 80, thigh: -15, knee: 25, upperArm: -80, elbow: 0, prop: "dumbbell" }),
    ],
  },
  lunge: {
    periodMs: 2600,
    frames: [
      P({ torso: 3, thigh: 5, knee: 5, thigh2: -5, knee2: 5, upperArm: 0, elbow: 0, prop: "dumbbell" }),
      P({ torso: 5, thigh: 60, knee: 95, thigh2: -45, knee2: 100, upperArm: 0, elbow: 0, prop: "dumbbell" }),
    ],
  },
  "push-horizontal": {
    periodMs: 2200,
    frames: [
      // push-up: top (arms straight, hips high) → bottom (elbows back, chest low)
      P({ torso: 80, thigh: -59, knee: 0, upperArm: -80, elbow: 0, head: -30 }),
      P({ torso: 80, thigh: -79, knee: 0, upperArm: -170, elbow: 90, head: -30 }),
    ],
    ground: true,
  },
  "push-vertical": {
    periodMs: 2400,
    frames: [
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 30, elbow: 140, prop: "dumbbell" }),
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 175, elbow: 5, prop: "dumbbell" }),
    ],
  },
  "pull-horizontal": {
    periodMs: 2400,
    frames: [
      P({ torso: 55, thigh: -10, knee: 30, upperArm: -55, elbow: 0, prop: "dumbbell" }),
      P({ torso: 55, thigh: -10, knee: 30, upperArm: -120, elbow: 120, prop: "dumbbell" }),
    ],
  },
  "pull-vertical": {
    periodMs: 2600,
    frames: [
      P({ torso: 0, thigh: 5, knee: 20, upperArm: 175, elbow: 5, lift: 40, prop: "bar" }),
      P({ torso: 0, thigh: 5, knee: 20, upperArm: 150, elbow: 130, lift: 68, prop: "bar" }),
    ],
  },
  curl: {
    periodMs: 2200,
    frames: [
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 5, elbow: 10, prop: "dumbbell" }),
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 10, elbow: 135, prop: "dumbbell" }),
    ],
  },
  extension: {
    periodMs: 2200,
    frames: [
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 175, elbow: 120, prop: "dumbbell" }),
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 178, elbow: 5, prop: "dumbbell" }),
    ],
  },
  plank: {
    periodMs: 3000,
    frames: [
      // forearm plank: upper arm vertical, forearm flat on the ground
      P({ torso: 80, thigh: -78, knee: 0, upperArm: -80, elbow: 90, head: -30 }),
      P({ torso: 80, thigh: -78, knee: 0, upperArm: -80, elbow: 90, head: -30, lift: 1 }),
    ],
    ground: true,
  },
  crunch: {
    periodMs: 2400,
    frames: [
      // lying on the back, knees bent
      P({ torso: -85, thigh: 130, knee: 90, upperArm: 160, elbow: 120, head: 10 }),
      P({ torso: -50, thigh: 130, knee: 90, upperArm: 160, elbow: 120, head: 20 }),
    ],
    ground: true,
  },
  jump: {
    periodMs: 1600,
    frames: [
      P({ torso: 15, thigh: 45, knee: 70, upperArm: -40, elbow: 20 }),
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 170, elbow: 0, lift: 34 }),
      P({ torso: 15, thigh: 45, knee: 70, upperArm: -40, elbow: 20 }),
    ],
  },
  carry: {
    periodMs: 1400,
    frames: [
      P({ torso: 2, thigh: 25, knee: 10, thigh2: -20, knee2: 30, upperArm: 0, elbow: 0, prop: "dumbbell" }),
      P({ torso: 2, thigh: -20, knee: 30, thigh2: 25, knee2: 10, upperArm: 0, elbow: 0, prop: "dumbbell" }),
    ],
  },
  stretch: {
    periodMs: 3600,
    frames: [
      P({ torso: 0, thigh: 0, knee: 0, upperArm: 20, elbow: 0 }),
      P({ torso: 20, thigh: 0, knee: 0, upperArm: 170, elbow: 0 }),
    ],
  },
  cardio: {
    periodMs: 900,
    frames: [
      P({ torso: 8, thigh: 40, knee: 30, thigh2: -30, knee2: 90, upperArm: 35, elbow: 90, upperArm2: -35, elbow2: 90, lift: 4 }),
      P({ torso: 8, thigh: -30, knee: 90, thigh2: 40, knee2: 30, upperArm: -35, elbow: 90, upperArm2: 35, elbow2: 90, lift: 4 }),
    ],
  },
};

const LEN = { shin: 40, thigh: 40, torso: 50, upper: 26, fore: 24, head: 11 };
const GROUND_Y = 176;
const HIP_X = 100;

const rad = (d: number) => (d * Math.PI) / 180;

function solve(p: Pose) {
  // Legs (angles from vertical-down; +x forward).
  const legs = [
    { thigh: p.thigh, knee: p.knee },
    { thigh: p.thigh2 ?? p.thigh, knee: p.knee2 ?? p.knee },
  ].map((l) => {
    const kx = LEN.thigh * Math.sin(rad(l.thigh));
    const ky = LEN.thigh * Math.cos(rad(l.thigh));
    const shinAngle = l.thigh - l.knee; // knee bend folds the shin backward
    const fx = kx + LEN.shin * Math.sin(rad(shinAngle));
    const fy = ky + LEN.shin * Math.cos(rad(shinAngle));
    return { kx, ky, fx, fy };
  });

  // Torso from the hip, angle from vertical-up.
  const sx = LEN.torso * Math.sin(rad(p.torso));
  const sy = -LEN.torso * Math.cos(rad(p.torso));

  // Arms hang along the torso direction (pointing down from the shoulder).
  const arms = [
    { upper: p.upperArm, elbow: p.elbow },
    { upper: p.upperArm2 ?? p.upperArm, elbow: p.elbow2 ?? p.elbow },
  ].map((a) => {
    const upperAngle = p.torso + a.upper; // from vertical-down at the shoulder
    const ex = sx + LEN.upper * Math.sin(rad(upperAngle));
    const ey = sy + LEN.upper * Math.cos(rad(upperAngle));
    const foreAngle = upperAngle + a.elbow;
    const hx = ex + LEN.fore * Math.sin(rad(foreAngle));
    const hy = ey + LEN.fore * Math.cos(rad(foreAngle));
    return { ex, ey, hx, hy };
  });

  const headAngle = p.torso + (p.head ?? 0);
  const hx = sx + (LEN.head + 4) * Math.sin(rad(headAngle));
  const hy = sy - (LEN.head + 4) * Math.cos(rad(headAngle));

  // Ground the figure on its lowest point (foot, hand or head).
  const lowest = Math.max(
    ...legs.map((l) => l.fy),
    ...arms.map((a) => a.hy),
    hy + LEN.head,
    0,
  );
  const hipY = GROUND_Y - lowest - (p.lift ?? 0);
  return { legs, arms, sx, sy, hx, hy, hipY };
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const keys: (keyof Pose)[] = [
    "torso", "thigh", "knee", "upperArm", "elbow", "lift", "head",
    "thigh2", "knee2", "upperArm2", "elbow2",
  ];
  const out: Pose = { ...a };
  for (const k of keys) {
    const av = (a[k] ?? (k.endsWith("2") ? a[k.slice(0, -1) as keyof Pose] : 0)) as number;
    const bv = (b[k] ?? (k.endsWith("2") ? b[k.slice(0, -1) as keyof Pose] : 0)) as number;
    (out as Record<string, unknown>)[k] = av + (bv - av) * t;
  }
  out.prop = a.prop ?? b.prop;
  return out;
}

const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

const SAMPLES = 24;

// Sample the loop at SAMPLES evenly spaced times, ping-ponging through the
// keyframes (0 → 1 → … → n-1 → … → 0) with ease-in-out on every segment.
function samplePoses(loop: Loop): Pose[] {
  const n = loop.frames.length;
  if (n === 1) return [loop.frames[0]];
  const segs = (n - 1) * 2;
  const out: Pose[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const u = (k / SAMPLES) * segs;
    const seg = Math.min(segs - 1, Math.floor(u));
    const t = easeInOut(u - seg);
    const forward = seg < n - 1;
    const i = forward ? seg : segs - seg;
    const j = forward ? seg + 1 : segs - seg - 1;
    out.push(lerpPose(loop.frames[i], loop.frames[j], t));
  }
  return out;
}

// Node and browser Math.sin/cos differ in the last ulp, which would show up as
// a hydration mismatch on SSR'd coordinates. Two decimals is plenty for SVG.
const r = (n: number) => Math.round(n * 100) / 100;

type Frame = ReturnType<typeof solve>;

// prefers-reduced-motion, hydration-safe: the server and first client render
// both say "no preference", then the real value takes over after mount.
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb: () => void) {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
}

export type FigureProp = "dumbbell" | "bar" | "none";

// What the hands hold, from the exercise's equipment/load text. Poses that
// already hang from a bar (pull-ups) keep it; bodyweight-only poses ignore it.
export function propForEquipment(...texts: string[]): FigureProp {
  const t = texts.join(" ").toLowerCase();
  if (/barbell|\bbar\b|pull-?up|chin-?up|trap bar|ez/.test(t)) return "bar";
  if (/dumbbell|kettlebell|\bdb\b|\bkb\b|plate|\bweight|band|cable|medicine|slam|sandbag/.test(t)) return "dumbbell";
  return "none";
}

export function ExerciseFigure({
  pattern,
  playing = true,
  prop,
  frame,
  className,
}: {
  pattern: MovementPattern;
  playing?: boolean;
  /** Override what the hands hold; omit to use the pose default. */
  prop?: FigureProp;
  /** Freeze on a keyframe index (for galleries/tests). */
  frame?: number;
  className?: string;
}) {
  const loop = LOOPS[pattern] ?? LOOPS.stretch;
  const reduceMotion = useReducedMotion();
  const animate = playing && frame === undefined && !reduceMotion;
  const poses: Pose[] = animate
    ? samplePoses(loop)
    : [loop.frames[Math.max(0, Math.min(frame ?? 1, loop.frames.length - 1))]];
  const frames: Frame[] = poses.map(solve);
  const first = frames[0];
  const basePose = poses[0];
  const shown: Pose["prop"] =
    basePose.prop === "none" || basePose.prop === "bar" ? basePose.prop : (prop ?? basePose.prop);

  const ox = HIP_X;
  const dur = `${loop.periodMs}ms`;
  const stroke = "var(--color-foreground)";
  const propStroke = "var(--color-tint)";

  // Close the loop by appending the first sample so SMIL wraps smoothly.
  const series = (pick: (f: Frame) => number) => {
    const vals = frames.map((f) => r(pick(f)));
    vals.push(vals[0]);
    return vals.join(";");
  };
  const anim = (attr: string, pick: (f: Frame) => number) =>
    animate ? <animate attributeName={attr} values={series(pick)} dur={dur} repeatCount="indefinite" /> : null;

  const seg = (
    key: string,
    x1: (f: Frame) => number,
    y1: (f: Frame) => number,
    x2: (f: Frame) => number,
    y2: (f: Frame) => number,
    dim = false,
  ) => (
    <line
      key={key}
      x1={r(ox + x1(first))}
      y1={r(first.hipY + y1(first))}
      x2={r(ox + x2(first))}
      y2={r(first.hipY + y2(first))}
      stroke={stroke}
      strokeWidth={dim ? 4 : 5}
      strokeLinecap="round"
      opacity={dim ? 0.45 : 1}
    >
      {anim("x1", (f) => ox + x1(f))}
      {anim("y1", (f) => f.hipY + y1(f))}
      {anim("x2", (f) => ox + x2(f))}
      {anim("y2", (f) => f.hipY + y2(f))}
    </line>
  );

  const handX = (f: Frame) => ox + f.arms[0].hx;
  const handY = (f: Frame) => f.hipY + f.arms[0].hy;

  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label={`${pattern} movement`}
    >
      <line x1={12} y1={GROUND_Y + 8} x2={188} y2={GROUND_Y + 8} stroke="var(--color-separator)" strokeWidth={2} strokeLinecap="round" />
      {/* far limbs first, dimmed */}
      {seg("thigh2", () => 0, () => 0, (f) => f.legs[1].kx, (f) => f.legs[1].ky, true)}
      {seg("shin2", (f) => f.legs[1].kx, (f) => f.legs[1].ky, (f) => f.legs[1].fx, (f) => f.legs[1].fy, true)}
      {seg("upper2", (f) => f.sx, (f) => f.sy, (f) => f.arms[1].ex, (f) => f.arms[1].ey, true)}
      {seg("fore2", (f) => f.arms[1].ex, (f) => f.arms[1].ey, (f) => f.arms[1].hx, (f) => f.arms[1].hy, true)}
      {/* torso + head */}
      {seg("torso", () => 0, () => 0, (f) => f.sx, (f) => f.sy)}
      <circle cx={r(ox + first.hx)} cy={r(first.hipY + first.hy)} r={LEN.head} fill="none" stroke={stroke} strokeWidth={5}>
        {anim("cx", (f) => ox + f.hx)}
        {anim("cy", (f) => f.hipY + f.hy)}
      </circle>
      {/* near limbs */}
      {seg("thigh", () => 0, () => 0, (f) => f.legs[0].kx, (f) => f.legs[0].ky)}
      {seg("shin", (f) => f.legs[0].kx, (f) => f.legs[0].ky, (f) => f.legs[0].fx, (f) => f.legs[0].fy)}
      {seg("upper", (f) => f.sx, (f) => f.sy, (f) => f.arms[0].ex, (f) => f.arms[0].ey)}
      {seg("fore", (f) => f.arms[0].ex, (f) => f.arms[0].ey, (f) => f.arms[0].hx, (f) => f.arms[0].hy)}
      {/* prop rides on the near hand */}
      {shown !== "none" && (
        <g transform={`translate(${r(handX(first))} ${r(handY(first))})`}>
          {animate && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values={[...frames, frames[0]].map((f) => `${r(handX(f))} ${r(handY(f))}`).join(";")}
              dur={dur}
              repeatCount="indefinite"
            />
          )}
          {shown === "dumbbell" ? (
            <>
              <line x1={-9} y1={0} x2={9} y2={0} stroke={propStroke} strokeWidth={4} strokeLinecap="round" />
              <rect x={-12} y={-6} width={5} height={12} rx={1.5} fill={propStroke} />
              <rect x={7} y={-6} width={5} height={12} rx={1.5} fill={propStroke} />
            </>
          ) : (
            <line x1={-40} y1={0} x2={40} y2={0} stroke={propStroke} strokeWidth={4} strokeLinecap="round" />
          )}
        </g>
      )}
    </svg>
  );
}
