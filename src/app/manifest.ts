import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isPrivateHost } from "@/lib/hosts";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const isPrivate = isPrivateHost((await headers()).get("host"));

  return {
    name: isPrivate ? "EC" : "Kaizen",
    short_name: isPrivate ? "EC" : "Kaizen",
    description: isPrivate
      ? "Personal dashboard."
      : "Tasks, projects, people, trips — your life, organized.",
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
