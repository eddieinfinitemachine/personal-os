import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { callClaudeJSON } from "@/lib/claude";
import {
  buildExtendPrompt,
  buildSystemPrompt,
  EXTEND_MINUTES,
  FOCUS_OPTIONS,
  INTENSITY_OPTIONS,
  normalizeExtension,
  type EquipmentItem,
  type ExtendRequest,
} from "@/lib/workout";

export const maxDuration = 120;

// "10 more minutes" mid-session or after the summary: more main blocks on the
// same equipment, avoiding the movements already done. Nothing is stored.
export async function POST(request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const minutes = Number(body.minutes);
  if (!(EXTEND_MINUTES as readonly number[]).includes(minutes)) {
    return NextResponse.json({ error: `minutes must be one of ${EXTEND_MINUTES.join(", ")}` }, { status: 400 });
  }
  const equipment: EquipmentItem[] = (Array.isArray(body.equipment) ? body.equipment : [])
    .map((e): EquipmentItem | null => {
      if (!e || typeof e !== "object") return null;
      const o = e as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
      const detail = typeof o.detail === "string" ? o.detail.trim().slice(0, 80) : "";
      return name ? (detail ? { name, detail } : { name }) : null;
    })
    .filter((e): e is EquipmentItem => e !== null)
    .slice(0, 40);
  const req: ExtendRequest = {
    minutes: minutes as ExtendRequest["minutes"],
    focus: (FOCUS_OPTIONS as readonly string[]).includes(String(body.focus)) ? (body.focus as ExtendRequest["focus"]) : "full-body",
    intensity: (INTENSITY_OPTIONS as readonly string[]).includes(String(body.intensity))
      ? (body.intensity as ExtendRequest["intensity"])
      : "moderate",
    equipment,
    exercises: (Array.isArray(body.exercises) ? body.exercises : [])
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      .map((n) => n.trim().slice(0, 80))
      .slice(0, 40),
    notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : "",
  };
  try {
    const raw = await callClaudeJSON<unknown>({
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: buildExtendPrompt(req) }],
      maxTokens: 3000,
    });
    return NextResponse.json({ blocks: normalizeExtension(raw) });
  } catch (err) {
    console.error("workout extend failed", err);
    const msg = err instanceof Error ? err.message : "extend failed";
    const overloaded = /529|overloaded/i.test(msg);
    return NextResponse.json(
      { error: overloaded ? "Claude is overloaded right now — try again in a few seconds." : "Couldn't add more work right now. Try again." },
      { status: overloaded ? 503 : 502 },
    );
  }
}
