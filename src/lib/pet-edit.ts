// Natural-language pet edits, shared by /api/projects/[id]/ask. Claude
// proposes structured actions (log a weight, record a vaccination, …) parsed
// from the owner's chat message; this module owns validating those proposals
// and applying them with Prisma. The route owns prompt building.

import { prisma } from "@/lib/prisma";

export type PetAction =
  | {
      type: "add_weight";
      weightLb: number;
      measuredAt: Date;
      notes: string | null;
    }
  | {
      type: "add_vaccination";
      name: string;
      administeredAt: Date;
      boosterDueAt: Date | null;
      vet: string | null;
      notes: string | null;
    }
  | {
      type: "add_vet_visit";
      performedAt: Date;
      reason: string;
      vet: string | null;
      details: string | null;
      costUsd: number | null;
    }
  | {
      type: "update_profile";
      fields: Record<string, unknown>;
    };

// Same whitelist as PATCH /api/pets/[id].
const PROFILE_FIELDS = new Set([
  "name",
  "species",
  "breed",
  "sex",
  "color",
  "birthDate",
  "microchipId",
  "spayedNeuteredAt",
  "feedingSchedule",
  "notes",
  "vetClinic",
  "vetPhone",
  "vetAddress",
]);

const PROFILE_DATE_FIELDS = new Set(["birthDate", "spayedNeuteredAt"]);

const MAX_ACTIONS = 10;

function parseDate(v: unknown, fallback: Date | null): Date | null {
  if (typeof v !== "string" || !v.trim()) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function optionalString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Validate Claude's raw `actions` array into well-typed actions. Invalid or
 * unrecognized entries are silently dropped — a partial edit beats a 500.
 */
export function validatePetActions(raw: unknown): PetAction[] {
  if (!Array.isArray(raw)) return [];
  const now = new Date();
  const out: PetAction[] = [];
  for (const entry of raw.slice(0, MAX_ACTIONS)) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    if (a.type === "add_weight") {
      const weightLb = typeof a.weightLb === "number" ? a.weightLb : NaN;
      if (!Number.isFinite(weightLb) || weightLb <= 0 || weightLb > 500) continue;
      out.push({
        type: "add_weight",
        weightLb,
        measuredAt: parseDate(a.measuredAt, now)!,
        notes: optionalString(a.notes),
      });
    } else if (a.type === "add_vaccination") {
      const name = optionalString(a.name);
      if (!name) continue;
      out.push({
        type: "add_vaccination",
        name,
        administeredAt: parseDate(a.administeredAt, now)!,
        boosterDueAt: parseDate(a.boosterDueAt, null),
        vet: optionalString(a.vet),
        notes: optionalString(a.notes),
      });
    } else if (a.type === "add_vet_visit") {
      const reason = optionalString(a.reason);
      if (!reason) continue;
      const costUsd =
        typeof a.costUsd === "number" && Number.isFinite(a.costUsd) && a.costUsd >= 0
          ? a.costUsd
          : null;
      out.push({
        type: "add_vet_visit",
        performedAt: parseDate(a.performedAt, now)!,
        reason,
        vet: optionalString(a.vet),
        details: optionalString(a.details),
        costUsd,
      });
    } else if (a.type === "update_profile") {
      const rawFields =
        a.fields && typeof a.fields === "object"
          ? (a.fields as Record<string, unknown>)
          : {};
      const fields: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(rawFields)) {
        if (!PROFILE_FIELDS.has(key)) continue;
        if (PROFILE_DATE_FIELDS.has(key)) {
          fields[key] = typeof v === "string" && v ? parseDate(v, null) : null;
        } else if (typeof v === "string" || v === null) {
          fields[key] = typeof v === "string" ? v.trim() : null;
        }
      }
      if (Object.keys(fields).length === 0) continue;
      out.push({ type: "update_profile", fields });
    }
  }
  return out;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Apply validated actions to the pet. Returns one human-readable summary line
 * per applied action (shown in the chat as "changes applied"). A failing
 * action is skipped so the rest still land.
 */
export async function applyPetActions(
  userId: string,
  petId: string,
  actions: PetAction[]
): Promise<string[]> {
  const applied: string[] = [];
  for (const action of actions) {
    try {
      if (action.type === "add_weight") {
        await prisma.petWeight.create({
          data: {
            userId,
            petId,
            weightLb: action.weightLb,
            measuredAt: action.measuredAt,
            notes: action.notes,
          },
        });
        applied.push(
          `Logged weight: ${action.weightLb} lb (${fmtDate(action.measuredAt)})`
        );
      } else if (action.type === "add_vaccination") {
        await prisma.petVaccination.create({
          data: {
            userId,
            petId,
            name: action.name,
            administeredAt: action.administeredAt,
            boosterDueAt: action.boosterDueAt,
            vet: action.vet,
            notes: action.notes,
          },
        });
        applied.push(
          `Recorded vaccination: ${action.name} (${fmtDate(action.administeredAt)})`
        );
      } else if (action.type === "add_vet_visit") {
        await prisma.petVetVisit.create({
          data: {
            userId,
            petId,
            performedAt: action.performedAt,
            reason: action.reason,
            vet: action.vet,
            details: action.details,
            costUsd: action.costUsd,
          },
        });
        applied.push(
          `Recorded vet visit: ${action.reason} (${fmtDate(action.performedAt)})`
        );
      } else if (action.type === "update_profile") {
        await prisma.pet.update({ where: { id: petId }, data: action.fields });
        applied.push(
          `Updated profile: ${Object.keys(action.fields).join(", ")}`
        );
      }
    } catch {
      // Skip the failing action; the summary only lists what actually landed.
    }
  }
  return applied;
}
