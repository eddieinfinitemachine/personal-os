import { Music2, Play, ShoppingBag } from "lucide-react";
import type { BoardKind } from "@/lib/board-embed";

export function KindGlyph({ kind, className }: { kind: BoardKind; className?: string }) {
  if (kind === "video") return <Play className={className} fill="currentColor" />;
  if (kind === "music") return <Music2 className={className} />;
  if (kind === "product") return <ShoppingBag className={className} />;
  return null;
}
