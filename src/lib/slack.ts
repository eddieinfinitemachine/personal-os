// Slack notifications for the todo agent and the research worker. One bot
// token, one channel; chat.postMessage over fetch. A missing token is a
// configured no-op so local runs and tests never post. Never throws.

const SLACK_URL = "https://slack.com/api/chat.postMessage";

export type SlackEnv = Record<string, string | undefined>;

export function slackConfigured(env: SlackEnv = process.env): boolean {
  return !!env.SLACK_BOT_TOKEN && !!env.SLACK_AGENT_CHANNEL;
}

export async function postSlackMessage(
  text: string,
  options: { env?: SlackEnv; fetchFn?: typeof fetch; log?: (line: string) => void } = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((line) => console.warn(line));
  if (!slackConfigured(env)) return false;
  try {
    const res = await (options.fetchFn ?? fetch)(SLACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: env.SLACK_AGENT_CHANNEL, text, unfurl_links: false }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !body.ok) {
      log(`Slack post failed (${body.error ?? res.status})`);
      return false;
    }
    return true;
  } catch (error) {
    log(`Slack post failed (${error instanceof Error ? error.name : "error"})`);
    return false;
  }
}
