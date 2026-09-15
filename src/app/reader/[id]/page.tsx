import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ArticleReader } from "@/components/reader/article-reader";

export const dynamic = "force-dynamic";

export default async function ReaderItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;

  const [item, user] = await Promise.all([
    prisma.readerItem.findFirst({
      where: { id, userId: session.userId },
      select: {
        id: true,
        url: true,
        title: true,
        byline: true,
        siteName: true,
        contentHtml: true,
        wordCount: true,
        readAt: true,
        archivedAt: true,
        savedAt: true,
        kindleSentAt: true,
        kindleError: true,
        highlights: {
          orderBy: { createdAt: "asc" },
          select: { id: true, text: true, note: true },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { kindleEmail: true },
    }),
  ]);
  if (!item) notFound();

  return (
    <ArticleReader
      item={{
        id: item.id,
        url: item.url,
        title: item.title,
        byline: item.byline,
        siteName: item.siteName,
        contentHtml: item.contentHtml,
        wordCount: item.wordCount,
        readAt: item.readAt?.toISOString() ?? null,
        archivedAt: item.archivedAt?.toISOString() ?? null,
        savedAt: item.savedAt.toISOString(),
      }}
      initialHighlights={item.highlights.map((h) => ({
        id: h.id,
        text: h.text,
        note: h.note,
      }))}
      kindleSentAt={item.kindleSentAt?.toISOString() ?? null}
      kindleError={item.kindleError}
      kindleConfigured={Boolean(user?.kindleEmail)}
    />
  );
}
