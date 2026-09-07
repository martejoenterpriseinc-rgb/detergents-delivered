"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/auth";
import { CHANGE_CREDENTIALS_PATH } from "@/lib/domain/credentials";
import { prisma } from "@/lib/prisma";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(320)
    .refine((value) => /^[^\s@]+@[^\s@]+$/.test(value), "Invalid email"),
  password: z.string().min(8).max(200),
});

export async function signInWithCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/account");

  const pending = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), deletedAt: null },
    select: { mustChangeCredentials: true },
  });
  const redirectTo = pending?.mustChangeCredentials
    ? CHANGE_CREDENTIALS_PATH
    : callbackUrl;

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(
        `/sign-in?error=credentials&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    throw error;
  }
}

export async function signInWithGoogle(formData: FormData) {
  const callbackUrl = String(formData.get("callbackUrl") ?? "/account");
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function registerWithCredentials(formData: FormData) {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect("/register?error=invalid");
  }

  const existing = await prisma.user.findFirst({
    where: { email: parsed.data.email, deletedAt: null },
  });
  if (existing) {
    redirect("/register?error=exists");
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
    },
  });

  const customerRole = await prisma.role.upsert({
    where: { code: "CUSTOMER" },
    update: {},
    create: {
      code: "CUSTOMER",
      name: "Customer",
      description: "Shopper account for the storefront and household account area.",
    },
  });
  await prisma.userRole.create({
    data: { userId: user.id, roleId: customerRole.id },
  });
  await prisma.customer.create({
    data: {
      userId: user.id,
      firstName: parsed.data.name.split(" ")[0],
      lastName: parsed.data.name.split(" ").slice(1).join(" ") || null,
    },
  });

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/account",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/sign-in?error=credentials");
    }
    throw error;
  }
}
