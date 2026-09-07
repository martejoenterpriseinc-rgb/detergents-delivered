"use server";

import { signIn } from "@/auth";
import { requireAuth } from "@/lib/authz";
import { ADMIN_SHELL_ROLES, hasRole } from "@/lib/domain/authz";
import { changeUserCredentials, CredentialsError } from "@/lib/services/credentials";

export async function submitCredentialChange(
  _prev: { error?: string } | null,
  formData: FormData,
): Promise<{ error?: string }> {
  const session = await requireAuth();
  const newEmail = String(formData.get("email") ?? "");
  const newPassword = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  try {
    const updated = await changeUserCredentials({
      userId: session.user.id,
      newEmail,
      newPassword,
      confirmPassword,
    });

    const dest = hasRole(session.user.roles, ADMIN_SHELL_ROLES) ? "/admin" : "/account";
    await signIn("credentials", {
      email: updated.email,
      password: newPassword,
      redirectTo: dest,
    });
    return {};
  } catch (error) {
    if (error instanceof CredentialsError) {
      return { error: error.message };
    }
    throw error;
  }
}
