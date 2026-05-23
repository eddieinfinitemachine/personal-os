"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PrintButton() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hide mt-3 inline-flex items-center rounded border border-black/30 px-3 py-1 text-xs font-medium hover:bg-black/5"
    >
      Print this page · ⌘P · esc to exit
    </button>
  );
}
