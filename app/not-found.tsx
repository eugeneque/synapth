import NotFoundPage from "./(site)/not-found";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/** Unmatched URLs render outside every route group, so this copy brings the site chrome with it. */
export default function RootNotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <NotFoundPage />
      </main>
      <SiteFooter />
    </>
  );
}
