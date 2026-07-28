"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Folder,
  Home,
  Inbox as InboxIcon,
  Loader2,
  Menu,
  Plus,
  Search,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { AddTemplateButton, useEnabledTemplates } from "./sidebar-template-picker";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { palette, LIST_PALETTE, type ListColor } from "@/lib/lists";
import { partitionProjects } from "@/lib/project-groups";
import { ThemeToggle } from "./theme-toggle";
import { MobileFab } from "./mobile-fab";

type ChromeState = {
  title: string;
  right: ReactNode | null;
};

type ChromeApi = {
  state: ChromeState;
  setTitle: (t: string) => void;
  setRight: (r: ReactNode | null) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  drawerOpen: boolean;
};

const Ctx = createContext<ChromeApi | null>(null);

export type MobileProject = { id: string; name: string; count: number };
export type MobileList = { id: string; name: string; color: string };

export function MobileChromeProvider({
  children,
  projects,
  lists = [],
  appName = "EC",
  isPrivate = false,
}: {
  children: ReactNode;
  projects: MobileProject[];
  lists?: MobileList[];
  appName?: string;
  isPrivate?: boolean;
}) {
  const [title, setTitle] = useState(appName);
  const [right, setRight] = useState<ReactNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const api: ChromeApi = useMemo(
    () => ({
      state: { title, right },
      setTitle,
      setRight,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
      drawerOpen,
    }),
    [title, right, drawerOpen]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <MobileTopBar />
      <MobileDrawer projects={projects} lists={lists} appName={appName} isPrivate={isPrivate} />
      <MobileFab />
    </Ctx.Provider>
  );
}

export function useMobileChrome(): ChromeApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMobileChrome must be used inside provider");
  return ctx;
}

// Used by page bodies to declaratively set the mobile top-bar title + right action.
export function PageHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode | null;
}) {
  const chrome = useContext(Ctx);
  const set = chrome ? { setTitle: chrome.setTitle, setRight: chrome.setRight } : null;
  // useCallback so the next effect doesn't fire every render when `right` is a JSX
  const stableTitle = title;
  const stableRight = right;
  const apply = useCallback(() => {
    if (!set) return;
    set.setTitle(stableTitle);
    set.setRight(stableRight ?? null);
  }, [set, stableTitle, stableRight]);
  useEffect(() => {
    apply();
  }, [apply]);
  return null;
}

function MobileTopBar() {
  const { state, openDrawer } = useMobileChrome();
  return (
    <header
      className="md:hidden print:hidden fixed top-0 inset-x-0 z-30 bg-[var(--color-background)]/95 backdrop-blur border-b border-[var(--color-border)] pt-[env(safe-area-inset-top)]"
      style={{
        transform: "translate3d(0,0,0)",
        WebkitTransform: "translate3d(0,0,0)",
        willChange: "transform",
      }}
    >
      <div className="h-12 px-3 flex items-center gap-2">
        <button
          onClick={openDrawer}
          aria-label="Open menu"
          className="pressable grid place-items-center size-9 rounded-md hover:bg-[var(--color-accent)] text-[var(--color-foreground)]"
        >
          <Menu className="size-5" strokeWidth={1.75} />
        </button>
        {/* Universal search — opens the shared command palette (content + nav + capture). */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
          aria-label="Search"
          className="pressable flex-1 min-w-0 flex items-center gap-2 h-9 px-3 rounded-full bg-[var(--color-accent)]/60 text-[var(--color-muted-foreground)] text-sm"
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate">Search</span>
        </button>
        <div className="flex items-center gap-1 justify-end">
          {state.right}
          <ThemeToggle compact />
        </div>
      </div>
    </header>
  );
}

// The drawer is the sole mobile nav (no bottom tab bar). Kept deliberately
// minimal: the lists/trackers/projects below are the point; Home, Calendar,
// and Settings ride along at the bottom so they stay reachable on phones.
const DRAWER_PRIMARY = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
];

function MobileDrawer({ projects, lists, appName, isPrivate }: { projects: MobileProject[]; lists: MobileList[]; appName: string; isPrivate: boolean }) {
  const { enabled, available, add } = useEnabledTemplates(isPrivate);
  const { drawerOpen, closeDrawer } = useMobileChrome();
  const pathname = usePathname();
  const router = useRouter();
  // Same grouping as the desktop sidebar: Trackers get their own labeled
  // section, Inbox pins to the top of Projects, empty projects collapse.
  const trackers = enabled.filter((t) => t.slug !== "print-lists");
  const printLists = enabled.find((t) => t.slug === "print-lists") ?? null;
  const activeProjectId = pathname.startsWith("/projects/")
    ? pathname.slice("/projects/".length)
    : null;
  const [dormantOpen, setDormantOpen] = useState(false);
  const {
    inbox: inboxProject,
    active: activeProjects,
    dormant: dormantProjects,
  } = partitionProjects(
    projects,
    (p) => p.count,
    activeProjectId ? new Set([activeProjectId]) : undefined
  );
  // Close on route change.
  useEffect(() => {
    closeDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  // Lock body scroll while open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);
  return (
    <>
      <div
        onClick={closeDrawer}
        aria-hidden
        className={cn(
          "md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity duration-250",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        className={cn(
          "md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 max-w-[85vw] bg-[var(--color-background)] border-r border-[var(--color-border)] transition-transform duration-300 ease-spring pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] overflow-y-auto",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            {appName}
          </div>
          <button
            onClick={closeDrawer}
            aria-label="Close menu"
            className="grid place-items-center size-9 rounded-md hover:bg-[var(--color-accent)]"
          >
            <X className="size-5" />
          </button>
        </div>
        {/* Lists lead the drawer — this is the primary navigation; pages are
            the footnote below. */}
        <div className="px-2 space-y-0.5">
          {lists.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                closeDrawer();
                sessionStorage.setItem("personalos:goto-list", l.id);
                if (pathname === "/") {
                  window.dispatchEvent(new Event("personalos:goto-list"));
                } else {
                  router.push("/");
                }
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-accent)] active:bg-[var(--color-accent)]"
            >
              <span
                aria-hidden
                className={cn("size-2.5 rounded-full", palette(l.color).dot)}
              />
              <span className="flex-1 truncate text-left">{l.name}</span>
            </button>
          ))}
          <DrawerNewList />
        </div>
        {trackers.length > 0 || available.length > 0 ? (
          <div className="mt-4 px-2">
            <div className="px-3 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Trackers
            </div>
            <div className="space-y-0.5">
              {trackers.map((t) => (
                <DrawerLink
                  key={t.slug}
                  href={t.href}
                  active={pathname.startsWith(t.href)}
                  icon={<t.Icon className="size-4" />}
                  label={t.label}
                />
              ))}
              <AddTemplateButton available={available} onAdd={add} variant="drawer" />
            </div>
          </div>
        ) : null}
        {projects.length > 0 ? (
          <div className="mt-4 px-2">
            <div className="px-3 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Projects
            </div>
            <div className="space-y-0.5">
              {inboxProject ? (
                <DrawerProjectLink
                  project={inboxProject}
                  active={pathname === `/projects/${inboxProject.id}`}
                  inbox
                />
              ) : null}
              {activeProjects.map((p) => (
                <DrawerProjectLink
                  key={p.id}
                  project={p}
                  active={pathname === `/projects/${p.id}`}
                />
              ))}
              {dormantProjects.length > 0 ? (
                <>
                  <button
                    onClick={() => setDormantOpen((v) => !v)}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] active:bg-[var(--color-accent)] rounded-md"
                  >
                    {dormantOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    <span className="tabular-nums">{dormantProjects.length} more</span>
                  </button>
                  {dormantOpen
                    ? dormantProjects.map((p) => (
                        <DrawerProjectLink
                          key={p.id}
                          project={p}
                          active={pathname === `/projects/${p.id}`}
                        />
                      ))
                    : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        <nav className="mt-4 px-2 pt-3 space-y-0.5 border-t border-[var(--color-border)]">
          {DRAWER_PRIMARY.map((d) => (
            <DrawerLink
              key={d.href}
              href={d.href}
              active={d.href === "/" ? pathname === "/" : pathname.startsWith(d.href)}
              icon={<d.Icon className="size-4" />}
              label={d.label}
            />
          ))}
          {printLists ? (
            <DrawerLink
              href={printLists.href}
              active={pathname === printLists.href}
              icon={<printLists.Icon className="size-4" />}
              label={printLists.label}
            />
          ) : null}
          <DrawerLink
            href="/settings"
            active={pathname.startsWith("/settings")}
            icon={<SettingsIcon className="size-4" />}
            label="Settings"
          />
        </nav>
      </aside>
    </>
  );
}

function DrawerLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors active:bg-[var(--color-accent)]",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

function DrawerProjectLink({
  project,
  active,
  inbox,
}: {
  project: MobileProject;
  active: boolean;
  inbox?: boolean;
}) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm active:bg-[var(--color-accent)]",
        active
          ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
      )}
    >
      {inbox ? <InboxIcon className="size-4" /> : <Folder className="size-4" />}
      <span className="flex-1 truncate">{project.name}</span>
      {project.count > 0 ? (
        <span className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
          {project.count}
        </span>
      ) : null}
    </Link>
  );
}

// Inline "New list" row at the bottom of the drawer's lists section. Expands
// into a name + color form in place; posts to the same /api/lists endpoint as
// the desktop NewListButton and fires the same list-created event so home
// tiles pick it up. The drawer itself re-renders via router.refresh().
const NEW_LIST_COLORS = Object.keys(LIST_PALETTE) as ListColor[];

function DrawerNewList() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ListColor>("emerald");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, color }),
      });
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as
        | { list: { id: string; name: string; color: string; isDefault: boolean } }
        | null;
      if (body?.list) {
        window.dispatchEvent(
          new CustomEvent("personalos:list-created", { detail: { list: body.list } }),
        );
      }
      setName("");
      setColor("emerald");
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] active:bg-[var(--color-accent)]"
      >
        <Plus className="size-4" />
        <span className="flex-1 text-left">New list</span>
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-md bg-[var(--color-accent)]/40 px-3 py-2.5 space-y-2.5">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="List name"
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1.5 text-sm focus:border-[var(--color-ring)] focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        {NEW_LIST_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={c}
            className={cn(
              "size-5 rounded-full transition",
              LIST_PALETTE[c].dot,
              color === c
                ? "ring-2 ring-offset-2 ring-offset-[var(--color-background)] ring-[var(--color-foreground)]"
                : "opacity-70"
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!name.trim() || submitting}
          className="flex-1 rounded-md bg-[var(--color-foreground)] text-[var(--color-background)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Loader2 className="size-3 animate-spin" /> Creating…
            </span>
          ) : (
            "Create"
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// Used by /personal so the bottom-tab can route to /health (alias to the Health project).
export function HealthTabResolver() {
  return null;
}
