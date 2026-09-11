"use server";

import { redirect } from "next/navigation";
import { requireAuth, hasRole } from "@/lib/authz";
import { ADMIN_SHELL_ROLES } from "@/lib/domain/authz";
import { prisma } from "@/lib/prisma";
import { activateInitialOwner } from "@/lib/operations/owner-activation";

export async function activateInitialOwnerAction(formData: FormData) {
  const session = await requireAuth();
  if (hasRole(session.user.roles, ADMIN_SHELL_ROLES)) redirect("/admin");
  try {
    await activateInitialOwner(
      prisma,
      { activationToken: String(formData.get("activationToken") ?? "") },
      session.user.id,
      session.user.email ?? "",
    );
  } catch {
    redirect("/account/platform-owner?error=invalid");
  }
  // The activation transaction revokes the customer session so newly granted
  // SUPER_ADMIN authority can never be inherited by the old session.
  redirect("/sign-in?callbackUrl=%2Fadmin&ownerActivated=1");
}
