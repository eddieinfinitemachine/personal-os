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
  savedAt: Date | string;
}): BoardCard {
  return {
    ...item,
    kind: item.kind as BoardKind,
    savedAt: typeof item.savedAt === "string" ? item.savedAt : item.savedAt.toISOString(),
  };
}
