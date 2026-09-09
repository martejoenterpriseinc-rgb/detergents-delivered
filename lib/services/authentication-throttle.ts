import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";

const LIMITS = {
  login: [1000, 20],
  register: [50, 3],
  recovery: [200, 3],
  reset: [300, 10],
} as const;

// Database-backed fixed windows work across application instances. The global
// limit bounds both credential hashing work and the number of identifier rows.
// No raw emails, passwords, tokens, or untrusted forwarded IPs are persisted.
export async function consumeAuthenticationLimit(
  purpose: keyof typeof LIMITS,
  identifier: string,
  now = new Date(),
) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Authentication is not configured.");
  const window = Math.floor(now.getTime() / 900000);
  const expiresAt = new Date((window + 1) * 900000);
  const key = (value: string) =>
    createHmac("sha256", secret)
      .update(`auth:${purpose}:${window}:${value}`)
      .digest("hex");
  const [globalLimit, personalLimit] = LIMITS[purpose];
  const global = await prisma.authenticationThrottle.upsert({
    where: { key: key("global") },
    create: { key: key("global"), hits: 1, expiresAt },
    update: { hits: { increment: 1 } },
  });
  if (global.hits === 1) {
    await prisma.authenticationThrottle.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 86400000) } },
    });
  }
  if (global.hits > globalLimit) return false;
  const personal = await prisma.authenticationThrottle.upsert({
    where: { key: key(`identity:${identifier.toLowerCase()}`) },
    create: { key: key(`identity:${identifier.toLowerCase()}`), hits: 1, expiresAt },
    update: { hits: { increment: 1 } },
  });
  return personal.hits <= personalLimit;
}
