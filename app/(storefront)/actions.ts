"use server";

import { runtimeGoogleConfigured } from "@/lib/integrations/google";
import { safeLoginCallback } from "@/lib/domain/login-destination";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { signIn, signOut } from "@/auth";
import { CHANGE_CREDENTIALS_PATH } from "@/lib/domain/credentials";
import { prisma } from "@/lib/prisma";
import { registerAccountSchema } from "@/lib/domain/customer-access";
import { registerCustomer } from "@/lib/services/customer-registration";
import { consumeAuthenticationLimit } from "@/lib/services/authentication-throttle";

export async function signInWithCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeLoginCallback(formData.get("callbackUrl"));

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
  if (!(await runtimeGoogleConfigured())) redirect("/sign-in?error=unavailable");
  const callbackUrl = safeLoginCallback(formData.get("callbackUrl"));
  await signIn("google", { redirectTo: callbackUrl });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function registerWithCredentials(formData: FormData) {
  const parsed = registerAccountSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    redirect("/register?error=invalid");
  }

  if (!(await consumeAuthenticationLimit("register", parsed.data.email)))
    redirect("/register?error=limited");
  try {
    await registerCustomer(parsed.data);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      redirect("/register?error=unavailable");
    redirect("/register?error=invalid");
  }

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
