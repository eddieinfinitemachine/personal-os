import { prisma } from "@/lib/prisma";
import type { AssetProposal } from "@/lib/smart-capture";

// Proposal → Asset row. Shared by /api/capture/smart/commit (review-then-save
// capture) and /api/todos/[id]/to-tracker (one-click "send todo to tracker")
// so both file assets exactly the same way.

// Default status per assetKind if Claude didn't set one.
export const DEFAULT_ASSET_STATUS: Record<string, string> = {
  inventory: "owned",
  investment: "active",
  media: "wishlist",
  place: "wishlist",
  practice: "active",
};

export type AssetProvenance = {
  // Overrides detailsJson.source ("smart-capture" by default).
  source?: string;
  sourceTodoId?: string;
  sourceTodoTitle?: string;
};

export async function createAssetFromProposal(
  userId: string,
  proposal: AssetProposal,
  extra: AssetProvenance = {},
) {
  // Only honour a projectId that belongs to this user.
  let projectId: string | null = null;
  if (proposal.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: proposal.projectId },
    });
    if (project && project.userId === userId) projectId = project.id;
  }

  return prisma.asset.create({
    data: {
      userId,
      kind: proposal.assetKind,
      status: proposal.status ?? DEFAULT_ASSET_STATUS[proposal.assetKind] ?? null,
      amountUsd: proposal.amountUsd ?? null,
      rating: proposal.rating ?? null,
      title: proposal.title,
      subtitle: proposal.subtitle ?? null,
      category: proposal.category ?? null,
      costBasis: proposal.costBasis ?? null,
      currentValue: proposal.currentValue ?? null,
      location: proposal.location ?? null,
      // Default acquiredAt to today for inventory items marked owned (if
      // Claude didn't extract a date). Other kinds stay null.
      acquiredAt: proposal.acquiredAt
        ? new Date(proposal.acquiredAt)
        : proposal.assetKind === "inventory" &&
            (proposal.status ?? "owned") === "owned"
          ? new Date()
          : null,
      imageUrl: proposal.photoUrl || null,
      url: proposal.url ?? null,
      notes: proposal.notes ?? null,
      projectId,
      detailsJson: {
        source: "smart-capture",
        sourceVendor: proposal.sourceVendor ?? null,
        ...(proposal.details ?? {}),
        // Provenance is ours, not Claude's: it wins over any same-named key
        // in details.
        ...(extra.source ? { source: extra.source } : {}),
        ...(extra.sourceTodoId ? { sourceTodoId: extra.sourceTodoId } : {}),
        ...(extra.sourceTodoTitle ? { sourceTodoTitle: extra.sourceTodoTitle } : {}),
      },
    },
  });
}
