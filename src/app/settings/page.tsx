import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

const BLOB_QUOTA_BYTES = 1024 * 1024 * 1024; // 1 GB

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const [user, storageUsed] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.attachment.aggregate({
      where: { userId, kind: "file" },
      _sum: { size: true },
    }),
  ]);

  if (!user) redirect("/login");

  const usedBytes = storageUsed._sum.size ?? 0;
  const usedPct = Math.min(100, Math.round((usedBytes / BLOB_QUOTA_BYTES) * 1000) / 10);
  const usedHuman = formatBytes(usedBytes);
  const quotaHuman = formatBytes(BLOB_QUOTA_BYTES);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Your account, your data.
        </p>
      </header>

      <div className="max-w-xl space-y-8">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Account
          </h2>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
            <Row label="Email" value={user.email} />
            <Row label="Joined" value={user.createdAt.toLocaleDateString()} />
            <Row label="Last seen" value={user.lastSeenAt.toLocaleDateString()} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Storage
          </h2>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[var(--color-muted-foreground)]">Files</span>
              <span className="font-medium">
                {usedHuman} <span className="text-[var(--color-muted-foreground)]">of {quotaHuman}</span>
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
              <div
                className="h-full bg-[var(--color-foreground)] transition-all"
                style={{ width: `${usedPct}%` }}
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Session
          </h2>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
            <LogoutButton />
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--color-border)] py-2.5 last:border-b-0">
      <span className="text-sm text-[var(--color-muted-foreground)]">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
