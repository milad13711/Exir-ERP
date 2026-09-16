import type { MetadataRoute } from "next";
import { fetchPublicIndustryTemplates, fetchPublicModules } from "@/lib/api";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://45.94.215.22:8082").replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [industries, modules] = await Promise.all([
    fetchPublicIndustryTemplates().catch(() => []),
    fetchPublicModules().catch(() => []),
  ]);

  return [
    { url: `${SITE_URL}/`, priority: 1 },
    { url: `${SITE_URL}/about`, priority: 0.7 },
    { url: `${SITE_URL}/industries`, priority: 0.9 },
    { url: `${SITE_URL}/modules`, priority: 0.9 },
    { url: `${SITE_URL}/configure`, priority: 0.8 },
    ...industries.map((i) => ({ url: `${SITE_URL}/industries/${i.code}`, priority: 0.85 })),
    ...modules.map((m) => ({ url: `${SITE_URL}/modules/${m.code}`, priority: 0.75 })),
  ];
}
