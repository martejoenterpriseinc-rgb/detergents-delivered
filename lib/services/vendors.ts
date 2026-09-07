import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export class VendorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorError";
  }
}

export type VendorFields = {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export async function createVendor(input: VendorFields, actorUserId?: string) {
  const vendor = await prisma.vendor.create({
    data: {
      name: input.name,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      country: input.country ?? "US",
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      isActive: input.isActive ?? true,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "vendor.create",
    entityType: "Vendor",
    entityId: vendor.id,
    afterJson: { name: vendor.name },
  });
  return vendor;
}

export async function updateVendor(id: string, input: Partial<VendorFields>, actorUserId?: string) {
  const existing = await prisma.vendor.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new VendorError("vendor not found");
  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      name: input.name,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      country: input.country ?? undefined,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      isActive: input.isActive,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "vendor.update",
    entityType: "Vendor",
    entityId: id,
    beforeJson: { name: existing.name },
    afterJson: { name: vendor.name },
  });
  return vendor;
}

export async function deleteVendor(id: string, actorUserId?: string) {
  const existing = await prisma.vendor.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new VendorError("vendor not found");
  const vendor = await prisma.vendor.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "vendor.delete",
    entityType: "Vendor",
    entityId: id,
  });
  return vendor;
}

export async function upsertVendorProduct(
  input: {
    vendorId: string;
    productVariantId: string;
    vendorSku?: string | null;
    unitCostCents?: number | null;
  },
  actorUserId?: string,
) {
  const link = await prisma.vendorProduct.upsert({
    where: {
      vendorId_productVariantId: {
        vendorId: input.vendorId,
        productVariantId: input.productVariantId,
      },
    },
    update: {
      vendorSku: input.vendorSku,
      unitCostCents: input.unitCostCents,
    },
    create: {
      vendorId: input.vendorId,
      productVariantId: input.productVariantId,
      vendorSku: input.vendorSku,
      unitCostCents: input.unitCostCents,
    },
  });
  await writeAuditLog(prisma, {
    actorUserId,
    action: "vendor_product.upsert",
    entityType: "VendorProduct",
    entityId: link.id,
    afterJson: link as unknown as Prisma.InputJsonValue,
  });
  return link;
}
