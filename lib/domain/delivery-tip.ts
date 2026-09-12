import { z } from "zod";
const common = { orderId: z.string().min(1).max(100), requestKey: z.uuid() };
export const deliveryTipInput = z.discriminatedUnion("choice", [
  z.object({ ...common, choice: z.literal("DECLINE") }).strict(),
  z
    .object({
      ...common,
      choice: z.literal("AMOUNT"),
      amountCents: z.number().int().min(50).max(50000),
    })
    .strict(),
  z
    .object({
      ...common,
      choice: z.literal("PERCENT"),
      percent: z.number().int().min(1).max(100),
    })
    .strict(),
]);
export function deliveryTipAmount(
  input: z.infer<typeof deliveryTipInput>,
  baseCents: number,
) {
  z.number().int().nonnegative().max(100000000).parse(baseCents);
  const amount =
    input.choice === "DECLINE"
      ? 0
      : input.choice === "AMOUNT"
        ? input.amountCents
        : Math.floor((baseCents * input.percent + 50) / 100);
  if (input.choice !== "DECLINE" && (amount < 50 || amount > 50000))
    throw Error("Choose a tip between $0.50 and $500.");
  return amount;
}
