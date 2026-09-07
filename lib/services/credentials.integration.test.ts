import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BOOTSTRAP_ADMIN_EMAIL } from "@/lib/domain/credentials";
import { changeUserCredentials, CredentialsError } from "./credentials";

const suffix = randomUUID().slice(0, 8);

describe("changeUserCredentials", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rotates email and password and clears mustChangeCredentials", async () => {
    const tempPassword = `Temp-Pass-${suffix}-xx`;
    const user = await prisma.user.create({
      data: {
        email: `bootstrap-${suffix}@detergentsdelivered.com`,
        name: "Bootstrap test",
        passwordHash: await bcrypt.hash(tempPassword, 12),
        mustChangeCredentials: true,
      },
    });

    const updated = await changeUserCredentials({
      userId: user.id,
      newEmail: `owner-${suffix}@detergentsdelivered.com`,
      newPassword: "Replacement-Pass-2026!",
      confirmPassword: "Replacement-Pass-2026!",
    });

    expect(updated.email).toBe(`owner-${suffix}@detergentsdelivered.com`);
    expect(updated.mustChangeCredentials).toBe(false);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).toBeTruthy();
    expect(stored.passwordHash).not.toBe(tempPassword);
    expect(await bcrypt.compare("Replacement-Pass-2026!", stored.passwordHash!)).toBe(
      true,
    );
    expect(await bcrypt.compare(tempPassword, stored.passwordHash!)).toBe(false);
  });

  it("rejects reuse of the current temp password and the bootstrap email", async () => {
    const tempPassword = "ChangeMe-Now-DD-2026!";
    const user = await prisma.user.create({
      data: {
        email: BOOTSTRAP_ADMIN_EMAIL.replace("@", `+${suffix}@`),
        passwordHash: await bcrypt.hash(tempPassword, 12),
        mustChangeCredentials: true,
      },
    });

    await expect(
      changeUserCredentials({
        userId: user.id,
        newEmail: "someone@example.com",
        newPassword: tempPassword,
        confirmPassword: tempPassword,
      }),
    ).rejects.toBeInstanceOf(CredentialsError);

    await expect(
      changeUserCredentials({
        userId: user.id,
        newEmail: BOOTSTRAP_ADMIN_EMAIL,
        newPassword: "A-different-long-password",
        confirmPassword: "A-different-long-password",
      }),
    ).rejects.toBeInstanceOf(CredentialsError);
  });

  it("does not allow a second change after the flag is cleared", async () => {
    const user = await prisma.user.create({
      data: {
        email: `done-${suffix}@detergentsdelivered.com`,
        passwordHash: await bcrypt.hash("Already-Rotated-Pass!", 12),
        mustChangeCredentials: false,
      },
    });

    await expect(
      changeUserCredentials({
        userId: user.id,
        newEmail: `done-2-${suffix}@detergentsdelivered.com`,
        newPassword: "Another-Long-Password",
        confirmPassword: "Another-Long-Password",
      }),
    ).rejects.toThrow(/not required/i);
  });
});
