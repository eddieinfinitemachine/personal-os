import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Highlighter } from "lucide-react";

export const dynamic = "force-dynamic";

// Every highlight across every saved article, newest first, grouped by
// article. The commonplace book the reader earns you.
export default async function HighlightsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const highlights = await prisma.highlight.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    include: {
      item: { select: { id: true, title: true, siteName: true, byline: true } },
    },
    take: 500,
  });

  // Group by article, preserving recency order of each article's newest highlight.
  const groups: {
    item: { id: string; title: string; siteName: string | null; byline: string | null };
    entries: typeof highlights;
  }[] = [];
  const byItem = new Map<string, (typeof groups)[number]>();
  for (const h of highlights) {
    let g = byItem.get(h.itemId);
    if (!g) {
      g = { item: h.item, entries: [] };
      byItem.set(h.itemId, g);
      groups.push(g);
    }
    g.entries.push(h);
  }

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-large-title font-bold">Highlights</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Everything you&apos;ve marked while reading, newest first.
        </p>
      </header>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          <Highlighter className="size-5 mx-auto mb-2 opacity-60" />
          Select text while reading anything in Read later and tap Highlight —
          it lands here.
        </div>
      ) : (
        <div className="max-w-2xl space-y-8">
          {groups.map((g) => (
            <section key={g.item.id}>
              <Link
                href={`/reader/${g.item.id}`}
                className="group inline-block"
              >
                <h2 className="font-semibold leading-snug group-hover:underline underline-offset-2">
                  {g.item.title}
                </h2>
                <div className="text-xs text-[var(--color-muted-foreground)]">
                  {[g.item.siteName, g.item.byline].filter(Boolean).join(" · ")}
                </div>
              </Link>
              <ul className="mt-3 space-y-3">
                {g.entries.map((h) => (
                  <li key={h.id}>
                    <blockquote className="border-l-2 border-[var(--color-foreground)]/30 pl-3 text-sm leading-relaxed">
                      {h.text}
                    </blockquote>
                    {h.note ? (
                      <p className="mt-1 pl-3 text-xs text-[var(--color-muted-foreground)]">
                        {h.note}
                      </p>
                    ) : null}
                    <div className="mt-1 pl-3 text-[11px] text-[var(--color-muted-foreground)]/70">
                      {h.createdAt.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
