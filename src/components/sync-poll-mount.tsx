"use client";

import { useSyncPoll } from "@/lib/use-sync-poll";

// Renderless client wrapper that mounts the visibility-gated polling hook
// at the root layout level. Lets the server-rendered layout stay async
// without dragging a hook into it.
export function SyncPollMount() {
  useSyncPoll();
  return null;
}
