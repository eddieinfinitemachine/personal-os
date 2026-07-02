import { prisma } from "@/lib/prisma";
import { AssetGrid } from "@/components/asset-grid";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = session.userId;

  const assets = await prisma.asset.findMany({
    where: { userId, kind: "investment", archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "desc" }],
  });

  return (
    <div className="px-4 py-4 sm:px-6 md:px-8 md:py-6">
      <header className="mb-6">
        <h1 className="text-large-title font-bold">Investments</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Equity, venture, public, crypto. Cost basis vs. current value.
        </p>
      </header>
      <AssetGrid
        kind="investment"
        initialAssets={assets}
        showMoneyTotal
        emptyHint="Track your first position. Drop in name, category (venture/public/crypto), cost basis, and current value."
        fields={[
          { key: "subtitle", label: "Vehicle / round", placeholder: "Series A · SAFE · 100 shares" },
          { key: "category", label: "Category", suggestions: ["venture", "public", "crypto", "real-estate"] },
          { key: "status", label: "Status", suggestions: ["active", "exited"] },
          { key: "costBasis", label: "Cost basis ($)", type: "number" },
          { key: "currentValue", label: "Current value ($)", type: "number" },
          { key: "acquiredAt", label: "Date", type: "date" },
          { key: "url", label: "Link", type: "url", full: true },
          { key: "notes", label: "Notes", type: "textarea", full: true },
        ]}
      />
    </div>
  );
}
