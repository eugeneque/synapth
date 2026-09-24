import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

/** Moved into the staff section ("Administration"); old links keep working. */
export default async function LegacyVerificationRequest({ params }: Props) {
  const { id } = await params;
  redirect(`/dashboard/verification/${encodeURIComponent(id)}`);
}
