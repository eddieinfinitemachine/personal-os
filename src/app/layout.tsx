import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileChromeProvider } from "@/components/mobile-chrome";
import { VersionWatcher } from "@/components/version-watcher";
import { CaptureInbox } from "@/components/capture-inbox";
import { LayoutOverlays } from "@/components/layout-overlays";
import { UndoHost } from "@/components/undo-host";
import { SyncPollMount } from "@/components/sync-poll-mount";
import { themePreloadScript } from "@/components/theme-toggle";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { CaptureProvider } from "@/lib/capture-store";
import { isPrivateHost } from "@/lib/hosts";
import { isFounderUser } from "@/lib/cron";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/initials";
import { listAccessWhere } from "@/lib/list-access";

// Static metadata uses the generic product name. The installed-app name is
// personalized to the signed-in person's initials via app/manifest.ts (which
// reads the session through the credentialed manifest <link> below).
export const metadata: Metadata = {
  title: "EC",
  description: "Tasks, projects, people, trips, possessions — your life, organized.",
  // The manifest <link> is injected manually (see <head> below) with
  // crossOrigin="use-credentials" so the install request carries the session
  // cookie — that lets app/manifest.ts name the installed app after the
  // signed-in person's initials.
  appleWebApp: {
    capable: true,
    title: "EC",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // Personal app: no pinch or auto zoom, so a stray wide element can't leave
  // the page zoomed out.
  maximumScale: 1,
  userScalable: false,
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const h = await headers();
  const pathname = h.get("x-pathname") ?? "";
  const userId = h.get("x-user-id");
  const isPrivate = isPrivateHost(h.get("host"));
  const isAuthRoute =
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/signup" ||
    pathname.startsWith("/signup/");
  const isPrintRoute = pathname.startsWith("/print/");
  // Logged-out users on `/` see the landing page (rendered by page.tsx).
  // Print views render bare so the sheet looks clean on paper.
  const isBare = isAuthRoute || isPrintRoute || (pathname === "/" && !userId);

  if (isBare) {
    return (
      <html lang="en">
        <head>
          <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
          <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
        </head>
        <body className="antialiased">{children}</body>
      </html>
    );
  }

  // The signed-in person's installed copy is branded with their initials; the
  // generic product name "EC" is the fallback. See lib/initials.ts.
  // canImprove: the founder-only Improve button (sidebar + mobile drawer).
  const [me, canImprove] = await Promise.all([
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true },
        })
      : null,
    isFounderUser(userId),
  ]);
  const appName = (me && initials(me.name, me.email)) || "EC";

  // The mobile drawer's main job: pull up the lists (same order as Home's
  // pager, so a tap lands on the matching tile via /#list-<id>).
  const mobileLists = userId
    ? await prisma.list.findMany({
        where: listAccessWhere(userId),
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, color: true },
      })
    : [];

  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
      </head>
      <body className="antialiased">
        <VersionWatcher />
        <ServiceWorkerRegister />
        <SyncPollMount />
        <CaptureProvider>
          <CaptureInbox />
          <UndoHost />
          <LayoutOverlays canImprove={canImprove} />
          <MobileChromeProvider lists={mobileLists} appName={appName} isPrivate={isPrivate} canImprove={canImprove}>
            <div className="flex min-h-screen">
              <div data-app-sidebar className="hidden md:flex print:hidden">
                <Sidebar appName={appName} isPrivate={isPrivate} canImprove={canImprove} />
              </div>
              <main data-app-main className="flex-1 overflow-x-hidden pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0 print:pt-0 print:pb-0">
                {children}
              </main>
            </div>
          </MobileChromeProvider>
        </CaptureProvider>
      </body>
    </html>
  );
}
