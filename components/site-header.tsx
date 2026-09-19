import Link from "next/link";
import { LogOut, Plus, User } from "lucide-react";
import { auth, signOut } from "@/cortex/auth";
import { billing } from "@/cortex/billing";
import { microsToUsd } from "@/types/economy";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { SearchTrigger } from "@/components/search-trigger";
import { MobileNav } from "@/components/mobile-nav";

export async function SiteHeader() {
  const session = await auth();
  const wallet = session?.user ? await billing.getWallet(session.user.id).catch(() => null) : null;

  const authActions = session?.user ? (
    <>
      <Button asChild size="sm">
        <Link href="/dashboard#publish">
          <Plus /> Publish
        </Link>
      </Button>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    </>
  ) : (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href="/signin">Sign in</Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/signup">Get started</Link>
      </Button>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between gap-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Logo className="h-6 w-6" />
            Synapth
          </Link>
          <span className="pill hidden xl:inline-flex">
            <span className="dot-live animate-pulse-dot" /> All systems operational
          </span>
        </div>

        <NavLinks className="hidden h-16 items-center gap-4 md:flex lg:gap-6" />

        <div className="flex items-center gap-2">
          <SearchTrigger />
          {wallet && (
            <Link href="/dashboard" className="hidden h-9 items-center gap-1.5 rounded-md border border-border bg-surface-low px-2.5 xl:flex" title="Wallet balance">
              <span className="label-mono-sm">Bal</span>
              <span className="font-mono text-[11px] font-medium text-synapse">${microsToUsd(wallet.balanceMicros).toFixed(2)}</span>
            </Link>
          )}
          {session?.user ? (
            <>
              <div className="hidden items-center gap-2 lg:flex">{authActions}</div>
              <Link href="/dashboard" aria-label="Developer console" className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-synapse">
                <User className="h-4 w-4" />
              </Link>
            </>
          ) : (
            <div className="hidden items-center gap-2 lg:flex">{authActions}</div>
          )}
          <MobileNav>{authActions}</MobileNav>
        </div>
      </div>
    </header>
  );
}
