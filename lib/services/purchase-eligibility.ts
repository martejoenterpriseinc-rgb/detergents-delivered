import { prisma } from "@/lib/prisma";
import { accountIdentity } from "./customer-account";
import { launchConfig } from "./launch";
import { zonePostalCodes } from "@/lib/domain/launch";

export async function purchaseEligibility(userId: string | null, zip: string) {
  if (!/^\d{5}$/.test(zip))
    return {
      areaAvailable: false,
      eligible: false,
      canPurchase: false,
      message: "Enter a five-digit ZIP code.",
    };
  const zones = await prisma.deliveryZone.findMany({ where: { isActive: true } });
  const matches = zones.filter((z) => zonePostalCodes(z.boundaryJson).includes(zip));
  if (matches.length !== 1)
    return {
      areaAvailable: false,
      eligible: false,
      canPurchase: false,
      message:
        "Purchasing is not available in this area. Contact us about future coverage.",
    };
  const base = { areaAvailable: true, eligible: false, canPurchase: false };
  if (!userId)
    return {
      ...base,
      message:
        "Your ZIP is in our delivery area. Sign in to your approved account to continue.",
    };
  const user = await accountIdentity(prisma, userId);
  if (
    !user.emailVerified ||
    !user.customer?.purchaseApprovedAt ||
    user.customer.deletedAt
  )
    return {
      ...base,
      message:
        "Your account must be verified and approved before purchasing. Contact support for help.",
    };
  const address = await prisma.address.findFirst({
    where: {
      customerId: user.customer.id,
      postalCode: zip,
      deliveryZoneId: matches[0].id,
      validatedAt: { not: null },
      validationSource: { not: null },
      country: "US",
      deletedAt: null,
    },
  });
  if (!address)
    return {
      ...base,
      message: "Add a validated delivery address in this zone before purchasing.",
    };
  const launch = await launchConfig();
  return {
    ...base,
    eligible: true,
    message: launch.enabled
      ? `Planned launch: ${launch.launchDate}. The first delivery window is ${launch.launchDate}–${launch.firstDeliveryBy}; exact dates will be confirmed after routes are reviewed. Ordering is not open yet.`
      : "Your account and delivery address are eligible. Ordering opens after payment and delivery booking are connected.",
  };
}
