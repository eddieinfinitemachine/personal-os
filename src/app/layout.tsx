import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileChromeProvider } from "@/components/mobile-chrome";
import { CaptureInbox } from "@/components/capture-inbox";
import { LayoutOverlays } from "@/components/layout-overlays";
import { SyncPollMount } from "@/components/sync-poll-mount";
import { themePreloadScript } from "@/components/theme-toggle";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { CaptureProvider } from "@/lib/capture-store";
import { isPrivateHost } from "@/lib/hosts";
import { prisma } from "@/lib/prisma";

// Per-request: small enough to not warrant a cache layer for a friends-only
// deployment. The prior `_count.todos` shape emitted a correlated subquery
// per project — fine for a few projects, but scales linearly. Replaced with
// a single groupBy + in-memory merge so the sidebar issues two indexed reads
// regardless of project count.
async function getSidebarProjects(userId: string) {
  const [projects, counts] = await Promise.all([
    prisma.project.findMany({
      where: { userId, archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, icon: true },
    }),
    prisma.todo.groupBy({
      by: ["projectId"],
      where: {
        userId,
        completedAt: null,
        projectId: { not: null },
      },
      _count: { _all: true },
    }),
  ]);
  const countByProject = new Map<string, number>();
  for (const c of counts) {
    if (c.projectId) countByProject.set(c.projectId, c._count._all);
  }
  return projects.map((p) => ({
    ...p,
    _count: { todos: countByProject.get(p.id) ?? 0 },
  }));
}

// Static metadata defaults to the public brand. The dynamic per-host title
// (incl. "EC" for the private host) is set per-page where it matters; the
// manifest itself is host-aware via app/manifest.ts.
export const metadata: Metadata = {
  title: "Personal OS — A little better, every day.",
  description: "Tasks, projects, people, trips, possessions — your life, organized.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Personal OS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
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
  const appName = "Personal OS";
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
          <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
        </head>
        <body className="antialiased">{children}</body>
      </html>
    );
  }

  // userId is guaranteed here because !isBare means middleware found a valid session.
  const projects = userId ? await getSidebarProjects(userId) : [];

  const mobileProjects = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
      </head>
      <body className="antialiased">
        <ServiceWorkerRegister />
        <SyncPollMount />
        <CaptureProvider>
          <CaptureInbox />
          <LayoutOverlays />
          <MobileChromeProvider projects={mobileProjects} appName={appName} isPrivate={isPrivate}>
            <div className="flex min-h-screen">
              <div className="hidden md:flex print:hidden">
                <Sidebar projects={projects} appName={appName} isPrivate={isPrivate} />
              </div>
              <main className="flex-1 overflow-x-hidden pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(56px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0 print:pt-0 print:pb-0">
                {children}
              </main>
            </div>
          </MobileChromeProvider>
        </CaptureProvider>
      </body>
    </html>
  );
}
