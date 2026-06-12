import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM_EMAIL = process.env.EMAIL_FROM ?? "Kaizen <onboarding@resend.dev>";
const APP_URL_FALLBACK =
  process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Send a magic-link email. Pass `originUrl` to use the request's actual host
 * (e.g. so a sign-up from kaizen.eddiecohen.com gets a link back to that host
 * rather than whatever APP_URL is set to globally).
 */
export async function sendMagicLinkEmail(
  email: string,
  token: string,
  originUrl?: string,
): Promise<void> {
  const base = originUrl?.replace(/\/$/, "") ?? APP_URL_FALLBACK;
  const link = `${base}/api/auth/verify?token=${token}`;

  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Sign in to Kaizen",
    html: renderMagicLinkHtml(link),
    text: `Sign in to Kaizen by opening this link (expires in 15 minutes):\n\n${link}\n\nIf you didn't request this, you can safely ignore it.`,
  });
  if (error) {
    // Resend SDK v6 returns errors in the response rather than throwing.
    throw new Error(`Resend send failed: ${error.name} — ${error.message}`);
  }
}

/**
 * Notify a shared-list participant that someone added a new todo.
 * Caller (src/lib/notify.ts) handles recipient selection and error swallowing.
 */
export async function sendSharedListAddEmail(
  email: string,
  {
    creatorName,
    todoTitle,
    listName,
  }: { creatorName: string; todoTitle: string; listName: string },
): Promise<void> {
  const link = APP_URL_FALLBACK;
  const { error } = await getResend().emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: `${creatorName} added "${todoTitle}" to ${listName}`,
    html: renderSharedListAddHtml({ creatorName, todoTitle, listName, link }),
    text: `${creatorName} added a new to-do to ${listName}:\n\n  ${todoTitle}\n\nOpen Kaizen to see the list (and anything else they've added since):\n${link}\n\nYou're getting this because the list "${listName}" is shared with you.`,
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.name} — ${error.message}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSharedListAddHtml({
  creatorName,
  todoTitle,
  listName,
  link,
}: {
  creatorName: string;
  todoTitle: string;
  listName: string;
  link: string;
}): string {
  const creator = escapeHtml(creatorName);
  const title = escapeHtml(todoTitle);
  const list = escapeHtml(listName);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e5e5e5;">
    <div style="max-width:480px;margin:0 auto;padding:48px 24px;">
      <div style="text-align:center;margin-bottom:40px;">
        <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#737373;">Kaizen</div>
        <div style="margin-top:8px;font-size:22px;font-weight:600;letter-spacing:-0.01em;color:#fafafa;">${creator} added a to&#8209;do</div>
      </div>

      <div style="background:#171717;border:1px solid #262626;border-radius:12px;padding:20px;margin:0 0 24px;">
        <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#737373;margin-bottom:6px;">${list}</div>
        <div style="font-size:16px;font-weight:600;color:#fafafa;">${title}</div>
      </div>

      <div style="text-align:center;margin:32px 0;">
        <a href="${link}"
           style="display:inline-block;background:#fafafa;color:#0a0a0a;font-size:15px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;">
          Open Kaizen
        </a>
      </div>

      <p style="font-size:13px;line-height:1.6;color:#737373;margin:24px 0 0;text-align:center;">
        Opening the app shows the full list, including anything else added since this email.
      </p>

      <hr style="border:none;border-top:1px solid #262626;margin:40px 0 24px;"/>

      <p style="font-size:12px;line-height:1.6;color:#525252;margin:0;">
        You're getting this because the list &ldquo;${list}&rdquo; is shared with you.
      </p>
    </div>
  </body>
</html>`;
}

function renderMagicLinkHtml(link: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e5e5e5;">
    <div style="max-width:480px;margin:0 auto;padding:48px 24px;">
      <div style="text-align:center;margin-bottom:40px;">
        <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#737373;">Kaizen</div>
        <div style="margin-top:8px;font-size:22px;font-weight:600;letter-spacing:-0.01em;color:#fafafa;">A little better, every day.</div>
      </div>

      <p style="font-size:15px;line-height:1.6;color:#d4d4d4;margin:0 0 24px;">
        Tap the button below to sign in. This link expires in 15&nbsp;minutes and can only be used once.
      </p>

      <div style="text-align:center;margin:32px 0;">
        <a href="${link}"
           style="display:inline-block;background:#fafafa;color:#0a0a0a;font-size:15px;font-weight:600;padding:14px 32px;border-radius:10px;text-decoration:none;">
          Sign in to Kaizen
        </a>
      </div>

      <p style="font-size:13px;line-height:1.6;color:#737373;margin:24px 0 0;">
        If the button doesn't work, paste this link into your browser:<br/>
        <a href="${link}" style="color:#a3a3a3;word-break:break-all;">${link}</a>
      </p>

      <hr style="border:none;border-top:1px solid #262626;margin:40px 0 24px;"/>

      <p style="font-size:12px;line-height:1.6;color:#525252;margin:0;">
        Didn't ask for this? You can safely ignore it — no account is created until you click the link.
      </p>
    </div>
  </body>
</html>`;
}
