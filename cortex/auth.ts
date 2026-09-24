import NextAuth, { CredentialsSignin, type NextAuthConfig, type User } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import { createOAuthUser } from "@/cortex/registration";
import { mustConfirmEmail } from "@/cortex/email-verification";
import { requirePermission } from "@/cortex/roles";
import { clientIp, enforceRateLimit } from "@/cortex/rate-limit";
import type { Permission, UserRole } from "@/types/auth";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});

async function findUserByEmail(email: string) {
  if (hasDatabase) {
    return prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  }
  return memoryUsers.find((u) => u.email.toLowerCase() === email) ?? null;
}

/**
 * Burned when no account matches, so a wrong email costs the same time as a
 * wrong password: without it, response latency enumerates registered users.
 */
const DUMMY_HASH = "$2a$12$WfnUn5XzBGA2UJylDU20Je4ljsT6e8dTn3goWlFrXT76iikImUa1W";

/**
 * Right password, unconfirmed address. `code` reaches the client as `signIn()`'s
 * `result.code`; it is only thrown after the password matched, so it reveals
 * nothing to someone guessing emails.
 */
class EmailUnverifiedError extends CredentialsSignin {
  code = "email_unverified";
}

/**
 * Prisma adapter with Synapth's own `createUser`: a first OAuth sign-in gets a
 * unique handle, a wallet and the welcome credit, exactly like a password signup.
 */
function synapthAdapter(): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    createUser: ({ id: _id, ...data }) => createOAuthUser({ ...data, login: (data as { login?: string }).login }),
  };
}

export const authConfig: NextAuthConfig = {
  // Adapter is only wired when a DB exists; JWT strategy keeps sessions stateless either way.
  adapter: hasDatabase ? synapthAdapter() : undefined,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/signin", newUser: "/signup", error: "/signin" },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: false,
      // The GitHub login is the best handle seed; `createOAuthUser` reads it.
      profile: (p) => ({ id: String(p.id), name: p.name ?? p.login, email: p.email, image: p.avatar_url, login: p.login }) as User,
    }),
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Brute force / credential stuffing: budget per source IP and per account.
        enforceRateLimit("signin", `ip:${clientIp(request as unknown as Request)}`);
        enforceRateLimit("signin", `email:${parsed.data.email}`);

        const user = await findUserByEmail(parsed.data.email);
        // Always run one bcrypt comparison so timing does not reveal whether the account exists.
        // `|| ` and not `?? `: OAuth-only rows carry an empty hash, which bcrypt would reject instantly.
        const ok = await compare(parsed.data.password, user?.passwordHash || DUMMY_HASH);
        if (!user?.passwordHash || !ok) return null;
        if (mustConfirmEmail(user)) throw new EmailUnverifiedError();

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as UserRole,
          handle: user.handle,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Avatars are `data:` URLs up to ~160 KB: in the cookie they chunk into dozens of
      // session-token.N cookies and proxies answer 400 (header too large). The header
      // reads the image from `getProfile()`, so the token never carries it.
      delete token.picture;
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "user";
        token.handle = user.handle ?? null;
      }
      // `updateSession()` after a profile edit: keep the header's name/handle in sync without a re-login.
      if (trigger === "update" && session?.user) {
        if (typeof session.user.name === "string") token.name = session.user.name;
        if (typeof session.user.handle === "string") token.handle = session.user.handle;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id ?? token.sub ?? "";
      session.user.role = token.role ?? "user";
      session.user.handle = token.handle ?? null;
      return session;
    },
    authorized({ auth, request }) {
      // Used by middleware.ts: dashboard requires a session, everything else is public.
      const protectedPrefixes = ["/dashboard", "/publish"];
      const isProtected = protectedPrefixes.some((p) => request.nextUrl.pathname.startsWith(p));
      return isProtected ? Boolean(auth?.user) : true;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut, unstable_update: updateSession } = NextAuth(authConfig);

/** Which OAuth buttons the auth gate may enable: a provider without credentials would only 500 on click. */
export function oauthProviders() {
  return {
    github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  };
}

/** Helper for route handlers: returns the session user or throws a 401-shaped error. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session.user;
}

/** Session user + a permission check against the stored role (server actions, pages). */
export async function requireSessionPermission(permission: Permission) {
  const user = await requireUser();
  const role = await requirePermission(user.id, permission);
  return { ...user, role };
}

/** Thrown by the role checks in `cortex/api-keys.ts`; rendered as 403 by `lib/api`. */
export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  status = 401 as const;
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}
