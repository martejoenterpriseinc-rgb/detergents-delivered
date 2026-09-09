import { prisma } from "@/lib/prisma";
import {
  eligiblePostalCodes,
  parsePostalLocation,
  type DeliveryCoverage,
} from "@/lib/domain/delivery-coverage";
async function activeCodes() {
  return eligiblePostalCodes(
    await prisma.deliveryZone.findMany({
      where: { isActive: true },
      select: { boundaryJson: true },
    }),
  );
}
export async function getDeliveryCoverage(): Promise<DeliveryCoverage> {
  const postalCodes = await activeCodes();
  const locations = await prisma.postalLocation.findMany({
    where: {
      postalCode: { in: postalCodes },
      latitude: { not: null },
      longitude: { not: null },
    },
  });
  return {
    postalCodes,
    points: locations.map((p) => ({
      postalCode: p.postalCode,
      latitude: p.latitude!,
      longitude: p.longitude!,
      placeName: p.placeName ?? p.postalCode,
    })),
  };
}
// A bounded, leased batch runs after the public response. No customer addresses leave the app.
export async function refreshCoverageLocations(fetcher: typeof fetch = fetch) {
  const codes = await activeCodes();
  if (!codes.length) return;
  await prisma.postalLocation.createMany({
    data: codes.map((postalCode) => ({ postalCode, retryAt: new Date(0) })),
    skipDuplicates: true,
  });
  const pending = await prisma.postalLocation.findMany({
    where: { postalCode: { in: codes }, retryAt: { lte: new Date() } },
    orderBy: { retryAt: "asc" },
    take: 8,
  });
  for (let i = 0; i < pending.length; i += 4) {
    await Promise.allSettled(
      pending.slice(i, i + 4).map(async (item) => {
        const claim = await prisma.postalLocation.updateMany({
          where: { postalCode: item.postalCode, retryAt: { lte: new Date() } },
          data: { retryAt: new Date(Date.now() + 120_000) },
        });
        if (!claim.count) return;
        try {
          const response = await fetcher(
            `https://api.zippopotam.us/us/${item.postalCode}`,
            {
              signal: AbortSignal.timeout(3000),
              redirect: "error",
              headers: {
                Accept: "application/json",
                "User-Agent": "DetergentsDelivered-Coverage/1.0",
              },
            },
          );
          if (!response.ok) throw new Error("lookup");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("empty");
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 64000) {
              await reader.cancel();
              throw new Error("large");
            }
            chunks.push(value);
          }
          const point = parsePostalLocation(
            item.postalCode,
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          );
          if (!point) throw new Error("invalid");
          await prisma.postalLocation.update({
            where: { postalCode: item.postalCode },
            data: { ...point, retryAt: new Date(Date.now() + 90 * 86400000) },
          });
        } catch {
          // Keep a previously verified center when a provider is temporarily unavailable.
          await prisma.postalLocation.update({
            where: { postalCode: item.postalCode },
            data: { retryAt: new Date(Date.now() + 3600000) },
          });
        }
      }),
    );
  }
}
