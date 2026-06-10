"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void | Promise<void>;
  destructive?: boolean;
  // If submenu provided, hovering / tapping reveals it (used for "Move to →").
  submenu?: MenuItem[];
  disabled?: boolean;
  separator?: false;
};
export type MenuSeparator = { separator: true };

export type AnyMenuEntry = MenuItem | MenuSeparator;

type Pos = { x: number; y: number };

export function useContextMenu() {
  const [pos, setPos] = useState<Pos | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<Pos | null>(null);

  function open(e: { clientX: number; clientY: number }) {
    setPos({ x: e.clientX, y: e.clientY });
  }
  function close() {
    setPos(null);
  }

  // Native contextmenu (right-click on desktop, sometimes long-press on touch).
  function onContextMenu(e: React.MouseEvent | React.TouchEvent) {
    if ("preventDefault" in e) e.preventDefault();
    const native = "clientX" in e ? e : null;
    if (native) {
      open({ clientX: (e as React.MouseEvent).clientX, clientY: (e as React.MouseEvent).clientY });
    }
  }

  // Long-press fallback for iOS Safari where the native contextmenu event
  // is unreliable (often consumed by selection callouts).
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    longPressStart.current = { x: t.clientX, y: t.clientY };
    longPressTimer.current = setTimeout(() => {
      open({ clientX: t.clientX, clientY: t.clientY });
      // suppress upcoming click
      longPressStart.current = null;
    }, 450);
  }
  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t || !longPressStart.current) return;
    const dx = t.clientX - longPressStart.current.x;
    const dy = t.clientY - longPressStart.current.y;
    if (Math.hypot(dx, dy) > 10) cancelLongPress();
  }
  function onTouchEnd() {
    cancelLongPress();
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressStart.current = null;
  }

  useEffect(() => () => cancelLongPress(), []);

  return {
    pos,
    open: () => open({ clientX: 200, clientY: 200 }),
    close,
    isOpen: pos != null,
    handlers: {
      onContextMenu,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: cancelLongPress,
    },
  };
}

export function ContextMenuPopover({
  pos,
  items,
  onClose,
}: {
  pos: Pos | null;
  items: AnyMenuEntry[];
  onClose: () => void;
}) {
  const [submenu, setSubmenu] = useState<MenuItem | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) {
      setSubmenu(null);
      return;
    }
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function clickAway(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", handler);
    document.addEventListener("mousedown", clickAway);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("mousedown", clickAway);
    };
  }, [pos, onClose]);

  if (!pos) return null;

  // Position-aware: shift the menu so it stays in the viewport.
  const menuW = 220;
  const menuH = items.length * 36 + 16;
  const left = Math.min(pos.x, window.innerWidth - menuW - 8);
  const top = Math.min(pos.y, window.innerHeight - menuH - 8);

  return (
    <div
      ref={ref}
      style={{ left, top }}
      className="animate-scale-in origin-top-left fixed z-[60] min-w-[200px] rounded-xl border border-[var(--color-card-border)] bg-[var(--color-elevated)] shadow-popover py-1"
    >
      {items.map((item, i) => {
        if ("separator" in item) {
          return (
            <div
              key={`sep-${i}`}
              className="my-1 h-px bg-[var(--color-separator)]"
            />
          );
        }
        const m = item as MenuItem;
        const isSub = !!m.submenu?.length;
        const isActive = submenu?.label === m.label;
        return (
          <div key={m.label} className="relative">
            <button
              disabled={m.disabled}
              onClick={() => {
                if (isSub) {
                  setSubmenu(isActive ? null : m);
                } else {
                  m.onSelect?.();
                  onClose();
                }
              }}
              onMouseEnter={() => {
                if (isSub) setSubmenu(m);
                else setSubmenu(null);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md mx-1 transition",
                m.disabled
                  ? "text-[var(--color-muted-foreground)]/50 cursor-not-allowed"
                  : m.destructive
                    ? "text-rose-500 hover:bg-rose-500/10"
                    : "hover:bg-[var(--color-accent)]"
              )}
              style={{ width: "calc(100% - 0.5rem)" }}
            >
              {m.icon}
              <span className="flex-1">{m.label}</span>
              {isSub ? <span className="opacity-50">›</span> : null}
            </button>
            {isActive && m.submenu ? (
              <div className="animate-scale-in origin-top-left absolute left-full top-0 ml-1 min-w-[200px] rounded-xl border border-[var(--color-card-border)] bg-[var(--color-elevated)] shadow-popover py-1 max-h-[60vh] overflow-y-auto">
                {m.submenu.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => {
                      s.onSelect?.();
                      onClose();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--color-accent)] rounded-md mx-1"
                    style={{ width: "calc(100% - 0.5rem)" }}
                  >
                    {s.icon}
                    <span className="flex-1">{s.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
