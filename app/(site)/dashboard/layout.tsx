import { redirect } from "next/navigation";
import { auth } from "@/cortex/auth";
import { hasDatabase } from "@/cortex/db";
import { ConsoleNav } from "@/components/console-nav";

/** Developer console shell: the control-plane rail on the left, the page on the right. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/dashboard");
  return (
    <div className="container flex flex-col gap-8 py-8 lg:flex-row lg:items-start md:py-12">
      <ConsoleNav store={hasDatabase ? "postgres" : "in-memory"} handle={session.user.handle ?? "account"} className="w-full shrink-0 lg:sticky lg:top-24 lg:w-56 lg:min-h-[calc(100vh-8rem)]" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
