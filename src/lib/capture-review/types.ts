import type { CaptureProposal } from "@/lib/smart-capture";

export type ReviewKind = "todo" | "asset" | "person" | "trip" | "interaction" | "call_sheet" | "board" | "reader";
export type ReviewState = "pending" | "dismissed";
export type CaptureSource = "ec" | "web" | "mac" | "chrome" | "quick" | "shortcut";
export interface ReviewFile { name: string; mimeType: string | null; size: number | null; url: string; attachmentId?: string }
export interface ReviewInput { text: string; url: string | null; files: ReviewFile[] }
export interface ReviewPlacement {
  type: ReviewKind;
  id: string;
  title: string;
  destination: string;
  path: string;
  assetKind?: string;
  related?: ReviewPlacement[];
  missing?: boolean;
}
export interface CaptureReviewItem {
  id: string;
  source: CaptureSource;
  sourceLabel: string;
  input: ReviewInput;
  proposal: CaptureProposal | null;
  placement: ReviewPlacement;
  fields: Record<string, string | number | boolean | null>;
  revision: number;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
  correctedAt: string | null;
  correctable: boolean;
  movable: boolean;
}
export interface CaptureReviewList { items: CaptureReviewItem[]; total: number; hasMore: boolean; offset: number; limit: number }
export interface ReviewListOptions { state?: ReviewState; offset?: number; limit?: number }
export interface ReviewCorrection { revision: number; proposal?: CaptureProposal; fields?: Record<string, unknown> }

export const SOURCE_LABELS: Record<CaptureSource, string> = { ec: "ec", web: "Web", mac: "Mac", chrome: "Chrome", quick: "Quick capture", shortcut: "Shortcut" };
export const ASSET_PLACES = {
  inventory: { destination: "Inventory", path: "/inventory", status: "owned" },
  investment: { destination: "Investments", path: "/investments", status: "active" },
  media: { destination: "Media", path: "/media", status: "wishlist" },
  place: { destination: "Places", path: "/places", status: "wishlist" },
  practice: { destination: "Best practices", path: "/best-practices", status: "active" },
} as const;

export class CaptureReviewError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "CaptureReviewError"; }
}
