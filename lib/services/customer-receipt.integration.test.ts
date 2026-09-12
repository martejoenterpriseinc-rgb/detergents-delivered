import "@/tests/integration-guard";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { receiptFixture } from "@/tests/customer-receipt-fixture";
import { customerReceipt } from "./customer-receipt";
const fixtures: Awaited<ReturnType<typeof receiptFixture>>[] = [];
async function fixture(options: Parameters<typeof receiptFixture>[1] = {}) {
  const f = await receiptFixture(prisma, options);
  fixtures.push(f);
  return f;
}
afterAll(async () => {
  await prisma.user.updateMany({
    where: { id: { in: fixtures.map((f) => f.userId) } },
    data: { deletedAt: new Date() },
  });
  await prisma.product.updateMany({
    where: { id: { in: fixtures.map((f) => f.productId) } },
    data: { isActive: false, websiteVisible: false },
  });
  await prisma.$disconnect();
});
it("prints original item, address and payment amounts without exposing internal evidence or changing records", async () => {
  const f = await fixture();
  const before = await prisma.auditLog.count();
  const r = await customerReceipt(f.userId, f.checkoutId);
  expect(r).toMatchObject({
    testReceipt: true,
    subtotalCents: 3000,
    promotionCents: 300,
    rewardsCents: 600,
    taxCents: 168,
    totalCents: 2268,
    address: { line2: "Unit 2" },
    lines: [
      {
        name: "Original detergent bucket",
        sku: "ORIGINAL-SKU",
        taxCents: 168,
        totalCents: 2268,
      },
    ],
  });
  const text = JSON.stringify(r);
  expect(text).not.toMatch(
    /private-snapshot|private-tax|private-vehicle|pi_private|lat|lng|Current catalog/,
  );
  expect(await customerReceipt(f.userId, f.checkoutId)).toEqual(r);
  expect(await prisma.auditLog.count()).toBe(before);
  expect(await prisma.refundRequest.count({ where: { orderId: f.orderId } })).toBe(0);
});
it("denies other households, deleted users and required credential changes", async () => {
  const a = await fixture(),
    b = await fixture();
  await expect(customerReceipt(b.userId, a.checkoutId)).rejects.toMatchObject({
    status: 404,
  });
  await prisma.user.update({
    where: { id: a.userId },
    data: { mustChangeCredentials: true },
  });
  await expect(customerReceipt(a.userId, a.checkoutId)).rejects.toMatchObject({
    status: 403,
  });
  await prisma.user.update({ where: { id: a.userId }, data: { deletedAt: new Date() } });
  await expect(customerReceipt(a.userId, a.checkoutId)).rejects.toMatchObject({
    status: 401,
  });
});
it("rejects pending, inconsistent and unverified receipts while supporting verified zero-cash purchases", async () => {
  for (const options of [{ pending: true }, { badTotal: true }, { unverified: true }]) {
    const f = await fixture(options);
    await expect(customerReceipt(f.userId, f.checkoutId)).rejects.toMatchObject({
      status: 409,
    });
  }
  const f = await fixture({ zero: true });
  expect(await customerReceipt(f.userId, f.checkoutId)).toMatchObject({
    rewardsCents: 2700,
    taxCents: 0,
    totalCents: 0,
  });
});
