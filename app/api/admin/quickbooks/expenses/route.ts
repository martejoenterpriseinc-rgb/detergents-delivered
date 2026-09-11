import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  listQuickbooksExpenses,
  prepareQuickbooksExpense,
  cancelQuickbooksExpense,
  submitQuickbooksExpense,
  reconcileQuickbooksExpense,
} from "@/lib/services/quickbooks-expenses";
export async function GET(request: Request) {
  try {
    return accountJson(
      await listQuickbooksExpenses(
        await accountRequest(),
        new URL(request.url).searchParams.get("cursor") ?? undefined,
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request),
      raw = await readAccountJson(request);
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("prepare"),
            requestKey: z.uuid(),
            expenseId: z.string().min(1).max(100),
            paymentType: z.enum(["Cash", "CreditCard"]),
            confirmed: z.literal(true),
          })
          .strict(),
        z
          .object({
            action: z.enum(["cancel", "submit", "reconcile"]),
            id: z.string().regex(/^qbe_[a-f0-9]{64}$/),
            confirmed: z.literal(true),
          })
          .strict(),
      ])
      .parse(raw);
    if (input.action === "prepare") {
      const { action, ...data } = input;
      void action;
      return accountJson(await prepareQuickbooksExpense(actor, data));
    }
    return accountJson(
      input.action === "cancel"
        ? await cancelQuickbooksExpense(actor, input.id)
        : input.action === "submit"
          ? await submitQuickbooksExpense(actor, input.id)
          : await reconcileQuickbooksExpense(actor, input.id),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
