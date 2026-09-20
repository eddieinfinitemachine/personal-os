import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON, type ClaudeContentBlock } from "@/lib/claude";
import {
  buildSystemPrompt,
  buildUserPrompt,
  FOCUS_OPTIONS,
  INTENSITY_OPTIONS,
  normalizePlanResponse,
  type EquipmentItem,
  type PlanRequest,
} from "@/lib/workout";

export const maxDuration = 120;

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024; // client compresses to ~300KB; hard cap anyway
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Photos of the equipment + a few preferences → Claude (vision) → a structured
// workout plan. Nothing is written: the photos live only in this request and
// the client keeps the plan/session in localStorage.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await request.formData();
  const photos = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  if (photos.length > MAX_PHOTOS) {
    return NextResponse.json({ error: `Max ${MAX_PHOTOS} photos.` }, { status: 400 });
  }

  const images: ClaudeContentBlock[] = [];
  for (const photo of photos) {
    if (photo.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "A photo is too large (6 MB max)." }, { status: 413 });
    }
    const type = ALLOWED_TYPES.has(photo.type) ? photo.type : "image/jpeg";
    const buf = Buffer.from(await photo.arrayBuffer());
    images.push({
      type: "image",
      source: { type: "base64", media_type: type, data: buf.toString("base64") },
    });
  }

  let knownEquipment: EquipmentItem[] = [];
  const knownRaw = form.get("knownEquipment");
  if (typeof knownRaw === "string" && knownRaw) {
    try {
      const parsed = JSON.parse(knownRaw) as unknown;
      if (Array.isArray(parsed)) {
        knownEquipment = parsed
          .map((e) => {
            if (!e || typeof e !== "object") return null;
            const o = e as Record<string, unknown>;
            const name = typeof o.name === "string" ? o.name.trim() : "";
            const detail = typeof o.detail === "string" ? o.detail.trim() : "";
            return name ? (detail ? { name, detail } : { name }) : null;
          })
          .filter((e): e is EquipmentItem => e !== null)
          .slice(0, 40);
      }
    } catch {
      return NextResponse.json({ error: "knownEquipment must be JSON" }, { status: 400 });
    }
  }

  const minutesRaw = Number(form.get("minutes"));
  const focusRaw = form.get("focus");
  const intensityRaw = form.get("intensity");
  const recentRaw = form.get("recentTitles");

  const req: PlanRequest = {
    minutes: Number.isFinite(minutesRaw) ? Math.min(120, Math.max(10, Math.round(minutesRaw))) : 30,
    focus: (FOCUS_OPTIONS as readonly string[]).includes(String(focusRaw))
      ? (focusRaw as PlanRequest["focus"])
      : "full-body",
    intensity: (INTENSITY_OPTIONS as readonly string[]).includes(String(intensityRaw))
      ? (intensityRaw as PlanRequest["intensity"])
      : "moderate",
    notes: typeof form.get("notes") === "string" ? String(form.get("notes")).slice(0, 1000) : "",
    knownEquipment,
    hasPhotos: images.length > 0,
    recentTitles:
      typeof recentRaw === "string"
        ? recentRaw
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [],
  };

  if (!req.hasPhotos && knownEquipment.length === 0 && !req.notes) {
    // Bodyweight-only is a valid ask, but make it explicit so an empty form
    // submit isn't a silent (and billable) Claude call.
    return NextResponse.json(
      { error: "Add a photo of your equipment, pick saved equipment, or describe it in notes." },
      { status: 400 },
    );
  }

  try {
    const raw = await callClaudeJSON<unknown>({
      system: buildSystemPrompt(),
      messages: [
        { role: "user", content: [...images, { type: "text", text: buildUserPrompt(req) }] },
      ],
      maxTokens: 6000,
    });
    const result = normalizePlanResponse(raw);
    // Merge equipment the user already confirmed with what Claude saw.
    const seen = new Set(result.equipment.map((e) => e.name.toLowerCase()));
    for (const e of knownEquipment) {
      if (!seen.has(e.name.toLowerCase())) result.equipment.push(e);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("workout plan failed", err);
    const msg = err instanceof Error ? err.message : "plan failed";
    const overloaded = /529|overloaded/i.test(msg);
    return NextResponse.json(
      {
        error: overloaded
          ? "Claude is overloaded right now — try again in a few seconds."
          : "Couldn't build a workout from that. Try clearer photos or add a note.",
      },
      { status: overloaded ? 503 : 502 },
    );
  }
}
