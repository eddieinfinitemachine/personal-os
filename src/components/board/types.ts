import type { BoardKind } from "@/lib/board-embed";

export type BoardCard = {
  id: string;
  kind: BoardKind;
  url: string | null;
  title: string | null;
  note: string | null;
  siteName: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  color: string | null;
  price: string | null;
  via: string;
  /** Claude-assigned categories ("Musicians"); empty until tagged. */
  tags: string[];
  savedAt: string;
};

export function toCard(item: {
  id: string;
  kind: string;
  url: string | null;
  title: string | null;
  note: string | null;
  siteName: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  color: string | null;
  price: string | null;
  via: string;
  tags?: string[] | null;
  savedAt: Date | string;
}): BoardCard {
  return {
    ...item,
    kind: item.kind as BoardKind,
    tags: item.tags ?? [],
    savedAt: typeof item.savedAt === "string" ? item.savedAt : item.savedAt.toISOString(),
  };
}
