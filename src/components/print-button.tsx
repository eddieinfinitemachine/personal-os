"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print-hide mt-3 inline-flex items-center rounded border border-black/30 px-3 py-1 text-xs font-medium hover:bg-black/5"
    >
      Print this page · ⌘P
    </button>
  );
}
