import type { MetadataRoute } from "next";

const SITE_URL = "https://www.kiakia.ng";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/fleet/",
        "/dashboard/",
        "/home",
        "/cart",
        "/checkout",
        "/orders/",
        "/profile/",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/auth/",
        "/onboarding/",
        "/unsubscribe",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
