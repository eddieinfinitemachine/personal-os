import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal OS",
    short_name: "Personal OS",
    description: "Todos, projects, people — one home.",
    start_url: "/",
    display: "standalone",
    background_color: "#1a1330",
    theme_color: "#1a1330",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
