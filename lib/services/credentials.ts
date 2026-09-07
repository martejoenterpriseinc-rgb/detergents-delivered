import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
  validateCredentialChange,
} from "@/lib/domain/credentials";

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

export async function changeUserCredentials(input: {
  userId: string;
  newEmail: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      mustChangeCredentials: true,
    },
  });

  if (!user) {
    throw new CredentialsError("Account not found.");
  }
  if (!user.mustChangeCredentials) {
    throw new CredentialsError("Credential change is not required.");
  }

  const parsed = validateCredentialChange({
    currentEmail: user.email,
    newEmail: input.newEmail,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
    temporaryPasswords: [
      DOCUMENTED_STAGING_BOOTSTRAP_PASSWORD,
      process.env.SEED_BOOTSTRAP_ADMIN_PASSWORD ?? "",
    ],
  });
  if (!parsed.ok) {
    throw new CredentialsError(parsed.error);
  }

  if (user.passwordHash) {
    const reused = await bcrypt.compare(parsed.password, user.passwordHash);
    if (reused) {
      throw new CredentialsError(
        "New password cannot be the temporary bootstrap password.",
      );
    }
  }

  const taken = await prisma.user.findFirst({
    where: { email: parsed.email, id: { not: user.id } },
    select: { id: true },
  });
  if (taken) {
    throw new CredentialsError("That username/email is already in use.");
  }

  const passwordHash = await bcrypt.hash(parsed.password, 12);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: parsed.email,
      passwordHash,
      mustChangeCredentials: false,
    },
    select: { id: true, email: true, mustChangeCredentials: true },
  });

  await writeAuditLog(prisma, {
    actorUserId: user.id,
    action: "user.credentials.rotated",
    entityType: "User",
    entityId: user.id,
    beforeJson: { email: user.email, mustChangeCredentials: true },
    afterJson: { email: updated.email, mustChangeCredentials: false },
  });

  return updated;
}
