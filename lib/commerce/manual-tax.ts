import type { CheckoutAttempt, ManualCheckoutSettlement } from "@prisma/client";
import { AccountError } from "@/lib/domain/account";
import { readCommerce } from "./runtime";
import { verifyStripeSetup } from "./stripe";
import type { CheckoutSnapshot } from "./domain";
export async function confirmManualTax(
  a: CheckoutAttempt,
  receipt: ManualCheckoutSettlement,
  recoveredId?: string,
) {
  const c = await readCommerce(true),
    s = a.snapshot as unknown as CheckoutSnapshot;
  if (
    c.accountId !== a.stripeAccountId ||
    c.live !== a.livemode ||
    receipt.accountId !== c.accountId ||
    receipt.livemode !== c.live
  )
    throw new AccountError("Manual tax account changed.", 409);
  const stripe = await verifyStripeSetup(s.address.region, c);
  const id = receipt.taxTransactionId ?? recoveredId;
  if (
    !id &&
    (!receipt.submittedAt || Date.now() - receipt.submittedAt.getTime() > 23 * 3600000)
  )
    throw new AccountError(
      "Find the existing tax transaction before retrying. Its safe creation retry period ended.",
      409,
    );
  const reference = `dd-manual:${receipt.id}`;
  const options = { timeout: 8000, maxNetworkRetries: 0 };
  const transaction = id
    ? await stripe.tax.transactions.retrieve(id, { expand: ["line_items"] }, options)
    : await stripe.tax.transactions.createFromCalculation(
        {
          calculation: s.taxCalculationId,
          reference,
          posted_at: Math.floor(receipt.receivedAt.getTime() / 1000),
          metadata: {
            project: "detergents-delivered",
            checkoutId: a.id,
            manualSettlementId: receipt.id,
          },
          expand: ["line_items"],
        },
        { ...options, idempotencyKey: reference },
      );
  const address = transaction.customer_details.address;
  const lines = transaction.line_items;
  if (
    transaction.type !== "transaction" ||
    transaction.reversal ||
    transaction.reference !== reference ||
    transaction.metadata?.project !== "detergents-delivered" ||
    transaction.metadata?.checkoutId !== a.id ||
    transaction.metadata?.manualSettlementId !== receipt.id ||
    transaction.livemode !== c.live ||
    transaction.currency !== "usd" ||
    transaction.posted_at !== Math.floor(receipt.receivedAt.getTime() / 1000) ||
    !address ||
    address.country !== s.address.country ||
    address.state !== s.address.region ||
    address.postal_code !== s.address.postalCode ||
    address.line1 !== s.address.line1 ||
    (address.line2 ?? "") !== (s.address.line2 ?? "") ||
    address.city !== s.address.city ||
    !lines ||
    lines.has_more ||
    lines.data.length !== s.lines.length ||
    new Set(lines.data.map((l) => l.reference)).size !== s.lines.length ||
    (transaction.shipping_cost &&
      (transaction.shipping_cost.amount !== 0 ||
        transaction.shipping_cost.amount_tax !== 0))
  )
    throw new AccountError("Manual tax transaction evidence needs review.", 409);
  const taxLines = lines.data.map((l) => {
    const expected = s.lines.find((v) => v.variantId === l.reference);
    if (
      !expected ||
      l.livemode !== c.live ||
      l.type !== "transaction" ||
      l.reversal ||
      l.quantity !== 1 ||
      l.tax_behavior !== "exclusive" ||
      l.tax_code !== expected.taxCode ||
      l.amount !== expected.netCents ||
      !Number.isSafeInteger(l.amount_tax) ||
      l.amount_tax < 0
    )
      throw new AccountError("Manual tax line does not match the original quote.", 409);
    return { variantId: l.reference, netCents: l.amount, taxCents: l.amount_tax };
  });
  if (
    taxLines.reduce((sum, l) => sum + l.taxCents, 0) !== s.taxCents ||
    taxLines.reduce((sum, l) => sum + l.netCents + l.taxCents, 0) !== receipt.amountCents
  )
    throw new AccountError("Manual tax totals changed.", 409);
  return {
    taxTransactionId: transaction.id,
    taxLines,
    accountId: c.accountId,
    livemode: c.live,
    reference,
    postedAt: transaction.posted_at,
  };
}
