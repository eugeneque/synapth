export type UserRole = "user" | "creator" | "admin";

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
