import { redirect } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

/** The people directory lives in search now: `/search?tab=people`. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = (await searchParams).q;
  const value = Array.isArray(q) ? q[0] : q;
  redirect(value ? `/search?tab=people&q=${encodeURIComponent(value)}` : "/search?tab=people");
}
