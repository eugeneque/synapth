import { redirect } from "next/navigation";

/** The account settings are the console's home; publishing and keys live under /dashboard/developer. */
export default function DashboardIndex() {
  redirect("/dashboard/settings");
}
