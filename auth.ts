import NextAuth from "next-auth";
import { runtimeGoogleProviders } from "@/lib/integrations/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import type { RoleCode } from "@/lib/domain/authz";
import { loadSessionAccount } from "@/lib/services/session-account";
import {
  createHouseholdUser,
  ensureGoogleHousehold,
} from "@/lib/services/customer-registration";
import { consumeAuthenticationLimit } from "@/lib/services/authentication-throttle";

const credentialsSchema = z.object({
  // Accepts local/dev addresses such as admin@localhost; production users
  // still register with normal emails.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(320)
    .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), "Invalid email"),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth(async () => ({
  ...authConfig,
  adapter: {
    ...PrismaAdapter(prisma),
    // Google is the only OAuth provider. The signIn callback requires its
    // verified-email claim before Auth.js can reach this atomic provisioning path.
    createUser: (data) =>
      createHouseholdUser({
        email: data.email,
        name: data.name,
        image: data.image,
        emailVerified: new Date(),
      }),
  },
  session: { strategy: "jwt" },
  providers: [
    ...(await runtimeGoogleProviders()),
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }
        if (!(await consumeAuthenticationLimit("login", parsed.data.email))) return null;

        const user = await prisma.user.findFirst({
          where: { email: parsed.data.email, deletedAt: null },
        });
        if (!user?.passwordHash) {
          return null;
        }

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          mustChangeCredentials: user.mustChangeCredentials,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      if (profile?.email_verified !== true || !profile.email) return false;
      const linked = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: "google",
            providerAccountId: account.providerAccountId,
          },
        },
        include: { user: { select: { deletedAt: true } } },
      });
      if (linked)
        return (
          !linked.user.deletedAt && ensureGoogleHousehold(linked.userId, profile.email)
        );
      const existing = await prisma.user.findUnique({
        where: { email: profile.email.trim().toLowerCase() },
        select: { id: true },
      });
      // No implicit linking, including for an already signed-in browser. An
      // existing email/password identity must use its original sign-in method.
      if (existing) return "/sign-in?error=OAuthAccountNotLinked";
      return consumeAuthenticationLimit("register", profile.email);
    },
    async jwt({ token, user }) {
      const userId = user?.id ?? token.sub;
      if (!userId) {
        return token;
      }

      const gate = await loadSessionAccount(userId);
      if (!gate) return null;
      const presentedVersion = user
        ? (user.sessionVersion ?? gate.sessionVersion)
        : (token.sessionVersion ?? 0);
      if (presentedVersion !== gate.sessionVersion) return null;
      token.sessionVersion = gate.sessionVersion;
      token.sub = userId;
      token.roles = gate.roles;
      token.mustChangeCredentials = gate.mustChangeCredentials;
      if (gate.email) {
        token.email = gate.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.roles = (token.roles ?? []) as RoleCode[];
        session.user.mustChangeCredentials = Boolean(token.mustChangeCredentials);
        if (token.email) {
          session.user.email = token.email;
        }
      }
      return session;
    },
  },
}));
