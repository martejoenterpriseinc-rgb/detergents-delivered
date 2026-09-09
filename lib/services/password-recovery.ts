import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import {
  accountEmailSchema,
  recoveryOrigin,
  resetPasswordSchema,
} from "@/lib/domain/customer-access";
import { consumeAuthenticationLimit } from "@/lib/services/authentication-throttle";
import { rejectTemporaryPassword } from "@/lib/services/customer-registration";
import { providerConfiguration } from "@/lib/integration-environment";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Authentication recovery is not configured.");
  return createHash("sha256").update(`password-recovery:v1:${secret}`).digest();
}
function encryptToken(token: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
function decryptToken(bytes: Uint8Array, context: string) {
  const data = Buffer.from(bytes);
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(
    "utf8",
  );
}

export function recoveryEmailConfiguration() {
  const { values } = providerConfiguration("email");
  const apiKey = values.EMAIL_API_KEY;
  const from = values.EMAIL_FROM;
  const match = from.match(/^(.*?)\s*<([^<>]+)>$/);
  const email = accountEmailSchema.safeParse(match?.[2] ?? from);
  if (values.EMAIL_PROVIDER !== "sendgrid" || !apiKey || !email.success)
    throw new AccountError(
      "Password recovery is temporarily unavailable. Please try again later.",
      503,
    );
  const origin = recoveryOrigin();
  encryptionKey();
  const allowed = values.EMAIL_ALLOWED_RECIPIENTS.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (process.env.APP_ENV !== "production" && !allowed.length)
    throw new AccountError(
      "Password recovery is temporarily unavailable. Please try again later.",
      503,
    );
  return {
    apiKey,
    from: { email: email.data, name: match?.[1]?.trim() || "Detergents Delivered" },
    origin,
    allowed,
  };
}

export async function requestPasswordRecovery(input: unknown, now = new Date()) {
  recoveryEmailConfiguration(); // Same failure for every visitor, including unknown emails.
  const email = accountEmailSchema.parse(input);
  if (!(await consumeAuthenticationLimit("recovery", email, now))) return;
  const token = randomBytes(32).toString("hex");
  const tokenHash = hash(token);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { email, deletedAt: null, passwordHash: { not: null } },
    });
    if (!user) return; // OAuth-only accounts recover through their provider.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (current.deletedAt || !current.passwordHash || current.email !== email) return;
    // A repeated request does not revoke an earlier delivered link. Successful
    // use revokes every outstanding link; throttling bounds concurrent requests.
    await tx.passwordRecovery.create({
      data: {
        userId: current.id,
        email,
        sessionVersion: current.sessionVersion,
        tokenHash,
        tokenCiphertext: encryptToken(token, `${current.id}:${email}:${tokenHash}`),
        expiresAt: new Date(now.getTime() + 30 * 60000),
        nextAttemptAt: now,
      },
    });
  });
}

export async function resetRecoveredPassword(input: unknown, now = new Date()) {
  const data = resetPasswordSchema.parse(input);
  if (!(await consumeAuthenticationLimit("reset", hash(data.token), now)))
    throw new AccountError("Too many attempts. Please try again in 15 minutes.", 429);
  rejectTemporaryPassword(data.password);
  const tokenHash = hash(data.token);
  const candidate = await prisma.passwordRecovery.findUnique({ where: { tokenHash } });
  const invalid = () =>
    new AccountError("This reset link is invalid or has expired. Request a new link.");
  if (!candidate || candidate.consumedAt || candidate.expiresAt <= now) throw invalid();
  const passwordHash = await bcrypt.hash(data.password, 12);
  await prisma.$transaction(
    async (tx) => {
      // All password mutations take the same user lock. Token consumption, password
      // replacement, and revocation commit together, including simultaneous submits.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: candidate.userId } });
      const recovery = await tx.passwordRecovery.findUnique({ where: { tokenHash } });
      const consumedAt = new Date(Math.max(now.getTime(), Date.now()));
      if (
        !user ||
        user.deletedAt ||
        !user.passwordHash ||
        !recovery ||
        recovery.consumedAt ||
        recovery.expiresAt <= consumedAt ||
        user.email !== recovery.email ||
        user.sessionVersion !== recovery.sessionVersion
      )
        throw invalid();
      if (await bcrypt.compare(data.password, user.passwordHash))
        throw new AccountError("Choose a different password.");
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
          passwordChangeFailures: 0,
          passwordChangeLockedUntil: null,
          // Bootstrap credential rotation remains required; recovery never grants access.
        },
      });
      await tx.passwordRecovery.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt, tokenCiphertext: null },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: "user.password.recovered",
          entityType: "User",
          entityId: user.id,
          afterJson: { sessionsRevoked: true },
        },
      });
    },
    { timeout: 15000 },
  );
}

export async function sendRecoveryEmail(email: string, token: string) {
  const config = recoveryEmailConfiguration();
  if (
    process.env.APP_ENV !== "production" &&
    !config.allowed.includes(email.toLowerCase())
  )
    throw new Error("Recipient is not enabled for non-production email.");
  const link = `${config.origin}/reset-password#token=${token}`;
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
      subject: "Reset your Detergents Delivered password",
      content: [
        {
          type: "text/plain",
          value: `Open this link to choose a new password:\n\n${link}\n\nThis link expires 30 minutes after your request and works once. If you did not request it, you can ignore this email. Your password has not changed.`,
        },
      ],
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
      },
    }),
  });
  if (response.status !== 202) throw new Error("Recovery email was not accepted.");
}

// Call after a request for prompt delivery and from the scheduled worker for
// retries after restarts. Claims are atomic and bounded; external calls are
// outside DB transactions. Only counters (never email/token/provider bodies) return.
export async function deliverRecoveryEmails(limit = 10, send = sendRecoveryEmail) {
  let accepted = 0;
  let failed = 0;
  const now = new Date();
  await prisma.authenticationThrottle.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 86400000) } },
  });
  await prisma.passwordRecovery.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 86400000) } },
  });
  await prisma.passwordRecovery.updateMany({
    where: { expiresAt: { lte: now }, tokenCiphertext: { not: null } },
    data: { tokenCiphertext: null },
  });
  for (let i = 0; i < Math.min(limit, 20); i++) {
    const claimed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PasswordRecovery"
        WHERE "deliveredAt" IS NULL AND "consumedAt" IS NULL AND "tokenCiphertext" IS NOT NULL
        AND "expiresAt" > NOW() AND "nextAttemptAt" <= NOW() AND attempts < 5
        AND ("leasedUntil" IS NULL OR "leasedUntil" < NOW())
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows[0]) return null;
      return tx.passwordRecovery.update({
        where: { id: rows[0].id },
        data: {
          leaseId: randomUUID(),
          leasedUntil: new Date(Date.now() + 60000),
          attempts: { increment: 1 },
        },
        include: {
          user: { select: { deletedAt: true, email: true, sessionVersion: true } },
        },
      });
    });
    if (!claimed) break;
    const claim = { id: claimed.id, leaseId: claimed.leaseId };
    if (
      claimed.user.deletedAt ||
      claimed.user.email !== claimed.email ||
      claimed.user.sessionVersion !== claimed.sessionVersion
    ) {
      await prisma.passwordRecovery.updateMany({
        where: claim,
        data: {
          consumedAt: new Date(),
          tokenCiphertext: null,
          leasedUntil: null,
          leaseId: null,
        },
      });
      continue;
    }
    try {
      const token = decryptToken(
        claimed.tokenCiphertext!,
        `${claimed.userId}:${claimed.email}:${claimed.tokenHash}`,
      );
      if (hash(token) !== claimed.tokenHash) throw new Error("Invalid recovery payload.");
      await send(claimed.email, token);
      await prisma.passwordRecovery.updateMany({
        where: claim,
        data: {
          deliveredAt: new Date(),
          tokenCiphertext: null,
          leasedUntil: null,
          leaseId: null,
        },
      });
      accepted++;
    } catch {
      await prisma.passwordRecovery.updateMany({
        where: claim,
        data: {
          nextAttemptAt: new Date(Date.now() + 60000 * 2 ** claimed.attempts),
          leasedUntil: null,
          leaseId: null,
          ...(claimed.attempts >= 5 ? { tokenCiphertext: null } : {}),
        },
      });
      failed++;
    }
  }
  return { accepted, failed };
}
