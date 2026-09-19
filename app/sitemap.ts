import type { MetadataRoute } from "next";
import { skillRepository } from "@/cortex/repository";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const skills = await skillRepository.all();
  const authors = [...new Set(skills.map((s) => s.source?.owner ?? s.authorName))];
  return [
    { url: `${APP_URL}/`, changeFrequency: "hourly", priority: 1 },
    { url: `${APP_URL}/explore`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${APP_URL}/faq`, changeFrequency: "monthly", priority: 0.5 },
    ...skills.map((s) => ({ url: `${APP_URL}/skills/${s.slug}`, lastModified: new Date(s.updatedAt), changeFrequency: "daily" as const, priority: 0.8 })),
    ...authors.map((a) => ({ url: `${APP_URL}/authors/${encodeURIComponent(a)}`, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
