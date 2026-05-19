import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kaizen",
    short_name: "Kaizen",
    description: "Tasks, projects, people, trips — your life, organized.",
    start_url: "/",
    display: "standalone",
    background_color: "#eaedf4",
    theme_color: "#eaedf4",
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
