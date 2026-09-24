import { redirect } from "next/navigation";

/** Moved into the staff section ("Administration"); old links keep working. */
export default function LegacyVerificationQueue() {
  redirect("/dashboard/verification");
}
