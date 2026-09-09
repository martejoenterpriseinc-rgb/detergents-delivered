import { DefaultSession } from "next-auth";
import type { RoleCode } from "@/lib/domain/authz";

declare module "next-auth" {
  interface User {
    sessionVersion?: number;
    mustChangeCredentials?: boolean;
  }

  interface Session {
    user: {
      id: string;
      roles: RoleCode[];
      mustChangeCredentials: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionVersion?: number;
    roles?: RoleCode[];
    mustChangeCredentials?: boolean;
  }
}
