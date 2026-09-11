import type { Prisma } from "@prisma/client";
import { integrationEnvironment } from "@/lib/integration-environment";
import { smsPhone } from "@/lib/domain/delivery-sms";
export async function enqueueDeliveryText(
  tx: Prisma.TransactionClient,
  orderId: string,
  kind: "OUT_FOR_DELIVERY" | "DELIVERED",
) {
  const environment = integrationEnvironment();
  if (!environment) return;
  const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { customer: { include: { user: true } } },
    }),
    customer = order.customer;
  if (
    order.status !== kind ||
    !customer.smsNotifications ||
    customer.deletedAt ||
    customer.user.deletedAt ||
    !customer.user.emailVerified ||
    customer.user.mustChangeCredentials
  )
    return;
  const consent = await tx.smsConsent.findFirst({
    where: { customerId: customer.id, environment, state: "ACTIVE" },
  });
  if (!consent || smsPhone(customer.phone ?? "") !== consent.phone) return;
  await tx.smsDelivery.upsert({
    where: { orderId_kind: { orderId, kind } },
    update: {},
    create: {
      orderId,
      consentId: consent.id,
      environment,
      accountSid: consent.accountSid,
      sender: consent.sender,
      phone: consent.phone,
      kind,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
}
