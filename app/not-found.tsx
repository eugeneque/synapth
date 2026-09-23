import NotFoundPage from "./(site)/not-found";
import SiteLayout from "./(site)/layout";

/**
 * Unmatched URLs render outside every route group, so this reuses the site layout itself:
 * the header's notification bell needs the provider it mounts.
 */
export default function RootNotFound() {
  return (
    <SiteLayout>
      <NotFoundPage />
    </SiteLayout>
  );
}
