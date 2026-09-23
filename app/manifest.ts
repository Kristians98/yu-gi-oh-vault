import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Virtual Binder — Yu-Gi-Oh! collection",
    short_name: "Virtual Binder",
    description: "Your Yu-Gi-Oh! binder, shared with friends. Scan, collect, trade.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0710",
    theme_color: "#0a0710",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/binder-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
