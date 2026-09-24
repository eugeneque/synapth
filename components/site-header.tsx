import Link from "next/link";
import { Heart, User } from "lucide-react";
import { auth } from "@/cortex/auth";
import { getProfile } from "@/cortex/account";
import { getI18n } from "@/cortex/locale";
import { Button } from "@/components/ui/button";
import { Logo, LogoWordmark } from "@/components/logo";
import { SiteMenu } from "@/components/site-menu";
import { NotificationBell } from "@/components/notification-center";
import { UserHoverCard } from "@/components/user-hover-card";

/**
 * Header: logo, the menu + search bar (one mega panel, `SiteMenu`) stretched across the middle,
 * and the user block. Everything else — sections, docs, language, sign-out — lives in the panel.
 */
export async function SiteHeader() {
  const [session, { t }] = await Promise.all([auth(), getI18n()]);
  // The avatar may be an uploaded data URL, which is too big for the JWT cookie — read it from the store instead.
  const profile = session?.user ? await getProfile(session.user.id) : null;

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
      <div className="container flex h-16 items-center gap-3 sm:gap-5">
        <Link href="/" aria-label="Synapth" className="flex shrink-0 items-center">
          <Logo className="h-7 w-7 sm:hidden" />
          <LogoWordmark className="hidden h-7 sm:block" />
        </Link>

        <SiteMenu viewer={session?.user ? { handle: profile?.handle ?? null } : null} />

        <div className="flex shrink-0 items-center gap-2">
          {session?.user ? (
            <>
              <Link href="/favorites" aria-label={t("header.favorites")} title={t("header.favorites")} className="hidden h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-low text-muted-foreground transition-all hover:border-foreground/40 hover:text-synapse active:scale-95 sm:flex">
                <Heart className="h-4 w-4" />
              </Link>
              <NotificationBell />
              {profile?.handle ? <UserHoverCard handle={profile.handle}>{avatarLink}</UserHoverCard> : avatarLink}
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/signin">{t("header.signIn")}</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
                <Link href="/signup">{t("header.getStarted")}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
