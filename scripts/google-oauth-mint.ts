/**
 * Mint a Gmail read-only refresh token for the founder-only booking importer.
 *
 *   npx tsx scripts/google-oauth-mint.ts
 *   npx tsx scripts/google-oauth-mint.ts <CLIENT_ID> <CLIENT_SECRET>
 *
 * Prereqs (one-time, in the Google Cloud console):
 *   1. Create an OAuth 2.0 Client ID of type "Desktop app".
 *   2. Enable the Gmail API for the project.
 *   3. Publish the OAuth consent screen to "In production".
 *      IMPORTANT: a consent screen left in "Testing" mode issues refresh
 *      tokens that EXPIRE AFTER 7 DAYS. Production is required for a durable
 *      token.
 *
 * This starts a tiny loopback server, opens a consent URL, exchanges the
 * returned code, and prints GOOGLE_REFRESH_TOKEN. Put that value in .env and
 * in your Vercel project env.
 */
import http from "node:http";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? process.argv[2];
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? process.argv[3];

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2/callback`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
  console.error("");
  console.error("Pass them as env vars or arguments:");
  console.error("  npx tsx scripts/google-oauth-mint.ts <CLIENT_ID> <CLIENT_SECRET>");
  console.error("");
  console.error("First, in the Google Cloud console:");
  console.error("  1. Create an OAuth 2.0 Client ID of type 'Desktop app'.");
  console.error("  2. Enable the Gmail API for the project.");
  console.error("  3. Publish the OAuth consent screen to 'In production'");
  console.error("     (Testing-mode refresh tokens expire after 7 days).");
  process.exit(1);
}

const consentUrl =
  "https://accounts.google.com/o/oauth2/v2/auth" +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  "&response_type=code" +
  `&scope=${encodeURIComponent(SCOPE)}` +
  "&access_type=offline" +
  "&prompt=consent";

async function exchangeCode(code: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { refresh_token?: string };
  if (!data.refresh_token) {
    console.error("");
    console.error("No refresh_token in the response.");
    console.error(
      "This happens when Google already granted this client before without"
    );
    console.error("prompt=consent. Revoke the app's access, then re-run:");
    console.error("  https://myaccount.google.com/permissions");
    process.exit(1);
  }

  console.log("");
  console.log("Success. Add this to .env (and your Vercel project env):");
  console.log("");
  console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
  console.log("");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/oauth2/callback") {
    res.writeHead(404).end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Done — you can close this tab.");

  if (err || !code) {
    console.error(`OAuth error: ${err ?? "no code returned"}`);
    server.close();
    process.exit(1);
  }

  exchangeCode(code)
    .then(() => {
      server.close();
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      server.close();
      process.exit(1);
    });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Waiting for Google consent…");
  console.log("");
  console.log("Open this URL in your browser and approve access:");
  console.log("");
  console.log(`  ${consentUrl}`);
  console.log("");
});
