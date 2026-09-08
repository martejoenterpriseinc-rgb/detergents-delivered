import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import type { RoleCode } from "@/lib/domain/authz";
import { loadSessionAccount } from "@/lib/services/session-account";

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
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers: [
    ...authConfig.providers,
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
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const userId = user?.id ?? token.sub;
      if (!userId) {
        return token;
      }

      const gate = await loadSessionAccount(userId);
      if (!gate) return null;
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
});
