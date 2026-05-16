import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { MobileChromeProvider } from "@/components/mobile-chrome";
import { themePreloadScript } from "@/components/theme-toggle";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { prisma } from "@/lib/prisma";

const getSidebarProjects = unstable_cache(
  async () =>
    prisma.project.findMany({
      where: { archived: false },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        icon: true,
        _count: { select: { todos: { where: { completedAt: null } } } },
      },
    }),
  ["sidebar-projects-v1"],
  { revalidate: 15, tags: ["sidebar-projects"] }
);

export const metadata: Metadata = {
  title: "Personal OS",
  description: "Todos, projects, people — one home.",
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
  const isBare = pathname === "/login" || pathname.startsWith("/login/");

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

  const projects = await getSidebarProjects();

  const mobileProjects = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themePreloadScript }} />
      </head>
      <body className="antialiased">
        <ServiceWorkerRegister />
        <MobileChromeProvider projects={mobileProjects}>
          <div className="flex min-h-screen">
            <div className="hidden md:flex">
              <Sidebar projects={projects} />
            </div>
            <main className="flex-1 overflow-x-hidden pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(56px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
              {children}
            </main>
          </div>
        </MobileChromeProvider>
      </body>
    </html>
  );
}
