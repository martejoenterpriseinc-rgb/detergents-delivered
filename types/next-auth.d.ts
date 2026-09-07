import { DefaultSession } from "next-auth";
import type { RoleCode } from "@/lib/domain/authz";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: RoleCode[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles?: RoleCode[];
  }
}
