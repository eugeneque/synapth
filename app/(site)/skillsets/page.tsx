import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/** Skillsets live in the catalogue now (`/explore?tab=skillsets`); old links keep their filters. */
export default async function SkillsetsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const p = new URLSearchParams({ tab: "skillsets" });
  for (const [k, v] of Object.entries(await searchParams)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value && (k === "q" || k === "verified" || k === "sort")) p.set(k, value);
  }
  redirect(`/explore?${p.toString()}`);
}
