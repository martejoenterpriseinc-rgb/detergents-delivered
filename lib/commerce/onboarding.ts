import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { customerIdentity, accountIdentity } from "@/lib/services/customer-account";
import { loyaltyAdmin } from "@/lib/services/loyalty";
import { AccountError } from "@/lib/domain/account";
import { zonePostalCodes } from "@/lib/domain/launch";
export async function saveDeliveryAddress(userId: string, raw: unknown) {
  const data = z
    .object({
      line1: z.string().trim().min(4).max(150),
      line2: z.string().trim().max(150).default(""),
      city: z.string().trim().min(2).max(100),
      region: z.literal("IL"),
      postalCode: z.string().regex(/^\d{5}$/),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    const { customer } = await customerIdentity(tx, userId, true);
    const zones = (await tx.deliveryZone.findMany({ where: { isActive: true } })).filter(
      (z) => zonePostalCodes(z.boundaryJson).includes(data.postalCode),
    );
    if (zones.length !== 1)
      throw new AccountError("This ZIP is not in an approved delivery area.", 409);
    if (
      (await tx.address.count({
        where: {
          customerId: customer.id,
          deletedAt: null,
          validationSource: { equals: null },
        },
      })) >= 5
    )
      throw new AccountError(
        "You already have addresses awaiting review. Contact support.",
        409,
      );
    const address = await tx.address.create({
      data: {
        ...data,
        customerId: customer.id,
        deliveryZoneId: zones[0].id,
        country: "US",
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "address.review.requested",
        entityType: "Address",
        entityId: address.id,
      },
    });
    return { id: address.id, status: "PENDING_REVIEW" };
  });
}
export async function approveDeliveryAddress(adminId: string, raw: unknown) {
  const input = z
    .object({
      addressId: z.string().min(1).max(100),
      version: z.iso.datetime(),
      lat: z.number().min(36.9).max(42.6),
      lng: z.number().min(-91.6).max(-87.4),
      evidence: z.string().trim().min(15).max(500),
      confirmReviewed: z.literal(true),
    })
    .strict()
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await loyaltyAdmin(tx, adminId);
    const before = await tx.address.findUnique({
      where: { id: input.addressId },
      include: { customer: true },
    });
    if (!before || before.deletedAt || before.customer.deletedAt)
      throw new AccountError("Address not found.", 404);
    await accountIdentity(tx, before.customer.userId, true);
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${before.customerId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Address" WHERE id = ${before.id} FOR UPDATE`;
    const address = await tx.address.findUniqueOrThrow({ where: { id: before.id } });
    if (address.updatedAt.toISOString() !== input.version || address.validatedAt)
      throw new AccountError("Address changed or already reviewed. Refresh.", 409);
    const zones = (await tx.deliveryZone.findMany({ where: { isActive: true } })).filter(
      (z) => zonePostalCodes(z.boundaryJson).includes(address.postalCode),
    );
    if (zones.length !== 1 || address.country !== "US" || address.region !== "IL")
      throw new AccountError("Address is outside configured delivery areas.", 409);
    await tx.address.update({
      where: { id: address.id },
      data: {
        deliveryZoneId: zones[0].id,
        validatedAt: new Date(),
        validationSource: "STAFF_REVIEW",
        lat: input.lat,
        lng: input.lng,
      },
    });
    await tx.customer.update({
      where: { id: address.customerId },
      data: { purchaseApprovedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: adminId,
        action: "address.delivery.approved",
        entityType: "Address",
        entityId: address.id,
        afterJson: {
          evidence: input.evidence,
          lat: input.lat,
          lng: input.lng,
          source: "STAFF_REVIEW",
        },
      },
    });
    return { status: "APPROVED" };
  });
}
