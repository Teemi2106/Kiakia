import type { MetadataRoute } from "next";

const SITE_URL = "https://www.kiakia.ng";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/partner`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/ride`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/support`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
