import Link from "next/link";
import { LogOut, Plus, User } from "lucide-react";
import { auth, signOut } from "@/cortex/auth";
import { getProfile } from "@/cortex/account";
import { getI18n } from "@/cortex/locale";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { SearchTrigger } from "@/components/search-trigger";
import { MobileNav } from "@/components/mobile-nav";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-center";

export async function SiteHeader() {
  const [session, { t }] = await Promise.all([auth(), getI18n()]);
  // The avatar may be an uploaded data URL, which is too big for the JWT cookie — read it from the store instead.
  const profile = session?.user ? await getProfile(session.user.id) : null;

  const authActions = session?.user ? (
    <>
      <Button asChild size="sm">
        <Link href="/dashboard#publish">
          <Plus /> {t("header.publish")}
        </Link>
      </Button>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("header.signOut")}>
          <LogOut />
        </Button>
      </form>
    </>
  ) : (
    <>
      <Button asChild variant="ghost" size="sm">
        <Link href="/signin">{t("header.signIn")}</Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <Link href="/signup">{t("header.getStarted")}</Link>
      </Button>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Logo className="h-6 w-6" />
            Synapth
          </Link>
        </div>

        <NavLinks className="hidden h-16 items-center gap-4 md:flex lg:gap-6" />

        <div className="flex items-center gap-2">
          <SearchTrigger />
          <LocaleSwitcher className="hidden md:inline-flex" />
          {session?.user ? (
            <>
              <NotificationBell />
              <div className="hidden items-center gap-2 lg:flex">{authActions}</div>
              <Link href="/dashboard" aria-label={t("header.console")} className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-transparent bg-foreground text-background transition-colors hover:border-synapse hover:bg-synapse">
                {profile?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-4 w-4" />
                )}
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
