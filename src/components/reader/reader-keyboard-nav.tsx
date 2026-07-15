"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/haptic";

// Keyboard nav for the Read Later list:
//   j / k  — move the highlight
//   Enter / o — open the highlighted article
//   e      — archive (or unarchive in the Archive view)
//   #      — delete (press twice)
//   Esc    — clear
// Rows are discovered via [data-kbd-reader]; highlight style is the shared
// [data-kbd-active] rule.

export function ReaderKeyboardNav({ archivedView }: { archivedView: boolean }) {
  const router = useRouter();
  const activeIdRef = useRef<string | null>(null);
  const confirmDeleteRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  const rows = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-kbd-reader]"));

  const setActive = useCallback((id: string | null) => {
    for (const el of rows()) {
      if (el.dataset.kbdReader === id) {
        el.dataset.kbdActive = "true";
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        delete el.dataset.kbdActive;
      }
    }
    activeIdRef.current = id;
  }, []);

  const move = useCallback(
    (dir: 1 | -1) => {
      const all = rows();
      if (!all.length) return;
      const idx = all.findIndex(
        (el) => el.dataset.kbdReader === activeIdRef.current
      );
      const next =
        idx === -1
          ? dir === 1
            ? 0
            : all.length - 1
          : Math.min(Math.max(idx + dir, 0), all.length - 1);
      setActive(all[next].dataset.kbdReader ?? null);
    },
    [setActive]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el.isContentEditable
      )
        return;
      if (document.querySelector("[data-overlay]")) return;

      const id = activeIdRef.current;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
        case "o":
          if (id) router.push(`/reader/${id}`);
          break;
        case "e":
          if (id && !busyRef.current) {
            busyRef.current = true;
            move(1);
            fetch(`/api/reader/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ archived: !archivedView }),
            })
              .then(() => {
                haptic("tick");
                router.refresh();
              })
              .finally(() => {
                busyRef.current = false;
              });
          }
          break;
        case "#":
          if (!id || busyRef.current) break;
          if (confirmDeleteRef.current !== id) {
            confirmDeleteRef.current = id;
            haptic("tick");
            setTimeout(() => {
              if (confirmDeleteRef.current === id)
                confirmDeleteRef.current = null;
            }, 2500);
            break;
          }
          confirmDeleteRef.current = null;
          busyRef.current = true;
          move(1);
          fetch(`/api/reader/${id}`, { method: "DELETE" })
            .then(() => {
              haptic("success");
              router.refresh();
            })
            .finally(() => {
              busyRef.current = false;
            });
          break;
        case "Escape":
          setActive(null);
          break;
      }
    }
    // Capture phase: real keypresses reach us before any in-page handler
    // can stop propagation (inputs/overlays are still respected above).
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [move, router, archivedView, setActive]);

  return null;
}
