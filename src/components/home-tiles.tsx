"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListTile, type ListInfo } from "./list-tile";
import type { TodoLike } from "./todo-row";

export type HomeTile = {
  list: ListInfo;
  todos: TodoLike[];
  totalCount: number;
};

export function HomeTiles({ tiles: initialTiles }: { tiles: HomeTile[] }) {
  const router = useRouter();
  const [tiles, setTiles] = useState(initialTiles);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync from server snapshots (e.g. todo counts updating).
  useEffect(() => {
    setTiles(initialTiles);
  }, [initialTiles]);

  const orderedIds = useMemo(() => tiles.map((t) => t.list.id), [tiles]);

  function moveTile(fromId: string, toId: string) {
    if (fromId === toId) return;
    setTiles((prev) => {
      const fromIdx = prev.findIndex((t) => t.list.id === fromId);
      const toIdx = prev.findIndex((t) => t.list.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  async function persistOrder() {
    setDraggingId(null);
    setOverId(null);
    await fetch("/api/lists/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: orderedIds }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
      {tiles.map((t) => (
        <ListTile
          key={t.list.id}
          list={t.list}
          todos={t.todos}
          totalCount={t.totalCount}
          reorderable
          groupByProject
          onReorderStart={(id) => setDraggingId(id)}
          onReorderOver={(id) => {
            if (!draggingId || draggingId === id) return;
            if (overId === id) return;
            setOverId(id);
            moveTile(draggingId, id);
          }}
          onReorderDrop={() => {
            persistOrder();
          }}
        />
      ))}
    </div>
  );
}
