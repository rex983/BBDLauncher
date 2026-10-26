import type { MetadataRoute } from "next";

// Home-screen install: name, colors and the icons in public/.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BBD Launcher",
    short_name: "Launcher",
    description: "Sign in once and open every BBD app",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ee5a24",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
