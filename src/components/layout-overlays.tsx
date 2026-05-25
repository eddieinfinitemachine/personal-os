"use client";

import dynamic from "next/dynamic";

// Layout-level overlays that don't render visible UI until interaction
// (⌘K, capture drawer, first-run onboarding modal). Splitting them out of
// the critical chunk lets the landing page + first paint skip ~1.7k lines
// of client JS — the editor inside CaptureDrawer is deferred further inside
// capture-drawer.tsx itself.

const CommandPalette = dynamic(
  () => import("./command-palette").then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
);
const CaptureDrawer = dynamic(
  () => import("./capture-drawer").then((m) => ({ default: m.CaptureDrawer })),
  { ssr: false },
);
const Onboarding = dynamic(
  () => import("./onboarding").then((m) => ({ default: m.Onboarding })),
  { ssr: false },
);

export function LayoutOverlays() {
  return (
    <>
      <CommandPalette />
      <CaptureDrawer />
      <Onboarding />
    </>
  );
}
