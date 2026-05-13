import { prisma } from "@/lib/prisma";

export const DEFAULT_LISTS = [
  { name: "To Do", color: "blue", position: 0 },
  { name: "Monitor", color: "amber", position: 1 },
  { name: "Later", color: "zinc", position: 2 },
] as const;

// Each list color resolves to a bundle of static Tailwind classes so the
// JIT picks them up. iOS Reminders styling uses dot, text, ring (for the
// hovered checkbox), and a soft tint for hover backgrounds.
export const LIST_PALETTE = {
  blue: {
    dot: "bg-blue-500",
    text: "text-blue-500",
    ring: "ring-blue-500/50",
    hoverBorder: "hover:border-blue-500",
    softBg: "bg-blue-500/10",
    fill: "bg-blue-500 border-blue-500",
  },
  amber: {
    dot: "bg-amber-500",
    text: "text-amber-500",
    ring: "ring-amber-500/50",
    hoverBorder: "hover:border-amber-500",
    softBg: "bg-amber-500/10",
    fill: "bg-amber-500 border-amber-500",
  },
  zinc: {
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    ring: "ring-zinc-400/50",
    hoverBorder: "hover:border-zinc-400",
    softBg: "bg-zinc-500/10",
    fill: "bg-zinc-500 border-zinc-500",
  },
  emerald: {
    dot: "bg-emerald-500",
    text: "text-emerald-500",
    ring: "ring-emerald-500/50",
    hoverBorder: "hover:border-emerald-500",
    softBg: "bg-emerald-500/10",
    fill: "bg-emerald-500 border-emerald-500",
  },
  rose: {
    dot: "bg-rose-500",
    text: "text-rose-500",
    ring: "ring-rose-500/50",
    hoverBorder: "hover:border-rose-500",
    softBg: "bg-rose-500/10",
    fill: "bg-rose-500 border-rose-500",
  },
  violet: {
    dot: "bg-violet-500",
    text: "text-violet-500",
    ring: "ring-violet-500/50",
    hoverBorder: "hover:border-violet-500",
    softBg: "bg-violet-500/10",
    fill: "bg-violet-500 border-violet-500",
  },
  cyan: {
    dot: "bg-cyan-500",
    text: "text-cyan-500",
    ring: "ring-cyan-500/50",
    hoverBorder: "hover:border-cyan-500",
    softBg: "bg-cyan-500/10",
    fill: "bg-cyan-500 border-cyan-500",
  },
  orange: {
    dot: "bg-orange-500",
    text: "text-orange-500",
    ring: "ring-orange-500/50",
    hoverBorder: "hover:border-orange-500",
    softBg: "bg-orange-500/10",
    fill: "bg-orange-500 border-orange-500",
  },
} as const;

export type ListColor = keyof typeof LIST_PALETTE;

export function isListColor(v: unknown): v is ListColor {
  return typeof v === "string" && v in LIST_PALETTE;
}

export function palette(color: string) {
  return LIST_PALETTE[(color as ListColor) in LIST_PALETTE ? (color as ListColor) : "zinc"];
}

// Idempotent: ensures the three default lists exist. Module-level guard so
// we only hit the DB once per server process — every subsequent page load
// is a no-op.
let ensured = false;
export async function ensureDefaultLists(): Promise<void> {
  if (ensured) return;
  const count = await prisma.list.count({ where: { isDefault: true } });
  if (count >= DEFAULT_LISTS.length) {
    ensured = true;
    return;
  }
  for (const def of DEFAULT_LISTS) {
    const existing = await prisma.list.findFirst({
      where: { isDefault: true, name: def.name },
    });
    if (!existing) {
      await prisma.list.create({ data: { ...def, isDefault: true } });
    }
  }
  ensured = true;
}
