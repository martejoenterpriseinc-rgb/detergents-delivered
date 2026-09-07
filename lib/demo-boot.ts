import { canSeedDemoCatalog, shouldSeedDemoCatalogOnBoot } from "@/lib/demo-mode";
import { countVisibleShopProducts, seedDemoCatalog } from "../prisma/demo-catalog";

let seedInFlight: Promise<void> | null = null;

export async function ensureDemoCatalogOnBoot() {
  if (!canSeedDemoCatalog()) {
    return { seeded: false, reason: "disabled" as const };
  }

  const { prisma } = await import("@/lib/prisma");
  const visible = await countVisibleShopProducts(prisma);
  if (!shouldSeedDemoCatalogOnBoot(visible) && visible > 0) {
    return { seeded: false, reason: "already-populated" as const, visible };
  }
  if (visible > 0) {
    return { seeded: false, reason: "already-populated" as const, visible };
  }

  if (!seedInFlight) {
    seedInFlight = seedDemoCatalog(prisma)
      .then(() => undefined)
      .finally(() => {
        seedInFlight = null;
      });
  }
  await seedInFlight;
  return { seeded: true, reason: "empty-catalog" as const };
}
