/**
 * Roles and permissions (isomorphic: the UI hides what the server would refuse).
 *
 *   user      — standard account: publish, comment, post, watch, API keys;
 *   moderator — everything a user can do + verify catalogue entries
 *               (skills, MCP servers, tools; skill packs once they exist);
 *   admin     — every permission, including ones added later.
 *
 * The server never trusts the role cached in the JWT for a decision: it
 * re-reads the stored role (`cortex/roles.ts`), so a demotion applies at once.
 */

export const USER_ROLES = ["user", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** Legacy / unknown stored values (the old `creator` role) degrade to a plain user. */
export function toUserRole(value: unknown): UserRole {
  return isUserRole(value) ? value : "user";
}

export const PERMISSIONS = [
  /** Set or revoke `Verified` on a catalogue entry after a human review. */
  "catalog.verify",
  /** Open the moderation queue in the console. */
  "catalog.moderate",
  /** Run the GitHub crawler / bulk import. */
  "crawler.run",
  /** Change another account's role. */
  "users.manageRoles",
  /** Grant manual badges. */
  "badges.grant",
  /** Delete other people's posts and comments. */
  "content.moderate",
  /** Review verification requests and grant / revoke the account check mark. */
  "users.verify",
  /** Open the admin panel (users & roles, crawler, run log). */
  "admin.access",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Explicit grants for the non-admin roles; admin is not listed because it holds every permission. */
const GRANTS: Record<Exclude<UserRole, "admin">, readonly Permission[]> = {
  user: [],
  moderator: ["catalog.verify", "catalog.moderate"],
};

export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  if (role === "admin") return true;
  return GRANTS[role].includes(permission);
}

export function permissionsOf(role: UserRole): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: UserRole;
  handle: string | null;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface RegisterInput extends Credentials {
  name: string;
  handle: string;
}
