import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const googleId = process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET;

const googleProvider =
  googleId && googleSecret
    ? [
        Google({
          clientId: googleId,
          clientSecret: googleSecret,
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
} satisfies NextAuthConfig;
