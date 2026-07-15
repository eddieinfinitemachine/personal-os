import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { SaveUrlBar } from "@/components/reader/save-url-bar";
import { ReaderListActions } from "@/components/reader/list-actions";
import { Highlighter } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReaderPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { view } = await searchParams;
  const archived = view === "archive";

  const items = await prisma.readerItem.findMany({
    where: { userId: session.userId, archivedAt: archived ? { not: null } : null },
    orderBy: { savedAt: "desc" },
    include: { _count: { select: { highlights: true } } },
    take: 200,
  });

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-5">
        <h1 className="text-large-title font-bold">Read later</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Links, tweets, articles — saved from the share sheet, read here.
        </p>
      </header>

      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <SaveUrlBar />
        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden text-xs">
          <Link
            href="/reader"
            className={`px-2.5 py-1.5 ${!archived ? "bg-[var(--color-accent)] font-medium" : "text-[var(--color-muted-foreground)]"}`}
          >
            Unread
          </Link>
          <Link
            href="/reader?view=archive"
            className={`px-2.5 py-1.5 ${archived ? "bg-[var(--color-accent)] font-medium" : "text-[var(--color-muted-foreground)]"}`}
          >
            Archive
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          {archived
            ? "Nothing archived yet."
            : "Paste a link above, or share one from your phone with the Read Later shortcut."}
        </div>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {items.map((item) => {
            const minutes = Math.max(1, Math.round(item.wordCount / 230));
            return (
              <li key={item.id}>
                <div className="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 hover:bg-[var(--color-accent)]/30 transition">
                  <Link href={`/reader/${item.id}`} className="min-w-0 flex-1">
                    <div className="font-medium leading-snug break-words">
                      {item.title}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)] flex items-center gap-1.5 flex-wrap">
                      {item.siteName ? <span>{item.siteName}</span> : null}
                      {item.byline ? <span>· {item.byline}</span> : null}
                      {item.wordCount > 0 ? <span>· {minutes} min</span> : null}
                      {item._count.highlights > 0 ? (
                        <span className="inline-flex items-center gap-0.5">
                          · <Highlighter className="size-3" />
                          {item._count.highlights}
                        </span>
                      ) : null}
                      {item.readAt ? <span>· read</span> : null}
                    </div>
                    {item.excerpt ? (
                      <p className="mt-1 text-sm text-[var(--color-muted-foreground)] line-clamp-2">
                        {item.excerpt}
                      </p>
                    ) : null}
                  </Link>
                  <ReaderListActions id={item.id} archived={archived} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
