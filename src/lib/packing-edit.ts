// AI packing-list edits, shared by the packing generate + chat routes. Claude
// proposes structured actions (add/update/remove/check items) parsed from the
// traveler's chat message; this module owns validating those proposals and
// applying them with Prisma, plus the trip-state context block both routes
// feed into their prompts. The routes own the rest of their prompt building.

import { prisma } from "@/lib/prisma";
import type { PackingItem, Trip, TripItem } from "@prisma/client";

export type PackingAction =
  | {
      type: "add_item";
      title: string;
      category: string;
      quantity: number;
      notes: string | null;
    }
  | {
      type: "update_item";
      id: string;
      fields: Record<string, unknown>;
    }
  | { type: "remove_item"; id: string }
  | { type: "set_packed"; id: string; packed: boolean };

const MAX_ACTIONS = 40;
export const CATEGORIES =
  "Clothing, Toiletries, Electronics, Documents, Gear, Health, Other";

function optionalString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function cleanQuantity(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1
    ? Math.min(Math.round(v), 99)
    : 1;
}

/**
 * Validate Claude's raw `actions` array into well-typed actions. Invalid or
 * unrecognized entries are silently dropped — a partial edit beats a 500.
 */
export function validatePackingActions(raw: unknown): PackingAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PackingAction[] = [];
  for (const entry of raw.slice(0, MAX_ACTIONS)) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    if (a.type === "add_item") {
      const title = optionalString(a.title);
      if (!title) continue;
      out.push({
        type: "add_item",
        title,
        category: optionalString(a.category) ?? "Other",
        quantity: cleanQuantity(a.quantity),
        notes: optionalString(a.notes),
      });
    } else if (a.type === "update_item") {
      const id = optionalString(a.id);
      const rawFields =
        a.fields && typeof a.fields === "object"
          ? (a.fields as Record<string, unknown>)
          : {};
      if (!id) continue;
      const fields: Record<string, unknown> = {};
      const title = optionalString(rawFields.title);
      if (title) fields.title = title;
      const category = optionalString(rawFields.category);
      if (category) fields.category = category;
      if (rawFields.quantity !== undefined) {
        fields.quantity = cleanQuantity(rawFields.quantity);
      }
      if (rawFields.notes !== undefined) {
        fields.notes = optionalString(rawFields.notes);
      }
      if (Object.keys(fields).length === 0) continue;
      out.push({ type: "update_item", id, fields });
    } else if (a.type === "remove_item") {
      const id = optionalString(a.id);
      if (id) out.push({ type: "remove_item", id });
    } else if (a.type === "set_packed") {
      const id = optionalString(a.id);
      if (id && typeof a.packed === "boolean") {
        out.push({ type: "set_packed", id, packed: a.packed });
      }
    }
  }
  return out;
}

/**
 * Apply validated actions to the trip's packing list. Item ids come from the
 * model, so every mutation is scoped to (id, tripId, userId) — an id outside
 * this trip is a silent no-op. Returns one summary line per applied action.
 */
export async function applyPackingActions(
  userId: string,
  tripId: string,
  actions: PackingAction[]
): Promise<string[]> {
  const applied: string[] = [];
  const max = await prisma.packingItem.aggregate({
    where: { tripId },
    _max: { position: true },
  });
  let position = (max._max.position ?? -1) + 1;
  for (const action of actions) {
    try {
      if (action.type === "add_item") {
        await prisma.packingItem.create({
          data: {
            userId,
            tripId,
            title: action.title,
            category: action.category,
            quantity: action.quantity,
            notes: action.notes,
            position: position++,
          },
        });
        applied.push(
          `Added ${action.title}${action.quantity > 1 ? ` ×${action.quantity}` : ""}`
        );
      } else if (action.type === "update_item") {
        const res = await prisma.packingItem.updateMany({
          where: { id: action.id, tripId, userId },
          data: action.fields,
        });
        if (res.count > 0) {
          applied.push(
            `Updated ${typeof action.fields.title === "string" ? action.fields.title : "item"}`
          );
        }
      } else if (action.type === "remove_item") {
        const item = await prisma.packingItem.findFirst({
          where: { id: action.id, tripId, userId },
        });
        if (item) {
          await prisma.packingItem.delete({ where: { id: item.id } });
          applied.push(`Removed ${item.title}`);
        }
      } else if (action.type === "set_packed") {
        const item = await prisma.packingItem.findFirst({
          where: { id: action.id, tripId, userId },
        });
        if (item) {
          await prisma.packingItem.update({
            where: { id: item.id },
            data: { packedAt: action.packed ? item.packedAt ?? new Date() : null },
          });
          applied.push(`${action.packed ? "Checked" : "Unchecked"} ${item.title}`);
        }
      }
    } catch {
      // Skip the failing action; the summary only lists what actually landed.
    }
  }
  return applied;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/**
 * Plain-text trip state for the generate/chat prompts: trip facts, itinerary,
 * the traveler's own description, weather, and (optionally) the current
 * packing list with item ids so the chat can reference them in actions.
 */
export function buildTripPackingContext(opts: {
  trip: Trip;
  itinerary: TripItem[];
  packingItems?: PackingItem[];
  weather: string | null;
  packingContext: string | null;
}): string {
  const { trip, itinerary, packingItems, weather, packingContext } = opts;
  const lines: string[] = [];
  lines.push(`Today: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`Trip: ${trip.name}`);
  if (trip.destination) lines.push(`Destination: ${trip.destination}`);
  lines.push(`Dates: ${fmtDate(trip.startDate)} → ${fmtDate(trip.endDate)}`);
  if (trip.travelers.length > 0)
    lines.push(`Travelers: ${trip.travelers.join(", ")}`);
  if (trip.transport) lines.push(`Getting there: ${trip.transport}`);
  if (trip.accommodation) lines.push(`Staying at: ${trip.accommodation}`);
  if (trip.notes) lines.push(`Trip notes: ${trip.notes.slice(0, 1000)}`);

  if (packingContext) {
    lines.push("");
    lines.push("=== What the traveler says they're doing ===");
    lines.push(packingContext.slice(0, 2000));
  }

  const planned = itinerary.filter((it) => it.kind !== "task");
  if (planned.length > 0) {
    lines.push("");
    lines.push("=== Itinerary ===");
    for (const it of planned.slice(0, 40)) {
      const when = it.startAt ? ` (${fmtDate(it.startAt)})` : "";
      const where = it.location ? ` @ ${it.location}` : "";
      lines.push(`  [${it.kind}] ${it.title}${when}${where}`);
    }
  }

  if (weather) {
    lines.push("");
    lines.push("=== Weather ===");
    lines.push(weather);
  }

  if (packingItems) {
    lines.push("");
    lines.push("=== Current packing list ===");
    if (packingItems.length === 0) {
      lines.push("(empty)");
    } else {
      for (const p of packingItems) {
        lines.push(
          `  [id ${p.id}] ${p.title}${p.quantity > 1 ? ` ×${p.quantity}` : ""} — ${p.category}${p.packedAt ? " — PACKED" : ""}`
        );
      }
    }
  }

  return lines.join("\n");
}
