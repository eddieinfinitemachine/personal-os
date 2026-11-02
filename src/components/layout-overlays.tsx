"use client";

import dynamic from "next/dynamic";

// Layout-level overlays that don't render visible UI until interaction
// (⌘K, capture drawer, first-run onboarding modal, Improve dialog). Splitting them out of
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
const ImproveDialog = dynamic(
  () => import("./improve/improve-dialog").then((m) => ({ default: m.ImproveDialog })),
  { ssr: false },
);

// canImprove (founder only) also keeps the Improve chunk off everyone else's page.
export function LayoutOverlays({ canImprove = false }: { canImprove?: boolean }) {
  return (
    <>
      <CommandPalette />
      <CaptureDrawer />
      <Onboarding />
      {canImprove ? <ImproveDialog /> : null}
    </>
  );
}
