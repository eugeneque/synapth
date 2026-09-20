import { auth } from "@/cortex/auth";
import { listNotifications } from "@/cortex/notifications";
import { NotificationProvider } from "@/axon/notifications";
import { NotificationDrawer } from "@/components/notification-center";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/**
 * Public site chrome: sticky header, page body, status footer. The auth gate lives outside this group.
 * The notification centre is mounted here because it needs the session; the toast stack sits in the root layout.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user ?? null;
  const unread = user ? (await listNotifications(user.id, { limit: 1 })).unread : 0;
  return (
    <NotificationProvider userId={user?.id ?? null} viewerHandle={user?.handle ?? null} initialUnread={unread}>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
      <NotificationDrawer />
    </NotificationProvider>
  );
}
