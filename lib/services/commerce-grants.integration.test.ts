import "@/tests/integration-guard";
import { randomUUID, createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  issueCommerceGrant,
  listCommerceGrants,
  authorizeCommerceGrant,
  revokeCommerceGrant,
} from "./commerce-grants";
import { commerceGateway, machineCatalog } from "./commerce-gateway";
const users: string[] = [];
let one: string, two: string, customerOne: string, customerTwo: string;
beforeAll(async () => {
  const role = await prisma.role.upsert({
    where: { code: "CUSTOMER" },
    update: {},
    create: { code: "CUSTOMER", name: "Customer" },
  });
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({
      data: {
        email: `commerce-grant-${randomUUID()}@example.test`,
        emailVerified: new Date(),
        userRoles: { create: { roleId: role.id } },
        customer: { create: { firstName: "Synthetic gateway" } },
      },
      include: { customer: true },
    });
    users.push(user.id);
    if (!i) customerOne = user.customer!.id;
    else customerTwo = user.customer!.id;
  }
  [one, two] = users;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: users } },
    data: { deletedAt: new Date() },
  });
  await prisma.$disconnect();
});
const input = () => ({
  requestKey: randomUUID(),
  label: "Synthetic application",
  scopes: ["orders.read"],
  days: 1,
  consentVersion: "commerce-delegation-v1",
  confirmed: true,
});
it("issues one secret across concurrent retries and preserves hashed immutable consent", async () => {
  const payload = input(),
    results = await Promise.all([
      issueCommerceGrant(one, payload),
      issueCommerceGrant(one, payload),
    ]);
  expect(results[0].id).toBe(results[1].id);
  expect(results.filter((r) => r.token)).toHaveLength(1);
  const issued = results.find((r) => r.token)!;
  const grant = await prisma.commerceGrant.findUniqueOrThrow({
    where: { id: issued.id },
  });
  expect(grant.tokenHash).toBe(createHash("sha256").update(issued.token!).digest("hex"));
  const audit = await prisma.auditLog.findMany({ where: { entityId: issued.id } });
  expect(
    JSON.stringify({ grant, audit, listing: await listCommerceGrants(one) }),
  ).not.toContain(issued.token);
  await expect(
    prisma.commerceGrant.update({
      where: { id: issued.id },
      data: { scopes: ["quotes.create"] },
    }),
  ).rejects.toThrow();
  await expect(
    issueCommerceGrant(one, { ...payload, label: "Changed permissions" }),
  ).rejects.toMatchObject({ status: 409 });
  await revokeCommerceGrant(one, { id: issued.id });
});
it("isolates households and scopes, supports revocation and rejects non-bearer or wrong-environment access", async () => {
  const grant = await issueCommerceGrant(one, input()),
    header = `Bearer ${grant.token}`;
  const owned = await prisma.order.create({
    data: { customerId: customerOne, number: "GATEWAY-" + randomUUID(), totalCents: 100 },
  });
  const other = await prisma.order.create({
    data: { customerId: customerTwo, number: "OTHER-" + randomUUID(), totalCents: 200 },
  });
  const result = await commerceGateway(header, { action: "orders.list" });
  expect(JSON.stringify(result)).toContain(owned.id);
  expect(JSON.stringify(result)).not.toContain(other.id);
  await expect(
    commerceGateway(header, { action: "rewards.balance" }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(authorizeCommerceGrant(null, "orders.read")).rejects.toMatchObject({
    status: 401,
  });
  await expect(revokeCommerceGrant(two, { id: grant.id })).rejects.toMatchObject({
    status: 404,
  });
  vi.stubEnv("APP_ENV", "production");
  await expect(authorizeCommerceGrant(header, "orders.read")).rejects.toMatchObject({
    status: 401,
  });
  vi.unstubAllEnvs();
  await revokeCommerceGrant(one, { id: grant.id });
  await revokeCommerceGrant(one, { id: grant.id });
  await expect(authorizeCommerceGrant(header, "orders.read")).rejects.toMatchObject({
    status: 401,
  });
  expect(
    await prisma.auditLog.count({
      where: { entityId: grant.id, action: "commerce.grant.revoked" },
    }),
  ).toBe(1);
});
it("ends access after credential rotation or expiry and limits concurrent requests", async () => {
  const grant = await issueCommerceGrant(one, input()),
    header = `Bearer ${grant.token}`;
  await prisma.commerceGrant.update({
    where: { id: grant.id },
    data: { windowStartedAt: new Date(), requestCount: 59 },
  });
  const concurrent = await Promise.allSettled([
    authorizeCommerceGrant(header, "orders.read"),
    authorizeCommerceGrant(header, "orders.read"),
  ]);
  expect(concurrent.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (concurrent.find((r) => r.status === "rejected") as PromiseRejectedResult).reason
      .status,
  ).toBe(429);
  await prisma.user.update({
    where: { id: one },
    data: { sessionVersion: { increment: 1 } },
  });
  await expect(authorizeCommerceGrant(header, "orders.read")).rejects.toMatchObject({
    status: 401,
  });
  expect((await listCommerceGrants(one)).find((g) => g.id === grant.id)?.active).toBe(
    false,
  );
  await revokeCommerceGrant(one, { id: grant.id });
  const next = await issueCommerceGrant(one, input());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.now() + 2 * 86_400_000));
  await expect(
    authorizeCommerceGrant(`Bearer ${next.token}`, "orders.read"),
  ).rejects.toMatchObject({ status: 401 });
  vi.useRealTimers();
  await revokeCommerceGrant(one, { id: next.id });
});
it("rolls back a connection when its audit fails and exposes only published catalog fields", async () => {
  const payload = input();
  await prisma.$executeRawUnsafe(
    "ALTER TABLE \"AuditLog\" ADD CONSTRAINT dd_grant_audit CHECK (action <> 'commerce.grant.created') NOT VALID",
  );
  try {
    await expect(issueCommerceGrant(one, payload)).rejects.toThrow();
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DROP CONSTRAINT dd_grant_audit',
    );
  }
  const grant = await issueCommerceGrant(one, payload);
  expect(grant.token).toBeTruthy();
  await revokeCommerceGrant(one, { id: grant.id });
  const slug = "gateway-" + randomUUID();
  const product = await prisma.product.create({
    data: {
      name: slug,
      slug,
      brand: "Synthetic",
      isActive: true,
      websiteVisible: true,
      variants: {
        create: {
          name: "Bucket",
          sku: slug,
          isActive: true,
          websiteVisible: true,
          prices: { create: { kind: "RETAIL", amountCents: 1000, startsAt: new Date() } },
          inventoryBalance: { create: { onHandQty: 3 } },
        },
      },
    },
    include: { variants: true },
  });
  expect(await machineCatalog({ q: slug })).toMatchObject({
    products: [{ id: product.variants[0].id, unitPriceCents: 1000, inStock: true }],
  });
  expect(JSON.stringify(await machineCatalog({ q: slug }))).not.toMatch(
    /inventoryBalance|onHandQty|reservedQty|storageKey|taxCategory/,
  );
  await prisma.product.update({
    where: { id: product.id },
    data: { websiteVisible: false },
  });
  expect((await machineCatalog({ q: slug })).products).toHaveLength(0);
});
