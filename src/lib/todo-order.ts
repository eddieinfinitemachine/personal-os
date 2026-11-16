// Manual order within one list (POST /api/todos/reorder), for dragging a todo
// to a new place on its own Home card. Pure helpers, plus the one piece of
// drag state the card needs while the mouse is still moving.
//
// Home lists undated todos first in manual order, then dated ones by day
// (position breaks ties within a day), so a todo can only be put among the
// todos that share its due date. The iOS app keeps the same rule
// (TodoOrder.movableRange).

type Orderable = { id: string; dueDate?: Date | string | null };

function dueTime(d: Orderable["dueDate"]): number | null {
  if (d == null) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Where `todo` can be put among `others` (its list's other open todos, in
 * order), as an inclusive [first, last] range of indexes: among the todos with
 * the same due date (none: undated), or, with none of its kind, the one place
 * the server's sort gives it.
 */
export function movableRange(todo: Orderable, others: Orderable[]): [number, number] {
  const due = dueTime(todo.dueDate);
  const same: number[] = [];
  others.forEach((o, i) => {
    if (dueTime(o.dueDate) === due) same.push(i);
  });
  if (same.length > 0) return [same[0], same[same.length - 1] + 1];
  const after = others.findIndex((o) => {
    const t = dueTime(o.dueDate);
    return due === null ? t !== null : t !== null && t > due;
  });
  const only = after < 0 ? others.length : after;
  return [only, only];
}

/**
 * The place among the other rows for a pointer at height `y`: before the
 * first row whose middle is below it, else after the last; kept in `range`.
 */
export function insertionIndex(y: number, middles: number[], range: [number, number]): number {
  const below = middles.findIndex((m) => y < m);
  const index = below < 0 ? middles.length : below;
  return Math.min(Math.max(index, range[0]), range[1]);
}

/** `ids` with `id` taken out and put back at `index` among the rest. */
export function moveTo(ids: string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  if (rest.length === ids.length) return ids;
  const at = Math.min(Math.max(index, 0), rest.length);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * `rows` with the ones named in `order` rearranged into that order, in the
 * slots they already fill; rows not named keep their place.
 */
export function applyOrder<T extends { id: string }>(rows: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const named = rows.filter((r) => rank.has(r.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  if (named.length === 0) return rows;
  let next = 0;
  return rows.map((r) => (rank.has(r.id) ? named[next++] : r));
}

/** True when the rows named in `order` already come in that order. */
export function inOrder(rows: { id: string }[], order: string[]): boolean {
  const named = new Set(order);
  const shown = rows.filter((r) => named.has(r.id)).map((r) => r.id);
  const wanted = order.filter((id) => shown.includes(id));
  return shown.every((id, i) => id === wanted[i]);
}

// The todo being dragged with the mouse. A card can only read the drag's data
// on drop (browsers hide it during dragover), and it needs to know during
// dragover whether the todo is its own, to show where it would land.
export type TodoDrag = { todoId: string; sourceListId: string };
let activeDrag: TodoDrag | null = null;
export function setTodoDrag(drag: TodoDrag | null) {
  activeDrag = drag;
}
export function todoDrag(): TodoDrag | null {
  return activeDrag;
}
