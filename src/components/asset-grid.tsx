"use client";

import { useEffect, useMemo, useState } from "react";
import NextImage from "next/image";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Star,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
}: {
  kind: string;
  initialAssets: AssetRow[];
  fields: EditorField[];
  showMoneyTotal?: boolean;
  emptyHint?: string;
  autoEnrich?: "place";
}) {
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<View>("table");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [showImages, setShowImages] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
        };
        if (p.view) setView(p.view);
        if (p.groupBy) setGroupBy(p.groupBy);
        if (typeof p.showImages === "boolean") setShowImages(p.showImages);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefKey]);
  function persist(p: { view?: View; groupBy?: GroupBy; showImages?: boolean }) {
    try {
      const raw = localStorage.getItem(prefKey);
      const cur = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      localStorage.setItem(prefKey, JSON.stringify({ ...cur, ...p }));
    } catch {}
  }

  const total = showMoneyTotal
    ? initialAssets.reduce(
        (sum, a) => sum + (a.currentValue ?? a.amountUsd ?? 0),
        0
      )
    : 0;
  const totalCost = showMoneyTotal
    ? initialAssets.reduce((sum, a) => sum + (a.costBasis ?? 0), 0)
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
    if (groupBy === "none") return [{ key: "all", label: null, rows: initialAssets }];
    const map = new Map<string, AssetRow[]>();
    for (const a of initialAssets) {
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
  }, [initialAssets, groupBy]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      {showMoneyTotal && initialAssets.length > 0 ? (
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
                  total >= totalCost ? "text-emerald-500" : "text-rose-500"
                )}
              >
                {total >= totalCost ? "+" : ""}
                {(((total - totalCost) / totalCost) * 100).toFixed(1)}%
              </div>
            </div>
          ) : null}
          <div className="ml-auto text-xs text-[var(--color-muted-foreground)]">
            {initialAssets.length} positions
          </div>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="hidden md:inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
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

      {initialAssets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          {emptyHint ?? "Nothing here yet."}
        </div>
      ) : null}

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
                <>
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
                />
              )
            ) : null}
          </div>
        );
      })}

      <AssetEditor
        open={!!editing || addOpen}
        asset={editing}
        kind={kind}
        fields={editorFields}
        autoEnrich={autoEnrich}
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

function TableView({
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
                  <div className="font-medium">{a.title}</div>
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

function CardView({
  rows,
  showImages,
  onEdit,
}: {
  rows: AssetRow[];
  showImages: boolean;
  onEdit: (a: AssetRow) => void;
}) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((a) => (
        <button
          key={a.id}
          onClick={() => onEdit(a)}
          className="group rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 hover:bg-[var(--color-accent)]/40 transition relative text-left"
        >
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
        </button>
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
