"use client";

import { useRef, useState, useId, useEffect } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/haptic";
import { ExternalLink, Star, Paperclip, Maximize2 } from "lucide-react";
import { cn, toDateInputValue } from "@/lib/utils";
import { detailStr, type EditorField } from "./asset-editor";
import type { AssetRow } from "./asset-grid";

export function TableView({
  rows,
  onEdit,
}: {
  rows: AssetRow[];
  onEdit: (a: AssetRow) => void;
}) {
  const hasMoney = rows.some(
    (a) => a.currentValue != null || a.costBasis != null || a.amountUsd != null
  );
  const hasRating = rows.some((a) => a.rating != null);

  return (
    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--color-accent)]/30 text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider">
          <tr>
            <th className="text-left font-semibold px-3 py-2">Title</th>
            <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">
              Detail
            </th>
            <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">
              Category
            </th>
            {hasMoney ? (
              <>
                <th className="text-right font-semibold px-3 py-2 tabular-nums">
                  Cost
                </th>
                <th className="text-right font-semibold px-3 py-2 tabular-nums">
                  Value
                </th>
                <th className="text-right font-semibold px-3 py-2 tabular-nums">
                  Expected Return
                </th>
              </>
            ) : null}
            {hasRating ? (
              <th className="text-right font-semibold px-3 py-2 hidden sm:table-cell">
                Rating
              </th>
            ) : null}
            <th className="px-3 py-2 w-6"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            // Prefer the stored returnPercent if set; otherwise compute from
            // cost basis + current value.
            const ret =
              a.returnPercent != null
                ? a.returnPercent
                : a.costBasis != null && a.currentValue != null
                  ? ((a.currentValue - a.costBasis) / a.costBasis) * 100
                  : null;
            return (
              <tr
                key={a.id}
                onClick={() => onEdit(a)}
                className="border-t border-[var(--color-border)] hover:bg-[var(--color-accent)]/30 cursor-pointer"
              >
                <td className="px-3 py-2 align-top">
                  <div className="font-medium">{a.title} <AttachmentCount count={a.attachmentCount} /></div>
                  {a.notes ? (
                    <div className="text-xs text-[var(--color-muted-foreground)] line-clamp-1 md:hidden">
                      {a.notes}
                    </div>
                  ) : null}
                  <div className="md:hidden text-xs text-[var(--color-muted-foreground)] mt-0.5">
                    {a.subtitle ?? a.category ?? a.location}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-[var(--color-muted-foreground)] hidden md:table-cell">
                  {a.subtitle ?? a.location ?? "—"}
                  {detailStr(a, "staff") ? (
                    <span className="text-xs"> · ask for {detailStr(a, "staff")}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 align-top hidden md:table-cell">
                  {a.category ? (
                    <span className="inline-flex rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                      {a.category}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      —
                    </span>
                  )}
                </td>
                {hasMoney ? (
                  <>
                    <td className="px-3 py-2 align-top text-right tabular-nums text-[var(--color-muted-foreground)]">
                      {a.costBasis != null
                        ? `$${a.costBasis.toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums font-medium">
                      {a.currentValue != null
                        ? `$${a.currentValue.toLocaleString()}`
                        : a.amountUsd != null
                          ? `$${a.amountUsd.toLocaleString()}`
                          : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 align-top text-right tabular-nums",
                        ret != null && ret > 0 && "text-emerald-500",
                        ret != null && ret < 0 && "text-rose-500"
                      )}
                    >
                      {ret != null
                        ? `${ret > 0 ? "+" : ""}${ret.toFixed(0)}%`
                        : "—"}
                    </td>
                  </>
                ) : null}
                {hasRating ? (
                  <td className="px-3 py-2 align-top text-right hidden sm:table-cell">
                    {a.rating != null ? (
                      <div className="inline-flex items-center gap-0.5 justify-end">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={cn(
                              "size-3",
                              n <= a.rating!
                                ? "fill-amber-400 text-amber-400"
                                : "text-[var(--color-muted-foreground)]/30"
                            )}
                          />
                        ))}
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                ) : null}
                <td className="px-3 py-2 align-top w-6">
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AttachmentCount({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="inline-flex items-center gap-1 text-xs font-normal text-[var(--color-muted-foreground)]" aria-label={`${count} attachments`}><Paperclip className="size-3" />{count}</span>;
}


type EditableKey = "title" | "subtitle" | "category" | "status" | "location" | "costBasis" | "currentValue" | "acquiredAt";
type CellValue = string | number | null;
type BulkData = { status?: string | null; category?: string | null; location?: string | null };
const columns: { key: EditableKey; label: string; type?: "number" | "date" }[] = [
  { key: "title", label: "Title" },
  { key: "subtitle", label: "Brand / model" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "location", label: "Where" },
  { key: "costBasis", label: "Cost", type: "number" },
  { key: "currentValue", label: "Value", type: "number" },
  { key: "acquiredAt", label: "Purchase date", type: "date" },
];

function EditableCell({ row, column, suggestions, disabled, onCommit }: {
  row: AssetRow;
  column: typeof columns[number];
  suggestions?: string[];
  disabled: boolean;
  onCommit: (id: string, key: EditableKey, value: CellValue) => void;
}) {
  const { key, type = "text", label } = column;
  const value = type === "date" ? toDateInputValue(row.acquiredAt) : String(row[key] ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const active = useRef(false);
  const cell = useRef<HTMLTableCellElement>(null);
  const listId = useId();
  function begin() {
    if (disabled || active.current) return;
    setDraft(value);
    active.current = true;
    setEditing(true);
  }
  function finish(save: boolean) {
    if (!active.current) return;
    active.current = false;
    setEditing(false);
    if (!save) return;
    // Preserve decimal amounts while removing currency/grouping characters.
    const numeric = draft.replace(/[^\d.-]/g, "");
    const next = type === "number" ? (numeric === "" ? null : Number(numeric))
      : type === "date" ? (draft || null) : key === "title" ? draft : (draft || null);
    if (typeof next === "number" && !Number.isFinite(next)) return;
    const previous = type === "date" ? (value || null) : row[key];
    if (next !== previous) onCommit(row.id, key, next);
  }
  function move(direction: "up" | "down" | "next" | "previous") {
    const current = cell.current;
    const root = current?.closest("[data-asset-grid]");
    if (!current || !root) return false;
    const cells = Array.from(root.querySelectorAll<HTMLTableCellElement>("td[data-editable]"));
    const candidates = direction === "up" || direction === "down"
      ? cells.filter((el) => el.dataset.column === key) : cells.filter((el) => el.dataset.row === row.id);
    const index = candidates.indexOf(current);
    const target = candidates[index + (direction === "up" || direction === "previous" ? -1 : 1)];
    if (!target) return false;
    // Regrouping can remount the destination after the optimistic update.
    const grid = root as HTMLElement;
    grid.dataset.focusRow = target.dataset.row;
    grid.dataset.focusColumn = target.dataset.column;
    target.focus();
    return true;
  }
  return (
    <td ref={cell} tabIndex={editing ? -1 : 0} data-editable data-column={key} data-row={row.id}
      aria-label={`${label}: ${value || "empty"}`} aria-disabled={disabled}
      onClick={begin}
      onKeyDown={(e) => {
        if (editing) return;
        if (e.key === "Enter") { e.preventDefault(); begin(); }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); move(e.key === "ArrowUp" ? "up" : "down"); }
      }}
      className={cn(
        "px-3 py-2 align-top min-w-28 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-ring)]",
        type === "number" && "text-right tabular-nums",
        key === "title" && "font-medium min-w-44",
        // Match the Investments table: muted supporting columns, medium-weight
        // current value, and no wrapping so rows stay one line tall.
        (key === "subtitle" || key === "location" || key === "costBasis" || key === "acquiredAt") && "text-[var(--color-muted-foreground)]",
        key === "currentValue" && "font-medium",
        (key === "location" || key === "status" || key === "category") && "whitespace-nowrap",
        disabled ? "opacity-60" : "cursor-text",
      )}>
      {/* size={1} + min-w-0: an <input> otherwise carries a ~20ch intrinsic width,
          which widens the whole column in an auto-layout table the moment a cell
          enters edit mode. Numbers keep the column's right alignment and drop the
          native spinners, which don't belong in a dense money table. */}
      {editing ? <input autoFocus aria-label={label} type={type} size={1} step={type === "number" ? "any" : undefined}
        value={draft} list={suggestions?.length ? listId : undefined}
        className={cn(
          "w-full min-w-0 rounded-sm border border-[var(--color-ring)] bg-[var(--color-background)] px-1 py-0 text-sm leading-5 focus:outline-none",
          type === "number" && "text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
        onChange={(e) => setDraft(e.target.value)} onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault(); finish(e.key === "Enter"); cell.current?.focus();
          } else if (e.key === "Tab") {
            finish(true);
            if (move(e.shiftKey ? "previous" : "next")) e.preventDefault();
          }
        }} /> : <>{
        key === "category"
          ? (value ? <span className="inline-flex whitespace-nowrap rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">{value}</span> : <span className="text-xs text-[var(--color-muted-foreground)]">—</span>)
          : type === "number" && row[key] != null ? `$${Number(row[key]).toLocaleString()}`
          : value || "—"
      }{key === "title" ? <> <AttachmentCount count={row.attachmentCount} /></> : null}</>}
      {suggestions?.length ? <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist> : null}
    </td>
  );
}

export function SpreadsheetTable({ rows, fields, onEdit, onCommit, selected, onSelect, onSelectAll, visibleIds, busy, pending }: {
  rows: AssetRow[]; fields: EditorField[]; onEdit: (row: AssetRow) => void;
  onCommit: (id: string, key: EditableKey, value: CellValue) => void;
  selected: Set<string>; onSelect: (id: string, shift: boolean) => void; onSelectAll: () => void;
  visibleIds: string[]; busy: boolean; pending: Set<string>;
}) {
  const all = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const some = visibleIds.some((id) => selected.has(id));
  return <div className="rounded-xl border border-[var(--color-border)] overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-[var(--color-accent)]/30 text-xs text-[var(--color-muted-foreground)] uppercase tracking-wider"><tr>
        <th className="px-3 py-2"><input type="checkbox" aria-label="Select all visible rows" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} onChange={onSelectAll} className="accent-[var(--color-foreground)]" /></th>
        {columns.map((column) => <th key={column.key} className={cn("px-3 py-2 text-left font-semibold whitespace-nowrap", column.type === "number" && "text-right")}>{column.label}</th>)}
        <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Expected Return</th>
        <th className="px-3 py-2"><span className="sr-only">Open</span></th>
      </tr></thead>
      <tbody>{rows.map((row) => {
        const ret = row.returnPercent ?? (row.costBasis && row.currentValue != null ? (row.currentValue - row.costBasis) / row.costBasis * 100 : null);
        return <tr key={row.id} className={cn("border-t border-[var(--color-border)] hover:bg-[var(--color-accent)]/30", selected.has(row.id) && "bg-[var(--color-accent)]/60")}>
          <td className="px-3 py-2 align-top"><input type="checkbox" aria-label={`Select ${row.title}`} checked={selected.has(row.id)} onChange={() => {}} onClick={(e) => onSelect(row.id, e.shiftKey)} className="accent-[var(--color-foreground)]" /></td>
          {columns.map((column) => <EditableCell key={column.key} row={row} column={column} disabled={busy || pending.has(`${row.id}:${column.key}`)} suggestions={column.key === "category" || column.key === "status" ? fields.find((f) => f.key === column.key)?.suggestions : undefined} onCommit={onCommit} />)}
          <td className={cn("px-3 py-2 align-top text-right tabular-nums", ret != null && ret > 0 && "text-emerald-500", ret != null && ret < 0 && "text-rose-500")}>{ret != null ? `${ret > 0 ? "+" : ""}${ret.toFixed(0)}%` : "—"}</td>
          <td className="px-3 py-2 align-top"><div className="flex gap-2">
            {row.url ? <a href={row.url} target="_blank" rel="noreferrer" aria-label={`Open link for ${row.title}`}><ExternalLink className="size-3.5" /></a> : null}
            <button onClick={() => onEdit(row)} aria-label={`Open ${row.title}`} title="Open"><Maximize2 className="size-3.5" /></button>
          </div></td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function BulkBar({ rows, fields, count, busy, onClear, onAction }: {
  rows: AssetRow[]; fields: EditorField[]; count: number; busy: boolean;
  onClear: () => void; onAction: (action: "update" | "delete", data?: BulkData) => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [whereOpen, setWhereOpen] = useState(false);
  const [location, setLocation] = useState("");
  const control = "rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-xs min-h-9";
  return <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 pt-3 pb-[calc(1rem+56px+env(safe-area-inset-bottom))] md:pb-4 shadow-lg">
    <fieldset disabled={busy} className="flex items-center justify-center gap-2 flex-wrap disabled:opacity-60">
      <span className="text-sm font-medium" aria-live="polite">{count} selected</span>
      {(["status", "category"] as const).map((key) => {
        const suggestions = [...new Set([...(fields.find((f) => f.key === key)?.suggestions ?? []), ...rows.flatMap((a) => a[key] == null ? [] : [a[key]])])];
        return <select key={key} aria-label={`Set ${key}`} className={control} value="" onChange={(e) => { void onAction("update", { [key]: e.target.value === "null" ? null : suggestions[Number(e.target.value)] }); }}>
          <option value="" disabled>Set {key} ▾</option>
          <option value="null">—</option>
          {suggestions.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select>;
      })}
      {whereOpen ? <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void onAction("update", { location: location || null }); }}>
        <input autoFocus aria-label="Set where" value={location} onChange={(e) => setLocation(e.target.value)} className={control} />
        <button className={control}>Apply</button>
      </form> : <button className={control} onClick={() => setWhereOpen(true)}>Set where…</button>}
      {confirmDelete ? <>
        <span className="text-xs">Delete {count} items? This also removes their files.</span>
        <button className={control} onClick={() => { void onAction("delete"); setConfirmDelete(false); }}>Confirm</button>
        <button className={control} onClick={() => setConfirmDelete(false)}>Cancel</button>
      </> : <button className={control} onClick={() => setConfirmDelete(true)}>Delete</button>}
      <button className={control} onClick={onClear}>Clear</button>
    </fieldset>
  </div>;
}

export function useSpreadsheetRows(initialAssets: AssetRow[]) {
  const router = useRouter();
  const [rows, setRows] = useState(initialAssets);
  const current = useRef(rows);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState(false);
  const retryAction = useRef<(() => void) | null>(null);
  function changeRows(update: (prev: AssetRow[]) => AssetRow[]) {
    current.current = update(current.current);
    setRows(current.current);
  }
  useEffect(() => {
    current.current = initialAssets;
    setRows(initialAssets);
  }, [initialAssets]);

  async function commit(id: string, key: EditableKey, value: CellValue) {
    const token = `${id}:${key}`;
    if (busyRef.current || pendingRef.current.has(token)) return;
    const previous = current.current.find((a) => a.id === id)?.[key];
    if (previous === undefined || previous === value) return;
    pendingRef.current.add(token);
    setPending(new Set(pendingRef.current));
    changeRows((prev) => prev.map((a) => a.id === id ? { ...a, [key]: value } : a));
    try {
      const response = await fetch(`/api/assets/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) throw new Error("save failed");
      haptic("tick");
    } catch {
      changeRows((prev) => prev.map((a) => a.id === id ? { ...a, [key]: previous } : a));
      setError(true);
      retryAction.current = () => { void commit(id, key, value); };
    } finally {
      pendingRef.current.delete(token);
      setPending(new Set(pendingRef.current));
    }
  }

  async function bulk(ids: string[], action: "update" | "delete", data?: BulkData): Promise<boolean> {
    if (busyRef.current || pendingRef.current.size) return false;
    busyRef.current = true;
    setBusy(true);
    const before = current.current;
    const idSet = new Set(ids);
    changeRows((prev) => action === "delete" ? prev.filter((a) => !idSet.has(a.id)) : prev.map((a) => idSet.has(a.id) ? { ...a, ...data } : a));
    try {
      // Respect the route's 200-id limit for larger selections.
      for (let start = 0; start < ids.length; start += 200) {
        const response = await fetch("/api/assets/bulk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: ids.slice(start, start + 200), action, ...(action === "update" ? { data } : {}) }),
        });
        if (!response.ok) throw new Error("bulk save failed");
      }
      haptic("tick");
      return true;
    } catch {
      changeRows(() => before);
      setError(true);
      retryAction.current = () => { void bulk(ids, action, data); };
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
      // Also reconcile partial deletes or successful earlier batches on failure.
      router.refresh();
    }
  }
  function retry() {
    if (busyRef.current || pendingRef.current.size) return;
    setError(false);
    retryAction.current?.();
  }
  return { rows, commit, bulk, busy, pending, error, retry };
}
