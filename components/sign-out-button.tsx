"use client";

import { useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";

interface Props {
  className?: string;
  label: string;
  children: ReactNode;
}

/**
 * Ends the session through `/api/auth/signout` and then hard-navigates to the sign-in page.
 * A full page load (not a router push) drops the client router cache, so no page rendered
 * with the old session can be served again, and the next sign-in needs credentials.
 */
export function SignOutButton({ className, label, children }: Props) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut({ redirect: false });
    } finally {
      window.location.replace("/signin");
    }
  }

  return (
    <button type="button" onClick={onClick} disabled={busy} aria-label={label} title={label} className={className}>
      {children}
    </button>
  );
}
