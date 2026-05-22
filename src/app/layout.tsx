import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileChromeProvider } from "@/components/mobile-chrome";
import { CommandPalette } from "@/components/command-palette";
import { CaptureInbox } from "@/components/capture-inbox";
import { CaptureDrawer } from "@/components/capture-drawer";
import { themePreloadScript } from "@/components/theme-toggle";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { CaptureProvider } from "@/lib/capture-store";
import { prisma } from "@/lib/prisma";

// Per-request because the cache key would need to include userId; for a
// friends-only deployment the small extra query is fine.
async function getSidebarProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId, archived: false },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      icon: true,
      _count: { select: { todos: { where: { completedAt: null } } } },
    },
  });
}

// Static metadata defaults to the public brand. The dynamic per-host title
// (incl. "EC" for the private host) is set per-page where it matters; the
// manifest itself is host-aware via app/manifest.ts.
export const metadata: Metadata = {
  title: "Kaizen — A little better, every day.",
  description: "Tasks, projects, people, trips, possessions — your life, organized.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Kaizen",
    statusBarStyle: "black-translucent",
  },
};

// Hosts that get the private "EC" branding. Keep in sync with manifest.ts.
const PRIVATE_HOSTS = new Set(["internal.eddiecohen.com"]);

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
  const host = (h.get("host") ?? "").split(":")[0].toLowerCase();
  const appName = PRIVATE_HOSTS.has(host) ? "EC" : "Kaizen";
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
        <CaptureProvider>
          <CommandPalette />
          <CaptureInbox />
          <CaptureDrawer />
          <MobileChromeProvider projects={mobileProjects} appName={appName}>
            <div className="flex min-h-screen">
              <div className="hidden md:flex print:hidden">
                <Sidebar projects={projects} appName={appName} />
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
