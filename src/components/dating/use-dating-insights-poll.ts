"use client";

import { useEffect, useRef } from "react";
import type { DatingPersonDTO } from "@/lib/dating-server";

type InsightUpdate = Pick<DatingPersonDTO, "insights" | "insightsAt">;
type Options = {
  personId: string;
  insightsAt: string | null;
  hasInsights: boolean;
  paused: boolean;
  onUpdate: (value: Partial<DatingPersonDTO>) => void;
};

/** Read saved results only. Background generation belongs to create/import paths. */
export function useDatingInsightsPoll({ personId, insightsAt, hasInsights, paused, onUpdate }: Options) {
  const latest = useRef({ insightsAt, hasInsights });
  latest.current = { insightsAt, hasInsights };
  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") {
        timer = setTimeout(poll, latest.current.hasInsights ? 30_000 : 10_000);
      }
    };
    const poll = async () => {
      if (stopped || pending || document.visibilityState !== "visible") return;
      pending = true;
      controller = new AbortController();
      try {
        const res = await fetch(`/api/dating/${personId}/insights`, { method: "GET", cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json() as InsightUpdate;
        if (stopped || controller.signal.aborted || document.visibilityState !== "visible" || !data.insights) return;
        const incoming = data.insightsAt ? Date.parse(data.insightsAt) : NaN;
        const current = latest.current.insightsAt ? Date.parse(latest.current.insightsAt) : -Infinity;
        if (Number.isFinite(incoming) && incoming > current) {
          latest.current = { insightsAt: data.insightsAt, hasInsights: true };
          onUpdate({ insights: data.insights, insightsAt: data.insightsAt });
        }
      } catch {
        // Offline/background reads retry silently; never trigger model generation.
      } finally {
        pending = false;
        schedule();
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") void poll();
      else controller?.abort();
    };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [personId, paused, onUpdate]);
}
