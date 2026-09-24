import Link from "next/link";
import { Heart, LogOut, User } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getProfile } from "@/cortex/account";
import { getI18n } from "@/cortex/locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { LogoWordmark } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { SearchTrigger } from "@/components/search-trigger";
import { MobileNav } from "@/components/mobile-nav";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { NotificationBell } from "@/components/notification-center";
import { UserHoverCard } from "@/components/user-hover-card";

export async function SiteHeader() {
  const [session, { t }] = await Promise.all([auth(), getI18n()]);
  // The avatar may be an uploaded data URL, which is too big for the JWT cookie — read it from the store instead.
  const profile = session?.user ? await getProfile(session.user.id) : null;

  const authActions = session?.user ? (
    <>
      <SignOutButton label={t("header.signOut")} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
        <LogOut />
      </SignOutButton>
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

  const avatarLink = (
    <Link href={profile?.handle ? `/u/${profile.handle}` : "/dashboard/settings"} aria-label={t("header.profile")} title={t("header.profile")} className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-transparent bg-foreground text-background transition-all duration-200 hover:scale-105 hover:border-synapse hover:bg-synapse hover:shadow-glow">
      {profile?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.image} alt="" className="h-full w-full object-cover" />
      ) : (
        <User className="h-4 w-4" />
      )}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="Synapth" className="flex items-center">
            <LogoWordmark className="h-7" />
          </Link>
        </div>

        <NavLinks className="hidden h-16 items-center gap-4 md:flex lg:gap-6" />

        <div className="flex items-center gap-2">
          <SearchTrigger />
          <LocaleSwitcher className="hidden md:inline-flex" />
          {session?.user ? (
            <>
              <Link href="/favorites" aria-label={t("header.favorites")} title={t("header.favorites")} className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-low text-muted-foreground transition-all hover:border-foreground/40 hover:text-synapse active:scale-95">
                <Heart className="h-4 w-4" />
              </Link>
              <NotificationBell />
              <div className="hidden items-center gap-2 lg:flex">{authActions}</div>
              {profile?.handle ? <UserHoverCard handle={profile.handle}>{avatarLink}</UserHoverCard> : avatarLink}
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
