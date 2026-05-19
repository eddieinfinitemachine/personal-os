import { prisma } from "@/lib/prisma";
import { AssetGrid } from "@/components/asset-grid";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const assets = await prisma.asset.findMany({
    where: { userId, kind: "media", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Media</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Books, films, albums, podcasts. Reading list, watch list, hits.
        </p>
      </header>
      <AssetGrid
        kind="media"
        initialAssets={assets}
        emptyHint="Drop something you've read, watched, or want to."
        fields={[
          { key: "subtitle", label: "Author / director / recommended by" },
          { key: "category", label: "Type", placeholder: "book · film · album · podcast" },
          { key: "status", label: "Status", placeholder: "tbr · reading · done · loved" },
          { key: "rating", label: "Rating (1-5)", type: "number" },
          { key: "imageUrl", label: "Cover image URL", type: "url", full: true },
          { key: "url", label: "Link", type: "url", full: true },
          { key: "notes", label: "Note / takeaway", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
