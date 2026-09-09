import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  changeAccountPassword,
  getCustomerAccount,
  getCustomerOrders,
  updateCustomerProfile,
  updateNotifications,
} from "./customer-account";
import {
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  replyToSupportTicket,
  supportKpis,
} from "./support";

const testUserIds: string[] = [];
async function customer() {
  const user = await prisma.user.create({
    data: {
      email: `account-${randomUUID()}@example.test`,
      passwordHash: await bcrypt.hash("Existing-Synthetic-Password", 4),
      customer: {
        create: {
          firstName: "Synthetic",
          phone: "+15555550100",
          addresses: {
            create: {
              line1: "1 Test Way",
              city: "Algonquin",
              region: "IL",
              postalCode: "60102",
            },
          },
        },
      },
    },
    include: { customer: true },
  });
  testUserIds.push(user.id);
  return user;
}
async function staff(code: "ADMIN" | "CPA" = "ADMIN") {
  const role = await prisma.role.upsert({
    where: { code },
    update: {},
    create: { code, name: code },
  });
  const user = await prisma.user.create({
    data: {
      email: `support-${randomUUID()}@example.test`,
      userRoles: { create: { roleId: role.id } },
    },
  });
  testUserIds.push(user.id);
  return user;
}
const problem = (orderId: string | null = null) => ({
  orderId,
  category: "Delivery",
  subject: "Synthetic delivery problem",
  message: "Please help with this synthetic order.",
  requestKey: randomUUID(),
});
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: testUserIds } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
describe("customer account and support (native PostgreSQL)", () => {
  it("persists only contact fields and preferences while preserving identity, dates, roles, and paid orders", async () => {
    const user = await customer();
    const c = user.customer!;
    const role = await prisma.role.upsert({
      where: { code: "SUPER_ADMIN" },
      update: {},
      create: { code: "SUPER_ADMIN", name: "Owner" },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const order = await prisma.order.create({
      data: { number: randomUUID(), customerId: c.id, status: "PAID", totalCents: 4384 },
    });
    await updateCustomerProfile(user.id, {
      firstName: "Changed",
      lastName: "Customer",
      phone: "+15555550101",
    });
    await updateNotifications(user.id, {
      emailNotifications: true,
      smsNotifications: true,
    });
    const account = await getCustomerAccount(user.id);
    expect(account).toMatchObject({
      firstName: "Changed",
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      customerCreatedAt: c.createdAt.toISOString(),
      emailNotifications: true,
      smsNotifications: true,
    });
    expect(
      await prisma.userRole.count({ where: { userId: user.id, roleId: role.id } }),
    ).toBe(1);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toEqual(order);
    const before = await prisma.user.findUnique({ where: { id: user.id } });
    await expect(
      updateCustomerProfile(user.id, {
        firstName: "Bad",
        lastName: "",
        phone: "",
        userId: "other",
        email: "changed@example.test",
      }),
    ).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toEqual(before);
    expect(
      await prisma.auditLog.count({
        where: { actorUserId: user.id, action: "customer.profile.updated" },
      }),
    ).toBe(1);
  });
  it("does not enable SMS without a contact number and rolls back on audit failure", async () => {
    const user = await customer();
    await updateCustomerProfile(user.id, {
      firstName: "Synthetic",
      lastName: "",
      phone: "",
    });
    await expect(
      updateNotifications(user.id, { emailNotifications: true, smsNotifications: true }),
    ).rejects.toThrow(/phone/);
    expect((await getCustomerAccount(user.id)).emailNotifications).toBe(false);
    // Fault injection in the isolated database, scoped to this synthetic actor only.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "AuditLog" ADD CONSTRAINT dd_account_audit_failure CHECK ("actorUserId" IS DISTINCT FROM '${user.id}') NOT VALID`,
    );
    try {
      await expect(
        updateCustomerProfile(user.id, {
          firstName: "Must rollback",
          lastName: "",
          phone: "",
        }),
      ).rejects.toThrow();
      expect((await getCustomerAccount(user.id)).firstName).toBe("Synthetic");
      await expect(createSupportTicket(user.id, problem())).rejects.toThrow();
      expect(
        await prisma.supportTicket.count({ where: { customerId: user.customer!.id } }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_account_audit_failure',
      );
    }
  });
  it("serializes phone removal against SMS opt-in", async () => {
    const user = await customer();
    const results = await Promise.allSettled([
      updateCustomerProfile(user.id, { firstName: "Synthetic", lastName: "", phone: "" }),
      updateNotifications(user.id, { emailNotifications: false, smsNotifications: true }),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const account = await getCustomerAccount(user.id);
    expect(account.smsNotifications && !account.phone).toBe(false);
  });
  it("keeps two customers sharing a ZIP isolated and denies non-support staff", async () => {
    const a = await customer();
    const b = await customer();
    const cpa = await staff("CPA");
    const order = await prisma.order.create({
      data: {
        number: randomUUID(),
        customerId: a.customer!.id,
        status: "PAID",
        totalCents: 1234,
      },
    });
    const ticket = await createSupportTicket(a.id, problem(order.id));
    expect(await getCustomerOrders(b.id)).toEqual([]);
    await expect(createSupportTicket(b.id, problem(order.id))).rejects.toMatchObject({
      status: 404,
    });
    await expect(getSupportTicket(b.id, ticket.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      replyToSupportTicket(b.id, ticket.id, {
        message: "Intrusion",
        version: 0,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(listSupportTickets(b.id, {}, true)).rejects.toMatchObject({
      status: 403,
    });
    await expect(getSupportTicket(cpa.id, ticket.id, true)).rejects.toMatchObject({
      status: 403,
    });
    expect((await listSupportTickets(a.id, { status: "ALL" })).total).toBe(1);
  });
  it("deduplicates concurrent tickets and replies, rejects changed retries and stale edits, and reopens customer replies", async () => {
    const user = await customer();
    const admin = await staff();
    const data = problem();
    const [a, b] = await Promise.all([
      createSupportTicket(user.id, data),
      createSupportTicket(user.id, data),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      createSupportTicket(user.id, { ...data, subject: "Changed request" }),
    ).rejects.toMatchObject({ status: 409 });
    const reply = {
      message: "We have resolved this synthetic issue.",
      status: "RESOLVED",
      version: 0,
      requestKey: randomUUID(),
    };
    await Promise.all([
      replyToSupportTicket(admin.id, a.id, reply, true),
      replyToSupportTicket(admin.id, a.id, reply, true),
    ]);
    const ticket = await getSupportTicket(user.id, a.id);
    expect(ticket.status).toBe("RESOLVED");
    expect(ticket.messages).toHaveLength(2);
    expect(ticket.version).toBe(1);
    await expect(
      replyToSupportTicket(admin.id, a.id, { ...reply, requestKey: randomUUID() }, true),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      replyToSupportTicket(user.id, a.id, { ...reply, version: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await replyToSupportTicket(user.id, a.id, {
      message: "I still need help.",
      version: 1,
      requestKey: randomUUID(),
    });
    expect((await getSupportTicket(user.id, a.id)).status).toBe("OPEN");
    const counts = await supportKpis(admin.id);
    expect(counts.OPEN).toBeGreaterThan(0);
    const filtered = await listSupportTickets(
      admin.id,
      { status: "OPEN", q: a.id, sort: "oldest" },
      true,
    );
    expect(filtered.total).toBe(1);
    expect(filtered.tickets[0].id).toBe(a.id);
    expect(
      await prisma.auditLog.count({
        where: { entityId: a.id, action: "support.ticket.created" },
      }),
    ).toBe(1);
  });
  it("verifies the current password, throttles attempts, and increments session version atomically", async () => {
    const user = await customer();
    const change = {
      currentPassword: "Wrong password",
      newPassword: "Replacement-Synthetic-Password",
      confirmPassword: "Replacement-Synthetic-Password",
    };
    for (let i = 0; i < 5; i++)
      await expect(changeAccountPassword(user.id, change)).rejects.toThrow(/incorrect/);
    await expect(
      changeAccountPassword(user.id, {
        ...change,
        currentPassword: "Existing-Synthetic-Password",
      }),
    ).rejects.toMatchObject({ status: 429 });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordChangeLockedUntil: new Date(Date.now() - 1000) },
    });
    await changeAccountPassword(user.id, {
      ...change,
      currentPassword: "Existing-Synthetic-Password",
    });
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.sessionVersion).toBe(1);
    expect(saved.passwordChangeFailures).toBe(0);
    expect(await bcrypt.compare(change.newPassword, saved.passwordHash!)).toBe(true);
    const audits = await prisma.auditLog.findMany({
      where: { actorUserId: user.id, action: "user.password.changed" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain("Password");
  });
  it("refuses deleted and bootstrap-gated actors without mutation", async () => {
    const user = await customer();
    await prisma.user.update({
      where: { id: user.id },
      data: { mustChangeCredentials: true },
    });
    await expect(
      updateNotifications(user.id, { emailNotifications: true, smsNotifications: false }),
    ).rejects.toMatchObject({ status: 403 });
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    await expect(createSupportTicket(user.id, problem())).rejects.toMatchObject({
      status: 401,
    });
  });
});
