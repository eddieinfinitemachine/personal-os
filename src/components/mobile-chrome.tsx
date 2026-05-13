"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Calendar,
  Car,
  Folder,
  Heart,
  Home,
  Lightbulb,
  MapPin,
  Menu,
  Package,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";
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

export function MobileChromeProvider({
  children,
  projects,
}: {
  children: ReactNode;
  projects: MobileProject[];
}) {
  const [title, setTitle] = useState("Personal OS");
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
      <MobileDrawer projects={projects} />
      <MobileFab />
      <MobileTabBar />
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
    <header className="md:hidden fixed top-0 inset-x-0 z-30 bg-[var(--color-background)]/95 backdrop-blur border-b border-[var(--color-border)] pt-[env(safe-area-inset-top)]">
      <div className="h-12 px-3 flex items-center gap-2">
        <button
          onClick={openDrawer}
          aria-label="Open menu"
          className="grid place-items-center size-9 rounded-md hover:bg-[var(--color-accent)] text-[var(--color-foreground)]"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex-1" />
        {/* Title intentionally hidden — the page chrome speaks for itself. */}
        <div className="flex items-center gap-1 justify-end">
          {state.right}
          <ThemeToggle compact />
        </div>
      </div>
    </header>
  );
}

const TAB_DESTINATIONS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
  { href: "/friends", label: "Friends", Icon: Users },
  { href: "/personal", label: "Personal", Icon: User },
];

function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-[var(--color-background)]/95 backdrop-blur border-t border-[var(--color-border)] pb-[env(safe-area-inset-bottom)]">
      <ul className="h-14 grid grid-cols-4">
        {TAB_DESTINATIONS.map((t) => {
          const active =
            t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={cn(
                  "h-full flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide",
                  active
                    ? "text-[var(--color-foreground)]"
                    : "text-[var(--color-muted-foreground)]"
                )}
              >
                <t.Icon className="size-5" />
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const DRAWER_PRIMARY = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/calendar", label: "Calendar", Icon: Calendar },
  { href: "/personal", label: "Personal", Icon: User },
  { href: "/friends", label: "Friends", Icon: Users },
  { href: "/vehicles", label: "Vehicles", Icon: Car },
  { href: "/investments", label: "Investments", Icon: TrendingUp },
  { href: "/inventory", label: "Inventory", Icon: Package },
  { href: "/media", label: "Media", Icon: BookOpen },
  { href: "/places", label: "Places", Icon: MapPin },
  { href: "/best-practices", label: "Best practices", Icon: Lightbulb },
];

function MobileDrawer({ projects }: { projects: MobileProject[] }) {
  const { drawerOpen, closeDrawer } = useMobileChrome();
  const pathname = usePathname();
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
          "md:hidden fixed inset-0 z-40 bg-black/60 transition-opacity",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        className={cn(
          "md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 max-w-[85vw] bg-[var(--color-background)] border-r border-[var(--color-border)] transition-transform duration-200 ease-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] overflow-y-auto",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
            Personal OS
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
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
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
        </nav>
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
