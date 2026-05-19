import { prisma } from "@/lib/prisma";
import { AssetGrid } from "@/components/asset-grid";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlacesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const assets = await prisma.asset.findMany({
    where: { userId, kind: "place", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });
  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Places</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Restaurants, hotels, neighborhoods, hikes — visited and wishlist.
        </p>
      </header>
      <AssetGrid
        kind="place"
        initialAssets={assets}
        emptyHint="Save somewhere you went or want to go."
        fields={[
          { key: "subtitle", label: "Type / cuisine / recommended by" },
          { key: "category", label: "Category", placeholder: "restaurant · hotel · hike · bar" },
          { key: "location", label: "City / neighborhood", placeholder: "Brooklyn · Tokyo · Big Sur" },
          { key: "status", label: "Status", placeholder: "visited · wishlist · favorite" },
          { key: "rating", label: "Rating (1-5)", type: "number" },
          { key: "url", label: "Link", type: "url", full: true },
          { key: "notes", label: "What to order / why it's good", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
