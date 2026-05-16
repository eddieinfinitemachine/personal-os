// Service worker for personal-os PWA. Built by @serwist/next via `next build`.
//
// Strategy:
//  - HTML routes: NetworkFirst with a short timeout, then fall back to cache,
//    so a refresh always shows the latest if online but the app still launches
//    when offline.
//  - Static assets (Next.js hashed bundles, icons, fonts): CacheFirst with
//    long retention.
//  - GET API responses: NetworkFirst with cache fallback for read-only data.
//  - POST/PATCH/DELETE: pass through, no cache. (These will fail offline; the
//    UI surfaces the failure to the user.)
//
// Note: this file is consumed at build time by Serwist's webpack plugin —
// avoid Node-only imports and keep everything portable to the SW runtime.

/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
