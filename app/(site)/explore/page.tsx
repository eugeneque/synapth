import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/** The catalogue lives in search now: `/search?tab=skills` (or `skillsets`); old links keep their filters. */
export default async function ExplorePage({ searchParams }: { searchParams: Promise<Search> }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value && k !== "focus") p.set(k, value);
  }
  if (p.get("tab") !== "skillsets") p.set("tab", "skills");
  redirect(`/search?${p.toString()}`);
}
