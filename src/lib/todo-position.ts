import type { Prisma } from "@prisma/client";

/**
 * Position for a new (or newly moved-in) top-level todo: one past the largest
 * in the list, so it lands after the existing ones once a list has been
 * manually reordered (POST /api/todos/reorder). Subtasks keep their own
 * positions and are not counted. Takes a client so transactions can use it.
 */
export async function nextTodoPosition(
  db: Pick<Prisma.TransactionClient, "todo">,
  listId: string,
): Promise<number> {
  const { _max } = await db.todo.aggregate({
    where: { listId, parentId: null },
    _max: { position: true },
  });
  return (_max.position ?? -1) + 1;
}
