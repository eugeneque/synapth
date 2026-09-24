import { redirect } from "next/navigation";

/** Moved to the header's favorites page; old links keep working. */
export default function LegacySkillsetsPage() {
  redirect("/favorites");
}
