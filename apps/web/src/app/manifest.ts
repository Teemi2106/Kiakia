import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KiaKia — Food & goods delivery",
    short_name: "KiaKia",
    description: "Order from local vendors and follow your delivery live.",
    id: "/home",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    background_color: "#fcf9f8",
    theme_color: "#b61913",
    icons: [
      {
        src: "/assets/kiakia-pwa-icon.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/assets/kiakia-pwa-icon.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/assets/sec-logo.png",
        sizes: "128x122",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
