"use client";

import { useEffect, useRef, useState } from "react";

// Wall-clock driven ticking. iOS suspends timers when the PWA backgrounds, so
// every countdown is stored as an absolute end timestamp and re-derived from
// Date.now() on each tick — coming back after a phone call shows the truth.
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs]);
  return now;
}

// Keep the screen on while a session is live (Safari 16.4+ / iOS PWA).
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
        };
        if (!nav.wakeLock) return;
        const l = await nav.wakeLock.request("screen");
        if (cancelled) await l.release();
        else lock = l;
      } catch {
        // Denied (low battery, not visible) — nothing to do.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}

// Short synthesized beeps. iOS needs the AudioContext created from a user
// gesture, so `unlockAudio()` is called from the Start button.
let ctx: AudioContext | null = null;
export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    // Play a silent buffer so later beeps are allowed.
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* no audio */
  }
}

export function beep(kind: "tick" | "go" | "done") {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = kind === "tick" ? [[880, 0.08]] : kind === "go" ? [[660, 0.1], [990, 0.18]] : [[523, 0.12], [659, 0.12], [784, 0.25]];
    let t = now;
    for (const [freq, dur] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.04;
    }
  } catch {
    /* ignore */
  }
}

// Fire once when a countdown crosses each of the given remaining-second marks.
export function useCountdownCues(remainingSec: number | null, onCue: (sec: number) => void) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (remainingSec === null) {
      last.current = null;
      return;
    }
    const s = Math.ceil(remainingSec);
    if (last.current !== null && s !== last.current && (s === 3 || s === 2 || s === 1 || s === 0)) {
      onCue(s);
    }
    last.current = s;
  }, [remainingSec, onCue]);
}
