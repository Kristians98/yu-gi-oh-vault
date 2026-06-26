import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Vault — Duelist Binder",
    short_name: "The Vault",
    description: "Your Yu-Gi-Oh! binder, shared with friends. Scan, collect, trade.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0710",
    theme_color: "#0a0710",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
