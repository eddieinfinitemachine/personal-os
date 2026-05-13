"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckSquare, FileText, LayoutDashboard, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

const ALL_TABS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "tasks", label: "Tasks", icon: CheckSquare },
  { key: "notes", label: "Notes", icon: FileText },
  { key: "files", label: "Files", icon: Paperclip },
] as const;

export type ProjectTab = (typeof ALL_TABS)[number]["key"];

export function ProjectTabs({
  active,
  hasDashboard,
}: {
  active: ProjectTab;
  hasDashboard: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const tabs = hasDashboard ? ALL_TABS : ALL_TABS.filter((t) => t.key !== "dashboard");
  const defaultTab: ProjectTab = hasDashboard ? "dashboard" : "tasks";

  function hrefFor(tab: ProjectTab) {
    const next = new URLSearchParams(params);
    if (tab === defaultTab) next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="border-b border-[var(--color-border)] mb-6 flex items-center gap-1">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            scroll={false}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm transition border-b-2 -mb-px",
              isActive
                ? "border-[var(--color-foreground)] text-[var(--color-foreground)] font-medium"
                : "border-transparent text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            )}
          >
            <Icon className="size-3.5" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
