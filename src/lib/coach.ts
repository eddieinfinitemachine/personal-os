// Shared helper for the coaching routes. Calls Claude with a structured
// prompt and returns parsed action items. Used by both pet and vehicle
// coaching routes.

import { callClaudeJSON } from "@/lib/claude";

export type CoachItem = {
  title: string;
  body?: string;
  priority?: "high" | "normal" | "low";
  cadence?: "weekly" | "monthly" | "seasonal" | "one-time";
};

const SYSTEM_PROMPT = `You are a proactive coach for an owner who wants to be excellent — not just adequate — at caring for the asset described in the user message.

Your job: produce a tight list of CONCRETE, actionable suggestions for the next 7-14 days. Think like an obsessive expert who notices the small things most owners miss.

Rules for the suggestions:
- Be specific to the breed/model and the current state. Generic advice is useless.
- Anticipate the season and date — what's coming up that an owner often doesn't think about?
- Mix near-term action (this week) with low-effort rituals (weekly habits worth starting).
- Each item should be something the owner can DO, not something to be aware of. Verbs in imperative.
- Don't repeat the maintenance/vaccination items the dashboard already surfaces — go beyond them.
- Length: 4–7 items. No more.
- Each item: title is one short sentence (under 10 words). body is 1-2 sentences explaining WHY.
- Mark priority "high" only for time-sensitive things; default "normal".
- Cadence: "weekly" / "monthly" / "seasonal" for ongoing rituals, "one-time" for discrete actions. Default "one-time".

Output strict JSON, no prose, no markdown fences. Schema:
{ "items": [ { "title": "...", "body": "...", "priority": "high|normal|low", "cadence": "weekly|monthly|seasonal|one-time" } ] }`;

export async function generateCoachItems(
  contextSummary: string
): Promise<CoachItem[]> {
  const parsed = await callClaudeJSON<{ items?: CoachItem[] }>({
    system: SYSTEM_PROMPT,
    user: contextSummary,
    maxTokens: 1500,
  });
  if (!Array.isArray(parsed.items)) throw new Error("invalid response shape");
  return parsed.items
    .filter((i) => i && typeof i.title === "string" && i.title.trim().length > 0)
    .map((i) => ({
      title: i.title.trim().slice(0, 200),
      body: i.body?.trim().slice(0, 800),
      priority:
        i.priority === "high" || i.priority === "low" ? i.priority : "normal",
      cadence:
        i.cadence === "weekly" ||
        i.cadence === "monthly" ||
        i.cadence === "seasonal"
          ? i.cadence
          : "one-time",
    }));
}
