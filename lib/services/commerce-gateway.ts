import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  authorizeCommerceGrant,
  validateCommerceGrant,
  type CommerceScope,
} from "./commerce-grants";
import { createQuote } from "@/lib/commerce/quote";
import { rewardBalance } from "./loyalty";
import { pickCurrentPrice } from "@/lib/prices";
import { availableQty } from "@/lib/domain/inventory";
const requestInput = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("orders.list"), cursor: z.string().max(100).optional() })
    .strict(),
  z.object({ action: z.literal("subscriptions.list") }).strict(),
  z.object({ action: z.literal("rewards.balance") }).strict(),
  z.object({ action: z.literal("addresses.list") }).strict(),
  z.object({ action: z.literal("quotes.create"), quote: z.unknown() }).strict(),
]);
const scopes: Record<z.infer<typeof requestInput>["action"], CommerceScope> = {
  "orders.list": "orders.read",
  "subscriptions.list": "subscriptions.read",
  "rewards.balance": "rewards.read",
  "addresses.list": "quotes.create",
  "quotes.create": "quotes.create",
};
export async function commerceGateway(header: string | null, raw: unknown) {
  const input = requestInput.parse(raw),
    identity = await authorizeCommerceGrant(header, scopes[input.action]);
  let data: unknown;
  if (input.action === "quotes.create") {
    const quote = await createQuote(identity.userId, input.quote, (tx) =>
      validateCommerceGrant(tx, identity),
    );
    data = {
      ...quote,
      lines: quote.lines.map((line) => ({
        variantId: line.variantId,
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        discountCents: line.discountCents,
        netCents: line.netCents,
      })),
      reviewUrl: `/checkout/review/${encodeURIComponent(quote.id)}`,
      paymentRequiresCustomer: true,
    };
  } else {
    data = await prisma.$transaction(async (tx) => {
      await validateCommerceGrant(tx, identity);
      if (input.action === "rewards.balance")
        return rewardBalance(tx, identity.customerId);
      if (input.action === "addresses.list")
        return tx.address.findMany({
          where: {
            customerId: identity.customerId,
            deletedAt: null,
            validatedAt: { not: null },
          },
          select: {
            id: true,
            line1: true,
            line2: true,
            city: true,
            region: true,
            postalCode: true,
            country: true,
          },
          orderBy: { id: "asc" },
          take: 50,
        });
      if (input.action === "subscriptions.list")
        return tx.subscription.findMany({
          where: { customerId: identity.customerId },
          select: {
            id: true,
            status: true,
            cadenceDays: true,
            cadenceMonths: true,
            nextOrderAt: true,
            cycleNumber: true,
            items: { select: { productVariantId: true, quantity: true } },
          },
          orderBy: { id: "asc" },
          take: 100,
        });
      const rows = await tx.order.findMany({
        where: {
          customerId: identity.customerId,
          ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        },
        select: {
          id: true,
          number: true,
          status: true,
          placedAt: true,
          createdAt: true,
          totalCents: true,
          currency: true,
          items: { select: { nameSnapshot: true, quantity: true } },
          routeStops: {
            where: {
              route: { status: { notIn: ["DRAFT", "CANCELLED"] } },
              address: { customerId: identity.customerId },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { plannedArriveAt: true, completedAt: true },
          },
        },
        orderBy: { id: "asc" },
        take: 51,
      });
      return {
        orders: rows.slice(0, 50),
        nextCursor: rows.length > 50 ? rows[49].id : null,
      };
    });
  }
  await validateCommerceGrant(prisma, identity);
  return { version: "1", action: input.action, data };
}
export async function machineCatalog(raw: unknown) {
  const input = z
    .object({ cursor: z.string().max(100).optional(), q: z.string().max(100).optional() })
    .strict()
    .parse(raw);
  const variants = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      websiteVisible: true,
      product: { deletedAt: null, isActive: true, websiteVisible: true },
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      ...(input.q
        ? {
            OR: [
              { name: { contains: input.q, mode: "insensitive" as const } },
              { sku: { contains: input.q, mode: "insensitive" as const } },
              { product: { name: { contains: input.q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: { product: true, prices: true, inventoryBalance: true },
    orderBy: { id: "asc" },
    take: 51,
  });
  return {
    version: "1",
    products: variants.slice(0, 50).map((v) => {
      const price =
        pickCurrentPrice(v.prices, new Date(), "SALE") ?? pickCurrentPrice(v.prices);
      const available = v.inventoryBalance ? availableQty(v.inventoryBalance) > 0 : false;
      return {
        id: v.id,
        name: v.product.name,
        variant: v.name,
        sku: v.sku,
        brand: v.product.brand,
        unitPriceCents: price?.amountCents ?? null,
        currency: price?.currency ?? "USD",
        inStock: available,
        productUrl: `/shop/${encodeURIComponent(v.product.slug)}`,
      };
    }),
    nextCursor: variants.length > 50 ? variants[49].id : null,
    purchaseRequiresQuote: true,
    coverageUrl: "/api/delivery-coverage",
  };
}
