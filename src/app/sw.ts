// Service worker for personal-os PWA. Built by @serwist/next via `next build`.
//
// Multi-tenant safety: this app is multi-user. We must NOT cache HTML, RSC,
// or `/api/*` responses — they're scoped to the logged-in user's cookie and
// would leak across logins on shared devices (couple/family) or post-logout.
//
// Strategy:
//  - Hashed static assets (`/_next/static/`, hashed bundles): CacheFirst,
//    long TTL. URL is cache-busted by Next on every build, so this is safe.
//  - Other static media (favicons, fonts, public images): StaleWhileRevalidate.
//  - Everything else (HTML, RSC, API, navigations, POST/PATCH/DELETE):
//    NetworkOnly. App works only when online; multi-tenant correctness
//    matters more than offline browsing.
//  - Logout: client posts `{ type: "purge-caches" }` to the SW which deletes
//    every runtime cache (best-effort; cookie clear still happens regardless).

/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  Serwist,
  CacheFirst,
  StaleWhileRevalidate,
  NetworkOnly,
  ExpirationPlugin,
} from "serwist";

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
  runtimeCaching: [
    // Hashed Next.js bundles — content-addressed, safe to cache aggressively.
    {
      matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          }),
        ],
      }),
    },
    // App icons + manifest assets — public, fine to revalidate in background.
    {
      matcher: ({ url, request }) =>
        request.destination === "image" &&
        (url.pathname.startsWith("/icon") ||
          url.pathname.startsWith("/apple-icon") ||
          url.pathname === "/favicon.ico"),
      handler: new StaleWhileRevalidate({
        cacheName: "app-icons",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 20,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
    // Everything else — including /api/*, HTML, RSC — bypasses the cache.
    {
      matcher: () => true,
      handler: new NetworkOnly(),
    },
  ],
});

serwist.addEventListeners();

// Logout hook: client posts `{ type: "purge-caches" }` to evict any cached
// per-user data before the next sign-in (defense-in-depth — runtime rules
// above shouldn't be caching any of it).
self.addEventListener("message", (event) => {
  if (event.data?.type === "purge-caches") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      })(),
    );
  }
});

// ── Web push ────────────────────────────────────────────────────────────
// Payload shape: { title, body?, url?, tag? } — see src/lib/push.ts.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; url?: string; tag?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? "EC", {
      body: payload.body,
      tag: payload.tag,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an existing window if one is open, else open a new one.
      for (const client of all) {
        if ("focus" in client) {
          await (client as WindowClient).focus();
          if ("navigate" in client) {
            await (client as WindowClient).navigate(url).catch(() => {});
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
