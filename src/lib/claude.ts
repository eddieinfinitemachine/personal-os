// Thin shared wrapper around the Anthropic Messages API. Every route that
// talks to Claude was re-implementing the same fetch + headers + text-block
// extraction; this centralizes it. Routes keep their own prompt building and
// response validation — this only owns the transport and the boilerplate.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Default model for all EC AI (capture, coach, project assistant, parsing).
const DEFAULT_MODEL = "claude-opus-4-8";

export type ClaudeImageBlock = {
  type: "image";
  source:
    | { type: "base64"; media_type: string; data: string }
    // Anthropic fetches the image itself (public https URLs only).
    | { type: "url"; url: string };
};
export type ClaudeTextBlock = { type: "text"; text: string };
export type ClaudeContentBlock = ClaudeTextBlock | ClaudeImageBlock;

/** A non-2xx reply from the Messages API. `status` lets callers tell
 * configuration problems (401/403/404) from transient ones (429/5xx). */
export class ClaudeAPIError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Claude error ${status}: ${body}`);
    this.name = "ClaudeAPIError";
  }
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  /** Plain text, or content blocks (text + base64 images for vision). */
  content: string | ClaudeContentBlock[];
}

export interface ClaudeCall {
  system?: string;
  /** Single user message. Ignored if `messages` is provided. */
  user?: string;
  /** Full conversation (for multi-turn). Takes precedence over `user`. */
  messages?: ClaudeMessage[];
  maxTokens: number;
  model?: string;
  timeoutMs?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Retry a safety-classifier decline on Anthropic's recommended fallback model. */
  refusalFallback?: boolean;
}

export type ClaudeReply = {
  text: string;
  /** "refusal" with no text means every model in the fallback chain declined. */
  stopReason: string | null;
  /** The model that wrote this reply, which a refusal fallback can change. */
  servedBy: string | null;
};

/**
 * Call Claude and return the first text block, trimmed, with how the turn ended.
 * Throws if the API key is missing or the API returns a non-2xx response.
 */
export async function callClaudeReply({
  system,
  user,
  messages,
  maxTokens,
  model = DEFAULT_MODEL,
  timeoutMs,
  effort,
  refusalFallback,
}: ClaudeCall): Promise<ClaudeReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const msgs = messages ?? [{ role: "user" as const, content: user ?? "" }];
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(refusalFallback ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(effort ? { output_config: { effort } } : {}),
      ...(refusalFallback ? { fallbacks: "default" } : {}),
      messages: msgs,
    }),
  });
  if (!res.ok) throw new ClaudeAPIError(res.status, await res.text());
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string | null;
    model?: string;
  };
  return {
    text: data.content?.find((c) => c.type === "text")?.text?.trim() ?? "",
    stopReason: data.stop_reason ?? null,
    servedBy: data.model ?? null,
  };
}

/** Call Claude and return the first text block, trimmed. */
export async function callClaudeText(call: ClaudeCall): Promise<string> {
  return (await callClaudeReply(call)).text;
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

// Raw response blocks. Server tools (web search) add block types beyond text,
// and those must be echoed back verbatim when resuming a paused turn.
export type ClaudeResponseBlock = { type: string; text?: string; [key: string]: unknown };

export interface ClaudeToolCall {
  system?: string;
  user: string;
  maxTokens: number;
  model?: string;
  /** Server tools, e.g. `{ type: "web_search_20260209", name: "web_search", max_uses: 8 }`. */
  tools: Array<Record<string, unknown>>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** How many times to resume after `pause_turn` before giving up. */
  maxContinuations?: number;
  /** Deadline for the whole turn, continuations included (aborts with TimeoutError). */
  timeoutMs?: number;
}

/**
 * Call Claude with server-side tools (web search) and return every content
 * block across the turn. Long server-tool turns can stop with `pause_turn`;
 * we resume by sending the partial assistant content back unchanged.
 */
export async function callClaudeWithServerTools({
  system,
  user,
  maxTokens,
  model = DEFAULT_MODEL,
  tools,
  effort = "medium",
  maxContinuations = 3,
  timeoutMs,
}: ClaudeToolCall): Promise<{ content: ClaudeResponseBlock[]; stopReason: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: user }];
  const all: ClaudeResponseBlock[] = [];
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  for (let i = 0; i <= maxContinuations; i++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort },
        ...(system ? { system } : {}),
        tools,
        messages,
      }),
    });
    if (!res.ok) throw new ClaudeAPIError(res.status, await res.text());
    const data = (await res.json()) as { content?: ClaudeResponseBlock[]; stop_reason?: string | null };
    const content = data.content ?? [];
    all.push(...content);
    if (data.stop_reason !== "pause_turn") return { content: all, stopReason: data.stop_reason ?? null };
    messages.push({ role: "assistant", content });
  }
  return { content: all, stopReason: "pause_turn" };
}
