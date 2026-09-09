import { prisma } from "@/lib/prisma";
import type { RoleCode } from "@/lib/domain/authz";

export async function loadSessionAccount(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      email: true,
      sessionVersion: true,
      mustChangeCredentials: true,
      userRoles: { select: { role: { select: { code: true } } } },
    },
  });
  if (!user) return null;
  return {
    email: user.email,
    sessionVersion: user.sessionVersion,
    mustChangeCredentials: user.mustChangeCredentials,
    roles: user.userRoles.map((row) => row.role.code as RoleCode),
  };
}
