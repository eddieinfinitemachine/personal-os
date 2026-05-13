import { prisma } from "@/lib/prisma";
import { AssetGrid } from "@/components/asset-grid";

export const dynamic = "force-dynamic";

export default async function BestPracticesPage() {
  const assets = await prisma.asset.findMany({
    where: { kind: "practice", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Best practices</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Frameworks, principles, mental models, hard-won lessons.
        </p>
      </header>
      <AssetGrid
        kind="practice"
        initialAssets={assets}
        emptyHint="Save a principle or framework you don't want to forget."
        fields={[
          { key: "subtitle", label: "Source", placeholder: "Naval · Charlie Munger · personal" },
          { key: "category", label: "Domain", placeholder: "leadership · health · product · money" },
          { key: "url", label: "Reference link", type: "url", full: true },
          { key: "notes", label: "The actual practice", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
