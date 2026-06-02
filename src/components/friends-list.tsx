"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil, Plus, Save, Sparkles, Star, Trash2, X } from "lucide-react";
import { BulkAddPeople } from "./bulk-add-people";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptic";
import {
  ContextMenuPopover,
  useContextMenu,
  type AnyMenuEntry,
} from "./context-menu";

export type PersonRow = {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string | null;
  strength: string | null;
  circles: string[];
  tags: string[];
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  city: string | null;
  country: string | null;
  socialUrls: {
    linkedin?: string | null;
    twitter?: string | null;
    instagram?: string | null;
    github?: string | null;
    website?: string | null;
  } | null;
  howWeMet: string | null;
  interests: string[];
  birthday: string | null;
  lastInteractionAt: string | null;
  lastInteractionTitle: string | null;
  lastInteractionKind: string | null;
  createdAt: string | null;
  notes: string | null;
  imageUrl: string | null;
  starred: boolean;
};

type Filter = {
  strength?: string[];
  circle?: string[];
  city?: string[];
  bucket?: ("recent" | "30d" | "90d" | "1y" | "never")[];
  starred?: boolean;
  search?: string;
};

type SavedView = { name: string; filter: Filter };

const VIEWS_KEY = "personalos:friends-views";
const DEFAULT_VIEWS: SavedView[] = [
  { name: "⭐ Inner circle", filter: { starred: true } },
  { name: "Overdue (>30d)", filter: { bucket: ["30d", "90d", "1y", "never"] } },
];

function daysSince(d: string | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function bucketFor(days: number | null): "recent" | "30d" | "90d" | "1y" | "never" {
  if (days == null) return "never";
  if (days <= 30) return "recent";
  if (days <= 90) return "30d";
  if (days <= 365) return "90d";
  return "1y";
}

function bucketColor(b: ReturnType<typeof bucketFor>): string {
  switch (b) {
    case "recent":
      return "text-emerald-500";
    case "30d":
      return "text-amber-500";
    case "90d":
    case "1y":
    case "never":
      return "text-rose-500";
  }
}

function bucketLabel(days: number | null): string {
  if (days == null) return "Never";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function initials(p: PersonRow): string {
  const f = p.firstName?.[0] ?? "";
  const l = p.lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "?";
}

export function FriendsList({ initialPeople }: { initialPeople: PersonRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [people, setPeople] = useState(initialPeople);
  const [filter, setFilter] = useState<Filter>({});
  const [views, setViews] = useState<SavedView[]>(DEFAULT_VIEWS);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState<Set<string>>(new Set());
  type SortMode = "name" | "recent" | "overdue" | "added";
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window === "undefined") return "name";
    return (
      (localStorage.getItem("personalos:friends-sort") as SortMode) ?? "name"
    );
  });
  useEffect(() => {
    try {
      localStorage.setItem("personalos:friends-sort", sortMode);
    } catch {}
  }, [sortMode]);

  useEffect(() => {
    setPeople(initialPeople);
  }, [initialPeople]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEWS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedView[];
        if (Array.isArray(parsed)) setViews([...DEFAULT_VIEWS, ...parsed]);
      }
    } catch {}
  }, []);

  function persistViews(custom: SavedView[]) {
    setViews([...DEFAULT_VIEWS, ...custom]);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(custom));
    } catch {}
  }

  // Filter options computed from data.
  const allStrengths = useMemo(() => {
    const s = new Set<string>();
    for (const p of people) if (p.strength) s.add(p.strength);
    return [...s].sort();
  }, [people]);
  const allCircles = useMemo(() => {
    const s = new Set<string>();
    for (const p of people) for (const c of p.circles) s.add(c);
    return [...s].sort();
  }, [people]);
  // Cities ordered by how many people are in each (most-populated first), so
  // the cities you actually filter by surface at the front of the row.
  const allCities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) {
      const c = p.city?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([city]) => city);
  }, [people]);

  const filtered = useMemo(() => {
    const result = people.filter((p) => {
      if (filter.starred && !p.starred) return false;
      if (filter.strength?.length && !filter.strength.includes(p.strength ?? ""))
        return false;
      if (filter.circle?.length) {
        if (!filter.circle.some((c) => p.circles.includes(c))) return false;
      }
      if (filter.city?.length) {
        if (!filter.city.includes(p.city?.trim() ?? "")) return false;
      }
      if (filter.bucket?.length) {
        const b = bucketFor(daysSince(p.lastInteractionAt));
        if (!filter.bucket.includes(b)) return false;
      }
      if (filter.search) {
        const q = filter.search.toLowerCase();
        const hay =
          `${p.firstName} ${p.lastName ?? ""} ${p.company ?? ""} ${p.city ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Starred always rises to the top within the filtered set, then the
    // explicit sortMode kicks in.
    const lastSeenMs = (p: PersonRow) =>
      p.lastInteractionAt ? new Date(p.lastInteractionAt).getTime() : 0;
    const createdMs = (p: PersonRow) =>
      p.createdAt ? new Date(p.createdAt).getTime() : 0;
    const cmpName = (a: PersonRow, b: PersonRow) =>
      `${a.firstName} ${a.lastName ?? ""}`
        .toLowerCase()
        .localeCompare(`${b.firstName} ${b.lastName ?? ""}`.toLowerCase());

    return result.sort((a, b) => {
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      switch (sortMode) {
        case "name":
          return cmpName(a, b);
        case "recent": // most-recently-seen first; "never" sinks to bottom.
          return lastSeenMs(b) - lastSeenMs(a) || cmpName(a, b);
        case "overdue": // oldest / never-seen first (people you owe a check-in).
          return lastSeenMs(a) - lastSeenMs(b) || cmpName(a, b);
        case "added": // most-recently-added first.
          return createdMs(b) - createdMs(a) || cmpName(a, b);
      }
    });
  }, [people, filter, sortMode]);

  function toggle<T extends string>(arr: T[] | undefined, v: T): T[] {
    const set = new Set(arr ?? []);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    return [...set];
  }

  async function toggleStar(id: string) {
    let nextValue = false;
    setPeople((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        nextValue = !p.starred;
        return { ...p, starred: nextValue };
      })
    );
    // Skip router.refresh() — the optimistic update already matches what the
    // server has after PATCH, and re-fetching all friends just causes the
    // list to re-sort visibly. If the PATCH fails we'll roll back here.
    const res = await fetch(`/api/people/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: nextValue }),
    });
    if (!res.ok) {
      setPeople((prev) =>
        prev.map((p) => (p.id === id ? { ...p, starred: !nextValue } : p))
      );
    }
  }

  async function checkIn(id: string) {
    setCheckingIn((s) => new Set(s).add(id));
    // Optimistic.
    const now = new Date().toISOString();
    setPeople((prev) =>
      prev.map((p) => (p.id === id ? { ...p, lastInteractionAt: now } : p))
    );
    await fetch(`/api/people/${id}/checkin`, { method: "POST" });
    setCheckingIn((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    startTransition(() => router.refresh());
  }

  function applyView(v: SavedView) {
    setFilter(v.filter);
  }

  function saveCurrentView() {
    const name = prompt("Name this view:");
    if (!name?.trim()) return;
    const custom = views.filter((v) => !DEFAULT_VIEWS.some((d) => d.name === v.name));
    persistViews([...custom, { name: name.trim(), filter }]);
  }

  function deleteView(name: string) {
    const custom = views
      .filter((v) => !DEFAULT_VIEWS.some((d) => d.name === v.name))
      .filter((v) => v.name !== name);
    persistViews(custom);
  }

  const filterDirty =
    (filter.strength?.length ?? 0) +
      (filter.circle?.length ?? 0) +
      (filter.city?.length ?? 0) +
      (filter.bucket?.length ?? 0) +
      (filter.search ? 1 : 0) >
    0;

  return (
    <div>
      {/* Saved views row */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilter({})}
          className={cn(
            "rounded-full px-3 py-1 text-xs border min-h-[32px]",
            !filterDirty
              ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]"
              : "border-[var(--color-border)] hover:border-[var(--color-foreground)]/30"
          )}
        >
          All · {people.length}
        </button>
        {views.map((v) => (
          <button
            key={v.name}
            onClick={() => applyView(v)}
            className="rounded-full px-3 py-1 text-xs border border-[var(--color-border)] hover:border-[var(--color-foreground)]/30 min-h-[32px]"
          >
            {v.name}
          </button>
        ))}
        {filterDirty ? (
          <button
            onClick={saveCurrentView}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs border border-[var(--color-border)] hover:border-[var(--color-foreground)]/30 min-h-[32px]"
          >
            <Save className="size-3" /> Save view
          </button>
        ) : null}
      </div>

      {/* Filter chips */}
      <div className="mb-4 space-y-2">
        <input
          type="search"
          placeholder="Search by name, company, city…"
          value={filter.search ?? ""}
          onChange={(e) =>
            setFilter((f) => ({ ...f, search: e.target.value || undefined }))
          }
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
        />
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-[var(--color-muted-foreground)]">Strength:</span>
          {allStrengths.map((s) => (
            <FilterChip
              key={s}
              label={s}
              active={!!filter.strength?.includes(s)}
              onClick={() =>
                setFilter((f) => ({ ...f, strength: toggle(f.strength, s) }))
              }
            />
          ))}
        </div>
        {allCircles.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[var(--color-muted-foreground)]">Circle:</span>
            {allCircles.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={!!filter.circle?.includes(c)}
                onClick={() =>
                  setFilter((f) => ({ ...f, circle: toggle(f.circle, c) }))
                }
              />
            ))}
          </div>
        ) : null}
        {allCities.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[var(--color-muted-foreground)]">City:</span>
            {allCities.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={!!filter.city?.includes(c)}
                onClick={() =>
                  setFilter((f) => ({ ...f, city: toggle(f.city, c) }))
                }
              />
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-[var(--color-muted-foreground)]">Last seen:</span>
          {(
            [
              ["recent", "≤30d"],
              ["30d", "30–90d"],
              ["90d", "90d–1y"],
              ["1y", ">1y"],
              ["never", "Never"],
            ] as const
          ).map(([key, label]) => (
            <FilterChip
              key={key}
              label={label}
              active={!!filter.bucket?.includes(key)}
              onClick={() =>
                setFilter((f) => ({ ...f, bucket: toggle(f.bucket, key) }))
              }
            />
          ))}
        </div>
      </div>

      {/* Action row */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-[var(--color-muted-foreground)]">
          {filtered.length} {filtered.length === 1 ? "person" : "people"}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
            <span className="hidden sm:inline">Sort:</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="min-h-[36px] rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm text-[var(--color-foreground)] focus:border-[var(--color-ring)] focus:outline-none"
            >
              <option value="name">Name (A→Z)</option>
              <option value="recent">Last seen (recent)</option>
              <option value="overdue">Last seen (oldest)</option>
              <option value="added">Recently added</option>
            </select>
          </label>
          <button
            onClick={() => setBulkOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium min-h-[36px] hover:bg-[var(--color-accent)]"
          >
            <Sparkles className="size-4" /> Bulk add
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium min-h-[36px]"
          >
            <Plus className="size-4" /> Add person
          </button>
        </div>
      </div>

      {/* List */}
      <ul className="rounded-xl border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
        {filtered.map((p) => (
          <PersonRowItem
            key={p.id}
            person={p}
            checking={checkingIn.has(p.id)}
            onEdit={() => setEditing(p)}
            onCheckIn={() => checkIn(p.id)}
            onToggleStar={() => toggleStar(p.id)}
            onDelete={async () => {
              if (!confirm(`Delete ${p.firstName}?`)) return;
              await fetch(`/api/people/${p.id}`, { method: "DELETE" });
              setPeople((prev) => prev.filter((x) => x.id !== p.id));
              router.refresh();
            }}
          />
        ))}
        {filtered.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-[var(--color-muted-foreground)]">
            No one matches the current filter.
          </li>
        ) : null}
      </ul>

      <PersonEditor
        open={!!editing || addOpen}
        person={editing}
        circleOptions={allCircles}
        strengthOptions={allStrengths.length > 0 ? allStrengths : ["close", "strong", "casual", "weak"]}
        onClose={() => {
          setEditing(null);
          setAddOpen(false);
        }}
      />

      <BulkAddPeople
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        existingNames={
          new Set(
            people.map((p) =>
              `${p.firstName} ${p.lastName ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ")
            )
          )
        }
      />
    </div>
  );
}

function PersonRowItem({
  person,
  checking,
  onEdit,
  onCheckIn,
  onToggleStar,
  onDelete,
}: {
  person: PersonRow;
  checking: boolean;
  onEdit: () => void;
  onCheckIn: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
}) {
  const ctx = useContextMenu();
  const days = daysSince(person.lastInteractionAt);
  const b = bucketFor(days);
  const menu: AnyMenuEntry[] = [
    {
      label: person.starred ? "Remove from inner circle" : "Add to inner circle",
      icon: <Star className="size-3.5" />,
      onSelect: onToggleStar,
    },
    {
      label: "Checked in",
      icon: <Check className="size-3.5" />,
      onSelect: onCheckIn,
    },
    {
      label: "Edit / rename",
      icon: <Pencil className="size-3.5" />,
      onSelect: onEdit,
    },
    { separator: true },
    {
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      onSelect: onDelete,
    },
  ];

  return (
    <li className="bg-[var(--color-card)]" {...ctx.handlers}>
      <div className="flex items-center gap-3 px-3 py-3">
        <button
          onClick={onToggleStar}
          className="grid place-items-center size-9 rounded-md shrink-0 hover:bg-[var(--color-accent)]/60 transition"
          title={person.starred ? "Remove star" : "Star (inner circle)"}
        >
          <Star
            className={cn(
              "size-4 transition",
              person.starred
                ? "fill-amber-400 text-amber-400"
                : "text-[var(--color-muted-foreground)]/40"
            )}
          />
        </button>
        <button
          onClick={onEdit}
          className="grid place-items-center size-10 rounded-full bg-[var(--color-accent)]/60 shrink-0 text-xs font-semibold"
        >
          {person.imageUrl ? (
            <Image
              src={person.imageUrl}
              alt=""
              width={40}
              height={40}
              className="size-10 rounded-full object-cover"
            />
          ) : (
            initials(person)
          )}
        </button>
        <button onClick={onEdit} className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium truncate">
            {person.firstName} {person.lastName ?? ""}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className={cn("text-xs", bucketColor(b))}>
              {bucketLabel(days)}
            </span>
            {person.lastInteractionTitle ? (
              <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                · {person.lastInteractionTitle}
              </span>
            ) : null}
            {person.strength ? (
              <span className="text-[10px] uppercase tracking-wider rounded bg-[var(--color-accent)]/60 px-1.5 py-0.5">
                {person.strength}
              </span>
            ) : null}
            {person.city || person.country ? (
              <span className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                {[person.city, person.country].filter(Boolean).join(", ")}
              </span>
            ) : null}
          </div>
        </button>
        <button
          onClick={onCheckIn}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] hover:border-emerald-500/40 hover:text-emerald-500 px-3 py-1.5 text-xs font-medium min-h-[40px] shrink-0 transition disabled:opacity-50"
        >
          {checking ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          <span className="hidden sm:inline">Checked in</span>
          <span className="sm:hidden">✓</span>
        </button>
      </div>
      <ContextMenuPopover pos={ctx.pos} items={menu} onClose={ctx.close} />
    </li>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs border min-h-[28px]",
        active
          ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]"
          : "border-[var(--color-border)] hover:border-[var(--color-foreground)]/30"
      )}
    >
      {label}
    </button>
  );
}

function PersonEditor({
  open,
  person,
  circleOptions,
  strengthOptions,
  onClose,
}: {
  open: boolean;
  person: PersonRow | null;
  circleOptions: string[];
  strengthOptions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [circles, setCircles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (person) {
      setDraft({
        firstName: person.firstName,
        lastName: person.lastName ?? "",
        strength: person.strength ?? "",
        email: person.email ?? "",
        phone: person.phone ?? "",
        company: person.company ?? "",
        role: person.role ?? "",
        city: person.city ?? "",
        country: person.country ?? "",
        howWeMet: person.howWeMet ?? "",
        interests: (person.interests ?? []).join(", "),
        linkedin: person.socialUrls?.linkedin ?? "",
        twitter: person.socialUrls?.twitter ?? "",
        instagram: person.socialUrls?.instagram ?? "",
        website: person.socialUrls?.website ?? "",
        birthday: person.birthday ? person.birthday.slice(0, 10) : "",
        notes: person.notes ?? "",
      });
      setCircles(person.circles);
    } else {
      setDraft({});
      setCircles([]);
    }
  }, [open, person]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    const firstName = draft.firstName?.trim();
    if (!firstName) return;
    setSaving(true);
    const interests = (draft.interests || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const socialUrls = {
      linkedin: draft.linkedin || null,
      twitter: draft.twitter || null,
      instagram: draft.instagram || null,
      website: draft.website || null,
    };
    const anySocial =
      socialUrls.linkedin ||
      socialUrls.twitter ||
      socialUrls.instagram ||
      socialUrls.website;
    const payload = {
      firstName,
      lastName: draft.lastName || null,
      strength: draft.strength || null,
      circles,
      email: draft.email || null,
      phone: draft.phone || null,
      company: draft.company || null,
      role: draft.role || null,
      city: draft.city || null,
      country: draft.country || null,
      howWeMet: draft.howWeMet || null,
      interests,
      socialUrls: anySocial ? socialUrls : null,
      birthday: draft.birthday || null,
      notes: draft.notes || null,
    };
    setError(null);
    try {
      const res = person
        ? await fetch(`/api/people/${person.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/people", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Save failed (HTTP ${res.status}).`);
        setSaving(false);
        return;
      }
      haptic("success");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!person) return;
    // Inline two-tap confirm — iOS PWAs suppress window.confirm().
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      haptic("tick");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Delete failed (HTTP ${res.status}).`);
        setDeleting(false);
        setConfirmingDelete(false);
        return;
      }
      haptic("success");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  function toggleCircle(c: string) {
    setCircles((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/60 p-0 pb-[calc(56px+env(safe-area-inset-bottom))] sm:p-4 sm:pb-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl border-t sm:border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl max-h-[80vh] sm:max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-card)]">
          <div className="text-sm font-semibold">
            {person ? `${person.firstName} ${person.lastName ?? ""}` : "New person"}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-[var(--color-accent)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 p-5">
          <Field label="First name" required>
            <Input
              value={draft.firstName ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, firstName: v }))}
            />
          </Field>
          <Field label="Last name">
            <Input
              value={draft.lastName ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, lastName: v }))}
            />
          </Field>
          <Field label="Strength">
            <select
              value={draft.strength ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, strength: e.target.value }))
              }
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm min-h-[40px]"
            >
              <option value="">—</option>
              {strengthOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="City">
            <Input
              value={draft.city ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, city: v }))}
            />
          </Field>
          <Field label="Country">
            <Input
              value={draft.country ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, country: v }))}
            />
          </Field>
          <Field label="How we met" full>
            <Input
              value={draft.howWeMet ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, howWeMet: v }))}
            />
          </Field>
          <Field label="Interests (comma-separated)" full>
            <Input
              value={draft.interests ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, interests: v }))}
            />
          </Field>
          <Field label="LinkedIn">
            <Input
              value={draft.linkedin ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, linkedin: v }))}
            />
          </Field>
          <Field label="Twitter / X">
            <Input
              value={draft.twitter ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, twitter: v }))}
            />
          </Field>
          <Field label="Instagram">
            <Input
              value={draft.instagram ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, instagram: v }))}
            />
          </Field>
          <Field label="Website">
            <Input
              value={draft.website ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, website: v }))}
            />
          </Field>
          <Field label="Email">
            <Input
              value={draft.email ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, email: v }))}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={draft.phone ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, phone: v }))}
            />
          </Field>
          <Field label="Company">
            <Input
              value={draft.company ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, company: v }))}
            />
          </Field>
          <Field label="Role">
            <Input
              value={draft.role ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, role: v }))}
            />
          </Field>
          <Field label="Birthday">
            <Input
              type="date"
              value={draft.birthday ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, birthday: v }))}
            />
          </Field>
          <Field label="Circles" full>
            <div className="flex items-center gap-1.5 flex-wrap">
              {circleOptions.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCircle(c)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs border min-h-[28px]",
                    circles.includes(c)
                      ? "bg-[var(--color-foreground)] text-[var(--color-background)] border-[var(--color-foreground)]"
                      : "border-[var(--color-border)]"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notes" full>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              rows={4}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none"
            />
          </Field>
        </div>

        {person ? <PersonInteractionsList personId={person.id} /> : null}

        {error ? (
          <div className="border-t border-rose-500/30 bg-rose-500/10 px-5 py-2 text-sm text-rose-500">
            {error}
          </div>
        ) : null}

        <div className="sticky bottom-0 flex items-center justify-between gap-2 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-card)]">
          {person ? (
            <button
              onClick={remove}
              disabled={deleting || saving}
              className={
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 " +
                (confirmingDelete
                  ? "bg-rose-500 text-white hover:bg-rose-600"
                  : "text-rose-500 hover:bg-rose-500/10")
              }
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {confirmingDelete ? "Tap to confirm" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-accent)]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !draft.firstName?.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {person ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label className="block text-xs font-medium text-[var(--color-muted-foreground)] mb-1">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  type,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-2 text-sm focus:border-[var(--color-ring)] focus:outline-none min-h-[40px]"
    />
  );
}

type InteractionRow = {
  id: string;
  occurredAt: string;
  kind: string;
  title: string;
  location: string | null;
  notes: string | null;
  source: string;
};

function PersonInteractionsList({ personId }: { personId: string }) {
  const [rows, setRows] = useState<InteractionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    fetch(`/api/people/${personId}/interactions`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { interactions: InteractionRow[] };
        if (!cancelled) setRows(body.interactions);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  return (
    <div className="border-t border-[var(--color-border)] px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Interactions
        </div>
        <div className="text-xs text-[var(--color-muted-foreground)]">
          {rows ? `${rows.length} total` : ""}
        </div>
      </div>
      {error ? (
        <div className="text-sm text-rose-500">Couldn&apos;t load: {error}</div>
      ) : rows === null ? (
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="size-3.5 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-[var(--color-muted-foreground)]">
          No interactions yet. Use Check in or the ⌘K capture (&ldquo;had dinner
          with X at Y&rdquo;) to log one.
        </div>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  {r.location ? (
                    <div className="mt-0.5 truncate text-xs text-[var(--color-muted-foreground)]">
                      {r.location}
                    </div>
                  ) : null}
                  {r.notes ? (
                    <div className="mt-1 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">
                      {r.notes}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-xs text-[var(--color-muted-foreground)]">
                  <div>
                    {new Date(r.occurredAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year:
                        new Date(r.occurredAt).getFullYear() !==
                        new Date().getFullYear()
                          ? "numeric"
                          : undefined,
                    })}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-70">
                    {r.kind}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
