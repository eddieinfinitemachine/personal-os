import type { MetadataRoute } from "next";
import { headers } from "next/headers";

// Hosts that get the private "EC" branding instead of the public "Kaizen" brand.
// Keep in sync with PRIVATE_HOSTS in app/page.tsx and the chrome wrapper.
const PRIVATE_HOSTS = new Set(["internal.eddiecohen.com"]);

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const host = (await headers()).get("host") ?? "";
  const baseHost = host.split(":")[0].toLowerCase();
  const isPrivate = PRIVATE_HOSTS.has(baseHost);

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
