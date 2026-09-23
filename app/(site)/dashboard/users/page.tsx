import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Moved into the admin panel; old links keep working. */
export default async function LegacyUsersPage({ searchParams }: Props) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") params.set(k, v);
  const qs = params.toString();
  redirect(`/dashboard/admin/users${qs ? `?${qs}` : ""}`);
}
