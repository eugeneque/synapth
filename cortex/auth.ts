import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma, hasDatabase } from "@/cortex/db";
import { memoryUsers } from "@/cortex/seed";
import type { UserRole } from "@/types/auth";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

async function findUserByEmail(email: string) {
  if (hasDatabase) {
    return prisma.user.findUnique({ where: { email } });
  }
  return memoryUsers.find((u) => u.email === email) ?? null;
}

export const authConfig: NextAuthConfig = {
  // Adapter is only wired when a DB exists; JWT strategy keeps sessions stateless either way.
  adapter: hasDatabase ? PrismaAdapter(prisma) : undefined,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/signin", newUser: "/signup", error: "/signin" },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: false,
    }),
    Credentials({
      name: "Email & password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await findUserByEmail(parsed.data.email);
        if (!user?.passwordHash) return null;

        const ok = await compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role as UserRole,
          handle: user.handle,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "user";
        token.handle = user.handle ?? null;
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

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Helper for route handlers: returns the session user or throws a 401-shaped error. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session.user;
}

export class UnauthorizedError extends Error {
  status = 401 as const;
  constructor() {
    super("Authentication required");
    this.name = "UnauthorizedError";
  }
}
