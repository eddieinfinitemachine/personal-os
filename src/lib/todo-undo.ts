"use client";

import type { TodoLike } from "@/components/todo-row";
import { pushUndo } from "./undo";

// Moving a todo between lists (or between a tile's project groups) is
// optimistic on BOTH sides: the source tile hides the row, the destination
// tile inserts it, and `personalos:todo-moved` is what keeps them in sync.
// Undoing a move therefore has to replay that same event in reverse before
// PATCHing the server back — otherwise the row comes home invisible, still
// masked by the source tile's hiddenIds.

export type MoveUndo = {
  label: string;
  todo: TodoLike;
  from: { listId: string; projectId: string | null; projectName?: string | null };
  to: { listId: string; projectId: string | null };
  refresh: () => void;
};

export function pushTodoMoveUndo({ label, todo, from, to, refresh }: MoveUndo) {
  if (from.listId === to.listId && from.projectId === to.projectId) return;
  pushUndo({
    label,
    run: async () => {
      window.dispatchEvent(
        new CustomEvent("personalos:todo-moved", {
          detail: {
            todoId: todo.id,
            fromListId: to.listId,
            fromProjectId: to.projectId,
            toListId: from.listId,
            toProjectId: from.projectId,
            toProjectName: from.projectName ?? null,
            todo: {
              ...todo,
              projectId: from.projectId,
              projectName: from.projectName ?? null,
            },
          },
        }),
      );
      await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: from.listId, projectId: from.projectId }),
      });
      refresh();
    },
  });
}
