"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";
const KEY = "personalos:theme";

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY) as Theme | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        setTheme(stored);
        applyTheme(stored);
      }
    } catch {}
  }, []);

  function set(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  }

  if (compact) {
    const order: Theme[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
    return (
      <button
        onClick={() => set(next)}
        title={`Theme: ${theme} (tap for ${next})`}
        className="grid place-items-center size-9 rounded-md text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] transition"
      >
        <Icon className="size-4" />
      </button>
    );
  }

  return (
    <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5 bg-[var(--color-card)]">
      {([
        ["system", Monitor],
        ["light", Sun],
        ["dark", Moon],
      ] as Array<[Theme, typeof Monitor]>).map(([t, Icon]) => (
        <button
          key={t}
          onClick={() => set(t)}
          className={cn(
            "grid place-items-center size-7 rounded-md transition",
            theme === t
              ? "bg-[var(--color-accent)] text-[var(--color-foreground)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
          aria-label={`${t} theme`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

// Inline early-eval script that sets data-theme BEFORE first paint so users
// don't see a flash of the wrong theme. Drop into <head> via a Server Component.
export const themePreloadScript = `
(function(){
  try {
    var t = localStorage.getItem('${KEY}');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
`;
