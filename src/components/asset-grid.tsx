"use client";

import { useEffect, useMemo, useState, useRef, useLayoutEffect } from "react";
import NextImage from "next/image";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  LayoutGrid,
  Maximize2,
  Plus,
  Paperclip,
  Star,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TableView, SpreadsheetTable, BulkBar, useSpreadsheetRows } from "./asset-table";
import { AssetEditor, detailStr, type EditorField } from "./asset-editor";

export type AssetRow = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  status: string | null;
  amountUsd: number | null;
  currentValue: number | null;
  costBasis: number | null;
  returnPercent: number | null;
  url: string | null;
  imageUrl: string | null;
  location: string | null;
  rating: number | null;
  acquiredAt: Date | string | null;
  notes: string | null;
  detailsJson?: unknown;
  attachmentCount?: number;
};

type View = "cards" | "table";
type GroupBy = "none" | "status" | "category";

export function AssetGrid({
  kind,
  initialAssets,
  fields,
  showMoneyTotal,
  emptyHint,
  autoEnrich,
  smartFill,
  attachments,
  spreadsheet = false,
}: {
  kind: string;
  initialAssets: AssetRow[];
  fields: EditorField[];
  showMoneyTotal?: boolean;
  emptyHint?: string;
  autoEnrich?: "place" | "media";
  smartFill?: "inventory";
  attachments?: boolean;
  spreadsheet?: boolean;
}) {
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<View>("table");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [showImages, setShowImages] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const { rows, commit, bulk, busy, pending, error, retry } = useSpreadsheetRows(initialAssets);
  const assets = spreadsheet ? rows : initialAssets;
  const statuses = useMemo(() => [...new Set(initialAssets.map((a) => a.status ?? "—"))], [initialAssets]);
  const ownedStatuses = useMemo(() => {
    const defaults = statuses.filter((s) => ["owned", "loaned", "stored", "broken"].includes(s));
    return defaults.length ? defaults : statuses;
  }, [statuses]);
  const [statusFilter, setStatusFilter] = useState<string[] | null>(null);
  const activeStatuses = statusFilter ?? ownedStatuses;
  const filtered = useMemo(() => spreadsheet
    ? assets.filter((a) => activeStatuses.includes(a.status ?? "—"))
    : assets, [assets, spreadsheet, activeStatuses]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!spreadsheet || !grid?.dataset.focusRow) return;
    const target = Array.from(grid.querySelectorAll<HTMLTableCellElement>("td[data-editable]")).find((cell) => cell.dataset.row === grid.dataset.focusRow && cell.dataset.column === grid.dataset.focusColumn);
    delete grid.dataset.focusRow;
    delete grid.dataset.focusColumn;
    target?.focus();
  });
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (busy) return;
    setSelected((prev) => new Set([...prev].filter((id) => rows.some((a) => a.id === id))));
  }, [rows, busy]);

  // Persist view + group prefs per kind.
  const prefKey = `personalos:asset-pref:${kind}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefKey);
      if (raw) {
        const p = JSON.parse(raw) as {
          view?: View;
          groupBy?: GroupBy;
          showImages?: boolean;
          statusFilter?: string[];
        };
        if (spreadsheet && Array.isArray(p.statusFilter) && p.statusFilter.every((s) => typeof s === "string")) setStatusFilter(p.statusFilter);
        if (p.view) setView(p.view);
        if (p.groupBy) setGroupBy(p.groupBy);
        if (typeof p.showImages === "boolean") setShowImages(p.showImages);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefKey, spreadsheet]);
  function persist(p: { view?: View; groupBy?: GroupBy; showImages?: boolean; statusFilter?: string[] }) {
    try {
      const raw = localStorage.getItem(prefKey);
      const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem(prefKey, JSON.stringify({ ...cur, ...p }));
    } catch {}
  }

  const total = showMoneyTotal
    ? filtered.reduce(
        (sum, a) => sum + (a.currentValue ?? a.amountUsd ?? 0),
        0
      )
    : 0;
  const totalCost = showMoneyTotal
    ? filtered.reduce((sum, a) => sum + (a.costBasis ?? 0), 0)
    : 0;

  // Chips should offer values already in use, not just the static defaults —
  // otherwise an existing vocabulary ("Paris", "art") can't be re-selected.
  const editorFields = useMemo(() => {
    return fields.map((f) => {
      if (!f.suggestions || f.detail) return f;
      const seen = new Set(f.suggestions.map((s) => s.toLowerCase()));
      const merged = [...f.suggestions];
      for (const a of initialAssets) {
        const v = a[f.key as keyof AssetRow];
        if (typeof v !== "string") continue;
        const t = v.trim();
        if (!t || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        merged.push(t);
      }
      return { ...f, suggestions: merged.slice(0, 12) };
    });
  }, [fields, initialAssets]);

  // Build groups.
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: null, rows: filtered }];
    const map = new Map<string, AssetRow[]>();
    for (const a of filtered) {
      const k = (groupBy === "status" ? a.status : a.category) ?? "—";
      const arr = map.get(k) ?? [];
      arr.push(a);
      map.set(k, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        // Put "—" last
        if (a === "—") return 1;
        if (b === "—") return -1;
        return a.localeCompare(b);
      })
      .map(([key, rows]) => ({
        key,
        label: key === "—" ? "Uncategorized" : key,
        rows,
      }));
  }, [filtered, groupBy]);

  const visibleIds = groups.filter((g) => !collapsedGroups.has(g.key)).flatMap((g) => g.rows.map((a) => a.id));
  function selectRow(id: string, shift: boolean) {
    const anchor = lastSelected.current;
    setSelected((prev) => {
      const next = new Set(prev);
      const checked = !next.has(id);
      const start = anchor ? visibleIds.indexOf(anchor) : -1;
      const end = visibleIds.indexOf(id);
      const ids = shift && start >= 0 && end >= 0
        ? visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1) : [id];
      for (const rowId of ids) { if (checked) next.add(rowId); else next.delete(rowId); }
      return next;
    });
    lastSelected.current = id;
  }
  function selectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = visibleIds.every((id) => prev.has(id));
      for (const id of visibleIds) { if (all) next.delete(id); else next.add(id); }
      return next;
    });
  }
  function filterStatuses(next: string[]) {
    setStatusFilter(next);
    persist({ statusFilter: next });
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div ref={gridRef} data-asset-grid={spreadsheet ? "" : undefined} className={spreadsheet && selected.size ? "pb-48" : undefined}>
      {showMoneyTotal && assets.length > 0 ? (
        <div className="mb-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 flex items-baseline gap-6 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Portfolio total
            </div>
            <div className="text-3xl font-bold tabular-nums">
              ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          {totalCost > 0 ? (
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Cost basis
              </div>
              <div className="text-lg tabular-nums">
                ${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          ) : null}
          {totalCost > 0 ? (
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                Return
              </div>
              <div
                className={cn(
                  "text-lg tabular-nums",
                  !spreadsheet && (total >= totalCost ? "text-emerald-500" : "text-rose-500")
                )}
              >
                {total >= totalCost ? "+" : ""}
                {(((total - totalCost) / totalCost) * 100).toFixed(1)}%
              </div>
            </div>
          ) : null}
          <div className="ml-auto text-xs text-[var(--color-muted-foreground)]">
            {spreadsheet && filtered.length !== assets.length ? `${filtered.length} of ${assets.length} shown` : `${assets.length} positions`}
          </div>
        </div>
      ) : null}

      {spreadsheet ? (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap text-xs">
          <StatusChip label="Owned only" active={ownedStatuses.length === activeStatuses.length && ownedStatuses.every((s) => activeStatuses.includes(s))} onClick={() => filterStatuses(ownedStatuses)} />
          <span className="text-[var(--color-muted-foreground)]">Status:</span>
          {statuses.map((status) => <StatusChip key={status} label={status} active={activeStatuses.includes(status)} onClick={() => filterStatuses(activeStatuses.includes(status) ? activeStatuses.filter((s) => s !== status) : [...activeStatuses, status])} />)}
        </div>
      ) : null}
      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        {spreadsheet && view === "cards" ? <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" aria-label="Select all visible rows" checked={visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))} ref={(el) => { if (el) el.indeterminate = visibleIds.some((id) => selected.has(id)) && !visibleIds.every((id) => selected.has(id)); }} onChange={selectAll} className="accent-[var(--color-foreground)]" />Select all</label> : null}
        <div className={cn(spreadsheet ? "inline-flex" : "hidden md:inline-flex", "rounded-md border border-[var(--color-border)] overflow-hidden")}>
          <ToolbarBtn
            active={view === "table"}
            onClick={() => {
              setView("table");
              persist({ view: "table" });
            }}
          >
            <Table2 className="size-3.5" /> Table
          </ToolbarBtn>
          <ToolbarBtn
            active={view === "cards"}
            onClick={() => {
              setView("cards");
              persist({ view: "cards" });
            }}
          >
            <LayoutGrid className="size-3.5" /> Cards
          </ToolbarBtn>
        </div>
        <div className="inline-flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
          <span className="hidden sm:inline">Group:</span>
          <select
            value={groupBy}
            onChange={(e) => {
              const v = e.target.value as GroupBy;
              setGroupBy(v);
              persist({ groupBy: v });
            }}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5 text-xs focus:outline-none min-h-[36px]"
          >
            <option value="none">no group</option>
            <option value="status">by status</option>
            <option value="category">by category</option>
          </select>
        </div>
        {view === "cards" ? (
          <button
            onClick={() => {
              setShowImages((v) => {
                persist({ showImages: !v });
                return !v;
              });
            }}
            className={cn(
              "hidden md:inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition",
              showImages
                ? "border-[var(--color-foreground)]/40 text-[var(--color-foreground)]"
                : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            )}
          >
            <ImageIcon className="size-3.5" />
            {showImages ? "Hide images" : "Show images"}
          </button>
        ) : null}
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium min-h-[36px]"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          {emptyHint ?? "Nothing here yet."}
        </div>
      ) : null}

      {spreadsheet && assets.length > 0 && filtered.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">No items match the selected statuses.</p> : null}
      {groups.map((g) => {
        const open = !collapsedGroups.has(g.key);
        const hasMoney =
          g.rows.some((a) => a.currentValue != null || a.amountUsd != null);
        const groupTotal = hasMoney
          ? g.rows.reduce(
              (s, a) => s + (a.currentValue ?? a.amountUsd ?? 0),
              0
            )
          : 0;
        return (
          <div key={g.key} className="mb-4">
            {g.label != null ? (
              <button
                onClick={() => toggleGroup(g.key)}
                className="w-full flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                {open ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                <span>{g.label}</span>
                <span className="opacity-70 tabular-nums">{g.rows.length}</span>
                {hasMoney && open ? (
                  <span className="ml-2 opacity-70 tabular-nums">
                    ${groupTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                ) : null}
              </button>
            ) : null}

            {open ? (
              view === "table" ? (
                spreadsheet ? <SpreadsheetTable rows={g.rows} fields={fields} onEdit={setEditing} onCommit={commit} selected={selected} onSelect={selectRow} onSelectAll={selectAll} visibleIds={visibleIds} busy={busy} pending={pending} /> : <>
                  <div className="md:hidden">
                    <MobileList rows={g.rows} onEdit={setEditing} />
                  </div>
                  <div className="hidden md:block">
                    <TableView rows={g.rows} onEdit={setEditing} />
                  </div>
                </>
              ) : (
                <CardView
                  rows={g.rows}
                  showImages={showImages}
                  onEdit={setEditing}
                  selection={spreadsheet ? { selected, onSelect: selectRow } : undefined}
                />
              )
            ) : null}
          </div>
        );
      })}

      {spreadsheet && selected.size > 0 ? <BulkBar rows={rows} fields={fields} count={selected.size} busy={busy || pending.size > 0} onClear={() => setSelected(new Set())} onAction={async (action, data) => {
        const ok = await bulk([...selected], action, data);
        if (ok) setSelected(new Set());
      }} /> : null}
      {spreadsheet && error ? <div role="alert" className="fixed bottom-[calc(12rem+env(safe-area-inset-bottom))] md:bottom-24 left-1/2 -translate-x-1/2 z-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-xs shadow-lg">Couldn't save · <button className="underline" onClick={retry} disabled={busy || pending.size > 0}>retry</button></div> : null}
      <AssetEditor
        open={!!editing || addOpen}
        asset={editing}
        kind={kind}
        fields={editorFields}
        autoEnrich={autoEnrich}
        smartFill={smartFill}
        attachments={attachments}
        onClose={() => {
          setEditing(null);
          setAddOpen(false);
        }}
      />
    </div>
  );
}

function ToolbarBtn({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 text-xs",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
          : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      )}
    >
      {children}
    </button>
  );
}

function CardView({
  rows,
  showImages,
  onEdit,
  selection,
}: {
  rows: AssetRow[];
  showImages: boolean;
  onEdit: (a: AssetRow) => void;
  selection?: { selected: Set<string>; onSelect: (id: string, shift: boolean) => void };
}) {
  const Card = selection ? "div" : "button";
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((a) => (
        <Card
          key={a.id}
          onClick={selection ? undefined : () => onEdit(a)}
          className={cn("group rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 hover:bg-[var(--color-accent)]/40 transition relative text-left", selection?.selected.has(a.id) && "bg-[var(--color-accent)]/60")}
        >
          {selection ? <div className="mb-2 flex items-center justify-between">
            <input type="checkbox" aria-label={`Select ${a.title}`} checked={selection.selected.has(a.id)} onChange={() => {}} onClick={(e) => selection.onSelect(a.id, e.shiftKey)} className="accent-[var(--color-foreground)]" />
            <button onClick={() => onEdit(a)} aria-label={`Open ${a.title}`} title="Open"><Maximize2 className="size-3.5" /></button>
          </div> : null}
          {showImages && a.imageUrl ? (
            <div className="relative w-full h-28 mb-3">
              <NextImage
                src={a.imageUrl}
                alt=""
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover rounded-lg"
              />
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-semibold tracking-tight truncate">
                {a.title}
              </div>
              {a.subtitle ? (
                <div className="text-xs text-[var(--color-muted-foreground)] truncate">
                  {a.subtitle}
                </div>
              ) : null}
              {a.category ? (
                <div className="mt-1 inline-flex items-center rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                  {a.category}
                </div>
              ) : null}
            </div>
            {a.url ? (
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="opacity-50 md:opacity-0 md:group-hover:opacity-100 p-1 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition"
                title="Open link"
              >
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>

          <div className="mt-2 space-y-1 text-sm">
            {a.currentValue != null || a.amountUsd != null ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">
                  ${(a.currentValue ?? a.amountUsd)!.toLocaleString()}
                </span>
                {a.costBasis != null && a.currentValue != null ? (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      a.currentValue >= a.costBasis
                        ? "text-emerald-500"
                        : "text-rose-500"
                    )}
                  >
                    {a.currentValue >= a.costBasis ? "+" : ""}
                    {(
                      ((a.currentValue - a.costBasis) / a.costBasis) *
                      100
                    ).toFixed(1)}
                    %
                  </span>
                ) : null}
              </div>
            ) : null}
            {a.rating != null ? (
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={cn(
                      "size-3.5",
                      n <= a.rating!
                        ? "fill-amber-400 text-amber-400"
                        : "text-[var(--color-muted-foreground)]/30"
                    )}
                  />
                ))}
              </div>
            ) : null}
            {a.location ? (
              <div className="text-xs text-[var(--color-muted-foreground)]">
                {a.location}
              </div>
            ) : null}
            {detailStr(a, "staff") ? (
              <div className="text-xs text-[var(--color-muted-foreground)]">
                Ask for {detailStr(a, "staff")}
              </div>
            ) : null}
            {a.status ? (
              <div className="text-xs">
                <span
                  className={cn(
                    "inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                    a.status === "active" ||
                      a.status === "owned" ||
                      a.status === "visited"
                      ? "bg-emerald-500/20 text-emerald-500"
                      : a.status === "wishlist" || a.status === "tbr"
                        ? "bg-amber-500/20 text-amber-500"
                        : "bg-[var(--color-accent)]/60"
                  )}
                >
                  {a.status}
                </span>
              </div>
            ) : null}
            {a.notes ? (
              <div className="text-xs text-[var(--color-muted-foreground)] line-clamp-2 whitespace-pre-wrap">
                {a.notes}
              </div>
            ) : null}
          </div>
          <AttachmentCount count={a.attachmentCount} />
        </Card>
      ))}
    </div>
  );
}

function MobileList({
  rows,
  onEdit,
}: {
  rows: AssetRow[];
  onEdit: (a: AssetRow) => void;
}) {
  return (
    <ul className="rounded-xl border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
      {rows.map((a) => {
        const ret =
          a.returnPercent != null
            ? a.returnPercent
            : a.costBasis != null && a.currentValue != null
              ? ((a.currentValue - a.costBasis) / a.costBasis) * 100
              : null;
        const value = a.currentValue ?? a.amountUsd;
        return (
          <li key={a.id}>
            <button
              onClick={() => onEdit(a)}
              className="w-full flex items-start gap-3 px-3 py-3 text-left active:bg-[var(--color-accent)]/40 min-h-[64px]"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <div className="font-medium text-sm truncate flex-1">
                    {a.title}
                  </div>
                  {value != null ? (
                    <div className="text-sm font-semibold tabular-nums shrink-0">
                      ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {a.subtitle ? (
                    <span className="truncate">{a.subtitle}</span>
                  ) : null}
                  {detailStr(a, "staff") ? (
                    <span className="truncate shrink-0">
                      · ask for {detailStr(a, "staff")}
                    </span>
                  ) : null}
                  {ret != null ? (
                    <span
                      className={cn(
                        "tabular-nums shrink-0 ml-auto",
                        ret > 0 ? "text-emerald-500" : ret < 0 ? "text-rose-500" : ""
                      )}
                    >
                      {ret > 0 ? "+" : ""}
                      {ret.toFixed(0)}%
                    </span>
                  ) : null}
                </div>
                {(a.category || a.status || a.rating != null) ? (
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {a.category ? (
                      <span className="inline-flex rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                        {a.category}
                      </span>
                    ) : null}
                    {a.status ? (
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                          a.status === "active" || a.status === "owned" || a.status === "visited"
                            ? "bg-emerald-500/20 text-emerald-500"
                            : a.status === "wishlist" || a.status === "tbr"
                              ? "bg-amber-500/20 text-amber-500"
                              : "bg-[var(--color-accent)]/60"
                        )}
                      >
                        {a.status}
                      </span>
                    ) : null}
                    {a.rating != null ? (
                      <div className="flex items-center gap-0.5">
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
                    ) : null}
                  </div>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AttachmentCount({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="inline-flex items-center gap-1 text-xs font-normal text-[var(--color-muted-foreground)]" aria-label={`${count} attachments`}><Paperclip className="size-3" />{count}</span>;
}

function StatusChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button aria-pressed={active} onClick={onClick} className={cn("rounded-full px-2.5 py-1 text-xs border min-h-[28px]", active ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]" : "border-[var(--color-border)] hover:border-[var(--color-foreground)]/30")}>{label}</button>;
}
