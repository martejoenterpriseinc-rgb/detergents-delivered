import { prisma } from "../lib/prisma";
import { validateRuntimeConfig } from "../lib/runtime-config";
import { requireCommerce } from "../lib/commerce/config";
import { reconcileCheckout } from "../lib/commerce/checkout";
async function main() {
  validateRuntimeConfig(process.env);
  requireCommerce(true);
  const attempts = await prisma.checkoutAttempt.findMany({
    where: {
      state: { in: ["OPEN", "PROCESSING", "REVIEW"] },
      stripeSessionId: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });
  let completed = 0,
    unresolved = 0;
  for (const a of attempts) {
    try {
      await reconcileCheckout(a.id);
      completed++;
    } catch {
      unresolved++;
    }
  }
  console.log(JSON.stringify({ checked: attempts.length, completed, unresolved }));
  if (unresolved) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error(
      "Checkout reconciliation failed. No credentials or customer data logged.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
