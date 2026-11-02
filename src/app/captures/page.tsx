import Link from "next/link";
import { redirect } from "next/navigation";
import { CaptureReviewInbox } from "@/components/capture-review-inbox";
import { PageHeader } from "@/components/mobile-chrome";
import { getSession } from "@/lib/auth";
import { listCaptureReviews } from "@/lib/capture-review/read";
import { listAccessWhere } from "@/lib/list-access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function CapturesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const state = params.state === "dismissed" ? "dismissed" : "pending";
  const requestedOffset =
    typeof params.offset === "string" ? Number(params.offset) : 0;
  const offset =
    Number.isSafeInteger(requestedOffset) && requestedOffset >= 0
      ? Math.min(requestedOffset, 1_000_000)
      : 0;
  const [captures, projects, lists] = await Promise.all([
    listCaptureReviews(session.userId, { state, offset, limit: 10 })
      .then((data) => ({ data, error: null }))
      .catch(() => ({
        data: null,
        error: "Could not load captures. Try again.",
      })),
    prisma.project.findMany({
      where: { userId: session.userId, archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.list.findMany({
      where: listAccessWhere(session.userId),
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    }),
  ]);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <PageHeader title="Capture Inbox" />
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-large-title font-bold">Captures</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Review where each capture was saved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium hover:bg-[var(--color-accent)]"
        >
          Home
        </Link>
      </header>
      <CaptureReviewInbox
        initialData={captures.data}
        initialError={captures.error}
        initialState={state}
        projects={projects}
        lists={lists}
        fullPage
      />
    </div>
  );
}
