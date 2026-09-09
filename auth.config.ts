import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { RoleCode } from "@/lib/domain/authz";
import {
  googleSignInConfigured,
  googleSignInCredentials,
} from "@/lib/domain/customer-access";
const googleCredentials = googleSignInCredentials();

const googleProvider = googleSignInConfigured()
  ? [
      Google({
        clientId: googleCredentials.clientId,
        clientSecret: googleCredentials.clientSecret,
      }),
    ]
  : [];

export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  session: {
    strategy: "jwt",
  },
  providers: googleProvider,
  trustHost: true,
  callbacks: {
    jwt({ token }) {
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.roles = (token.roles ?? []) as RoleCode[];
        session.user.mustChangeCredentials = Boolean(token.mustChangeCredentials);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
