import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ensureInboxProject } from "@/lib/lists";

export const dynamic = "force-dynamic";

// Stable address for the Inbox project (its id is per-user), so nav and the
// mobile tab bar can link to it directly.
export default async function InboxRedirect() {
  const session = await getSession();
  if (!session) redirect("/login");
  const inboxId = await ensureInboxProject(session.userId);
  redirect(`/projects/${inboxId}`);
}
