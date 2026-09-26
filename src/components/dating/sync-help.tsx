"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** How to sync iMessage from the Mac. */
export function SyncHelp({ compact = false, hasHandles = true }: { compact?: boolean; hasHandles?: boolean }) {
  const [open, setOpen] = useState(!compact);
  return (
    <div className="text-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Sync iMessage from your Mac
      </button>
      {open && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--color-muted-foreground)]">
          {!hasHandles && <li>Add her phone number or email under Notes → Details.</li>}
          <li>
            In the repo on your Mac, set <code>CAPTURE_TOKEN</code> and <code>APP_URL</code> in <code>.env</code>.
          </li>
          <li>
            Give your terminal Full Disk Access (System Settings → Privacy &amp; Security).
          </li>
          <li>
            Run <code>pnpm dlx tsx scripts/dating-messages-sync.ts</code>. Add <code>--install-launchd</code> to keep
            it syncing every 30 minutes.
          </li>
          <li>Only 1:1 threads with the numbers you add here are read. Group chats and everyone else are skipped.</li>
        </ol>
      )}
    </div>
  );
}
