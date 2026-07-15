"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  Folder,
  Home,
  Menu,
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
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { palette } from "@/lib/lists";
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

export type MobileProject = { id: string; name: string };
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
// minimal: the lists/projects below are the point; Settings rides along so
// it stays reachable on phones.
const DRAWER_PRIMARY = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

function MobileDrawer({ projects, lists, appName, isPrivate }: { projects: MobileProject[]; lists: MobileList[]; appName: string; isPrivate: boolean }) {
  const { enabled, available, add } = useEnabledTemplates(isPrivate);
  const { drawerOpen, closeDrawer } = useMobileChrome();
  const pathname = usePathname();
  const router = useRouter();
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
        <nav className="px-2 space-y-0.5">
          {DRAWER_PRIMARY.map((d) => {
            const active = d.href === "/" ? pathname === "/" : pathname.startsWith(d.href);
            return (
              <Link
                key={d.href}
                href={d.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors active:bg-[var(--color-accent)]",
                  active
                    ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
                    : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                )}
              >
                <d.Icon className="size-4" />
                <span className="flex-1 truncate">{d.label}</span>
              </Link>
            );
          })}
          {enabled.map((t) => {
            const active = t.href === "/print/today" ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link
                key={t.slug}
                href={t.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors active:bg-[var(--color-accent)]",
                  active
                    ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
                    : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                )}
              >
                <t.Icon className="size-4" />
                <span className="flex-1 truncate">{t.label}</span>
              </Link>
            );
          })}
          <AddTemplateButton available={available} onAdd={add} variant="drawer" />
        </nav>
        {lists.length > 0 ? (
          <div className="mt-4 px-2">
            <div className="px-3 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Lists
            </div>
            <div className="space-y-0.5">
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
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] active:bg-[var(--color-accent)]"
                >
                  <span
                    aria-hidden
                    className={cn("size-2.5 rounded-full", palette(l.color).dot)}
                  />
                  <span className="flex-1 truncate text-left">{l.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {projects.length > 0 ? (
          <div className="mt-4 px-2">
            <div className="px-3 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
              Projects
            </div>
            <div className="space-y-0.5">
              {projects.map((p) => {
                const active = pathname === `/projects/${p.id}`;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                      active
                        ? "bg-[var(--color-accent)] text-[var(--color-foreground)] font-medium"
                        : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                    )}
                  >
                    <Folder className="size-4" />
                    <span className="flex-1 truncate">{p.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

// Used by /personal so the bottom-tab can route to /health (alias to the Health project).
export function HealthTabResolver() {
  return null;
}
