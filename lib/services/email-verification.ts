import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { accountIdentity } from "./customer-account";
import { consumeAuthenticationLimit } from "./authentication-throttle";
import { runtimeRecoveryEmailConfiguration } from "./password-recovery";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const prefix = (userId: string) => `dd-email-verification:v1:${userId}:`;
function identifier(user: { id: string; email: string; sessionVersion: number }) {
  return `${prefix(user.id)}${hash(user.email)}:${user.sessionVersion}`;
}
export const confirmEmailInput = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

async function configuration() {
  try {
    return await runtimeRecoveryEmailConfiguration();
  } catch {
    throw new AccountError(
      "Email verification is temporarily unavailable. Please try again later.",
      503,
    );
  }
}
export async function emailVerificationAvailable() {
  try {
    await configuration();
    return true;
  } catch {
    return false;
  }
}

export async function sendVerificationEmail(email: string, token: string) {
  const config = await configuration();
  if (
    process.env.APP_ENV !== "production" &&
    !config.allowed.includes(email.toLowerCase())
  )
    throw new AccountError("Email verification is temporarily unavailable.", 503);
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: config.from,
      subject: "Verify your Detergents Delivered email",
      content: [
        {
          type: "text/plain",
          value: `Confirm your email using this link:\n\n${config.origin}/verify-email#token=${token}\n\nSign in to the same account, then select Confirm email. This link expires in 30 minutes. Your password and account permissions will not change. If you did not request this email, you can ignore it.`,
        },
      ],
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
      },
    }),
  });
  if (response.status !== 202)
    throw new AccountError(
      "The verification email could not be confirmed. Please try again.",
      503,
    );
}

// Explicit signed-in request only. VerificationToken is purpose-namespaced and
// stores only a hash, never a usable link. Failed/interrupted sends can be resent;
// no background worker or API response has access to the original token.
export async function requestEmailVerification(
  userId: string,
  send = sendVerificationEmail,
) {
  const current = await accountIdentity(prisma, userId);
  if (current.emailVerified) return { verified: true };
  await configuration();
  if (!(await consumeAuthenticationLimit("verification", userId)))
    throw new AccountError("Too many requests. Please try again in 15 minutes.", 429);
  const token = randomBytes(32).toString("hex");
  const saved = await prisma.$transaction(async (tx) => {
    const user = await accountIdentity(tx, userId, true);
    if (user.emailVerified) return null;
    await tx.verificationToken.deleteMany({
      where: {
        identifier: { startsWith: prefix(user.id) },
        expires: { lte: new Date() },
      },
    });
    await tx.verificationToken.create({
      data: {
        identifier: identifier(user),
        token: hash(token),
        expires: new Date(Date.now() + 30 * 60000),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "user.email.verification.requested",
        entityType: "User",
        entityId: user.id,
      },
    });
    return { email: user.email };
  });
  if (!saved) return { verified: true };
  // Provider calls never hold a database lock. A lost response can leave a valid
  // email; resending does not revoke earlier links before successful verification.
  try {
    await send(saved.email, token);
  } catch {
    throw new AccountError(
      "The verification email could not be confirmed. Please try again.",
      503,
    );
  }
  return { verified: false };
}

export async function confirmEmailVerification(userId: string, input: unknown) {
  const { token } = confirmEmailInput.parse(input);
  if (!(await consumeAuthenticationLimit("verify", userId)))
    throw new AccountError("Too many attempts. Please try again in 15 minutes.", 429);
  return prisma.$transaction(async (tx) => {
    const user = await accountIdentity(tx, userId, true);
    if (user.emailVerified) return { verified: true };
    const saved = await tx.verificationToken.findUnique({
      where: { token: hash(token) },
    });
    if (!saved || saved.identifier !== identifier(user) || saved.expires <= new Date())
      throw new AccountError(
        "This link is invalid or expired. Sign in to the account that requested it, or request a new email.",
      );
    await tx.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
    await tx.verificationToken.deleteMany({
      where: { identifier: { startsWith: prefix(user.id) } },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "user.email.verified",
        entityType: "User",
        entityId: user.id,
        afterJson: { method: "email-link", passwordChanged: false, rolesChanged: false },
      },
    });
    return { verified: true };
  });
}
