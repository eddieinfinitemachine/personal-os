import type { MetadataRoute } from "next";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/initials";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // Personalize the installed app to the signed-in person's initials. The
  // <link rel="manifest" crossOrigin="use-credentials"> in layout.tsx ensures
  // the install request carries the session cookie so getSession() resolves
  // here. Logged-out installs get the generic product name.
  let appName = "EC";
  const session = await getSession();
  if (session) {
    const me = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, email: true },
    });
    const ini = me ? initials(me.name, me.email) : "";
    if (ini) appName = ini;
  }

  return {
    name: appName,
    short_name: appName,
    description:
      "A personal OS — tasks, projects, people, trips, and possessions, all in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#eaedf4",
    theme_color: "#eaedf4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
