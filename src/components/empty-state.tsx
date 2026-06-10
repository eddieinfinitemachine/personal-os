import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// HIG-style empty state: quiet icon in a fill circle, short headline,
// optional one-line hint. Drop into any empty list/page body.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-fade-in-up flex flex-col items-center justify-center gap-2 py-10 text-center",
        className
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-[var(--color-fill)]">
        <Icon
          className="size-6 text-[var(--color-label-tertiary)]"
          strokeWidth={1.75}
        />
      </div>
      <div className="text-headline font-semibold">{title}</div>
      {hint ? (
        <div className="text-subhead text-[var(--color-label-tertiary)]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
