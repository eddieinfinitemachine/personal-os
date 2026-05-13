import { prisma } from "@/lib/prisma";
import { AssetGrid } from "@/components/asset-grid";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const assets = await prisma.asset.findMany({
    where: { kind: "inventory", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Things you own. Watches, gear, electronics, instruments.
        </p>
      </header>
      <AssetGrid
        kind="inventory"
        initialAssets={assets}
        emptyHint="Log what you own — handy for insurance, sell-day prep, and remembering what's in storage."
        fields={[
          { key: "subtitle", label: "Brand / model" },
          { key: "category", label: "Category", placeholder: "watches · cameras · audio · tools" },
          { key: "status", label: "Status", placeholder: "owned · loaned · stored · sold" },
          { key: "location", label: "Where", placeholder: "apartment · storage" },
          { key: "costBasis", label: "Purchase price ($)", type: "number" },
          { key: "currentValue", label: "Estimated value ($)", type: "number" },
          { key: "acquiredAt", label: "Purchase date", type: "date" },
          { key: "imageUrl", label: "Image URL", type: "url", full: true },
          { key: "url", label: "Link", type: "url", full: true },
          { key: "notes", label: "Notes", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
