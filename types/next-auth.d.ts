import type { DefaultSession } from "next-auth";
import type { UserRole } from "./auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: UserRole;
      handle: string | null;
    };
  }

  interface User {
    role?: UserRole;
    handle?: string | null;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    handle?: string | null;
  }
}
