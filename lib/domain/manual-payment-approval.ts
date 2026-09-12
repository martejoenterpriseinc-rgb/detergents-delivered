import { z } from "zod";
export const manualPaymentMethod = z.enum(["CASH", "ZELLE"]);
export const manualPaymentApprovalInput = z
  .object({
    customerId: z.string().min(1).max(100),
    requestKey: z.uuid(),
    method: manualPaymentMethod,
    version: z.number().int().min(0).max(1000000),
    enabled: z.boolean(),
    maxOrderCents: z.number().int().min(1).max(1000000),
    expiresAt: z.iso.datetime(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
