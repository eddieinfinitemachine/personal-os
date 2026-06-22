// Thin shared wrapper around the Anthropic Messages API. Every route that
// talks to Claude was re-implementing the same fetch + headers + text-block
// extraction; this centralizes it. Routes keep their own prompt building and
// response validation — this only owns the transport and the boilerplate.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Default model for all Kaizen AI (capture, coach, project assistant, parsing).
const DEFAULT_MODEL = "claude-opus-4-8";

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeCall {
  system?: string;
  /** Single user message. Ignored if `messages` is provided. */
  user?: string;
  /** Full conversation (for multi-turn). Takes precedence over `user`. */
  messages?: ClaudeMessage[];
  maxTokens: number;
  model?: string;
}

/**
 * Call Claude and return the first text block, trimmed. Throws if the API key
 * is missing or the API returns a non-2xx response.
 */
export async function callClaudeText({
  system,
  user,
  messages,
  maxTokens,
  model = DEFAULT_MODEL,
}: ClaudeCall): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const msgs = messages ?? [{ role: "user" as const, content: user ?? "" }];
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: msgs,
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
}

/**
 * Call Claude and parse the first `{…}` JSON object out of its reply. Throws if
 * no JSON object is present or it fails to parse. The caller is responsible for
 * validating the parsed shape.
 */
export async function callClaudeJSON<T>(call: ClaudeCall): Promise<T> {
  const raw = await callClaudeText(call);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("model did not return JSON");
  return JSON.parse(match[0]) as T;
}
