"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, FolderKanban, LayoutGrid, FlaskConical, Home, Inbox as InboxIcon, PanelLeftClose, PanelLeftOpen, Phone, Settings, WandSparkles } from "lucide-react";
import { AddTemplateButton, useEnabledTemplates } from "./sidebar-template-picker";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TemplateSlug } from "@/lib/templates";
import { moveSlug, orderedTemplates } from "@/lib/tracker-order";
import { OPEN_IMPROVE_EVENT } from "@/lib/improvements/request";
import { ThemeToggle } from "./theme-toggle";

export function Sidebar({
  appName = "EC",
  isPrivate = false,
  canImprove = false,
}: {
  appName?: string;
  isPrivate?: boolean;
  /** Founder only: shows "Improve", which opens the Improve dialog. */
  canImprove?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(
        localStorage.getItem("personalos:sidebar-collapsed") === "1"
      );
    } catch {}
  }, []);

  function setCollapsedPersisted(next: boolean) {
    setCollapsed(next);
    try {
      localStorage.setItem("personalos:sidebar-collapsed", next ? "1" : "0");
    } catch {}
  }

  // Trackers (template pages) are lifted here so the footer can pull
  // Print lists out of the content group and park it next to Settings.
  const {
    enabled: enabledTemplates,
    available: availableTemplates,
    add: addTemplate,
    reorder: reorderTemplates,
  } = useEnabledTemplates(isPrivate);
  const enabledTrackers = enabledTemplates.filter((t) => t.slug !== "print-lists");
  const printLists = enabledTemplates.find((t) => t.slug === "print-lists") ?? null;
  // Drag-reorder trackers: rows shuffle live during the drag (local
  // order), and the drop persists it via the hook.
  const [trackerDrag, setTrackerDrag] = useState<{ slug: TemplateSlug; order: TemplateSlug[] } | null>(null);
  const trackers = trackerDrag ? orderedTemplates(trackerDrag.order, enabledTrackers) : enabledTrackers;

  function moveTrackerTo(toSlug: TemplateSlug) {
    setTrackerDrag((prev) => {
      if (!prev || prev.slug === toSlug) return prev;
      const toIdx = prev.order.indexOf(toSlug);
      if (toIdx < 0) return prev;
      const order = moveSlug(prev.order, prev.slug, toIdx);
      return order === prev.order ? prev : { ...prev, order };
    });
  }

  function persistTrackerOrder() {
    if (trackerDrag) reorderTemplates(trackerDrag.order);
    setTrackerDrag(null);
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsedPersisted(false)}
        title="Expand sidebar"
        aria-label="Expand sidebar"
        className="fixed top-3 left-3 z-30 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-sm hover:bg-[var(--color-accent)]"
      >
        <PanelLeftOpen className="size-4 text-[var(--color-muted-foreground)]" />
      </button>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-muted)]/40 flex flex-col min-h-screen">
      <div className="px-4 py-5 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {appName}
        </div>
        <button
          onClick={() => setCollapsedPersisted(true)}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <nav className="px-2 space-y-0.5">
        <SidebarLink
          href="/"
          icon={<Home className="size-4" />}
          label="Home"
          active={pathname === "/"}
        />
        <SidebarLink
          href="/calendar"
          icon={<Calendar className="size-4" />}
          label="Calendar"
          active={pathname === "/calendar"}
        />
        <SidebarLink
          href="/projects"
          icon={<FolderKanban className="size-4" />}
          label="Projects"
          active={pathname === "/projects"}
        />
        <SidebarLink
          href="/board"
          icon={<LayoutGrid className="size-4" />}
          label="Board"
          active={pathname === "/board" || pathname.startsWith("/board/")}
        />
        <SidebarLink
          href="/call-sheet"
          icon={<Phone className="size-4" />}
          label="Call Sheet"
          active={pathname === "/call-sheet" || pathname.startsWith("/call-sheet/")}
        />
        <SidebarLink
          href="/research"
          icon={<FlaskConical className="size-4" />}
          label="Research"
          active={pathname === "/research" || pathname.startsWith("/research/")}
        />
        <SidebarLink
          href="/captures"
          icon={<InboxIcon className="size-4" />}
          label="Captures"
          active={pathname === "/captures"}
        />
      </nav>

      <div className="px-2 mt-4">
        <div className="px-2 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          Trackers
        </div>
        <nav className="space-y-0.5">
          {trackers.map((t) => (
            <div
              key={t.slug}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(TRACKER_MIME, t.slug);
                setTrackerDrag({ slug: t.slug, order: enabledTrackers.map((x) => x.slug) });
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TRACKER_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                moveTrackerTo(t.slug);
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes(TRACKER_MIME)) return;
                e.preventDefault();
                persistTrackerOrder();
              }}
              // Dropped outside a row (or cancelled): snap back.
              onDragEnd={() => setTrackerDrag(null)}
              className={cn("rounded-md transition", trackerDrag?.slug === t.slug && "opacity-40")}
            >
              <SidebarLink
                href={t.href}
                icon={<t.Icon className="size-4" />}
                label={t.label}
                active={pathname.startsWith(t.href)}
                draggable={false}
              />
            </div>
          ))}
          <AddTemplateButton available={availableTemplates} onAdd={addTemplate} />
        </nav>
      </div>

      <div className="mt-auto border-t border-[var(--color-border)]">
        <BuildInfo />
        <div className="px-2 py-2 border-t border-[var(--color-border)] space-y-0.5">
          {printLists ? (
            <SidebarLink
              href={printLists.href}
              icon={<printLists.Icon className="size-4" />}
              label={printLists.label}
              active={pathname === printLists.href}
            />
          ) : null}
          {canImprove ? (
            <SidebarButton
              icon={<WandSparkles className="size-4" />}
              label="Improve"
              title="Ask for a change to this app"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_IMPROVE_EVENT))}
            />
          ) : null}
          <SidebarLink
            href="/settings"
            icon={<Settings className="size-4" />}
            label="Settings"
            active={pathname === "/settings"}
          />
        </div>
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Theme
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

function BuildInfo() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const [relative, setRelative] = useState<string>("");
  const absolute = buildTime ? new Date(buildTime) : null;

  useEffect(() => {
    if (!absolute) return;
    const tick = () => setRelative(formatRelative(absolute));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [absolute]);

  return (
    <div
      className="px-4 py-2 text-[10px] uppercase tracking-wider text-[var(--color-muted-foreground)] flex items-center justify-between gap-2"
      title={absolute ? absolute.toLocaleString() : undefined}
    >
      <span>v{version}</span>
      {relative ? <span className="normal-case tracking-normal">Updated {relative}</span> : null}
    </div>
  );
}

function formatRelative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TRACKER_MIME = "application/x-personalos-tracker";

function SidebarLink({
  href,
  icon,
  label,
  count,
  active,
  draggable,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  draggable?: boolean;
}) {
  return (
    <Link
      href={href}
      draggable={draggable}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
      )}
    >
      <span className="text-[var(--color-muted-foreground)]">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
          {count}
        </span>
      ) : null}
    </Link>
  );
}

// SidebarLink's look for actions that open something instead of navigating.
function SidebarButton({
  icon,
  label,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-muted-foreground)] transition hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
    >
      <span className="text-[var(--color-muted-foreground)]">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
