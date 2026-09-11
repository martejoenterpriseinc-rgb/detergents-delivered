import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  listQuickbooksCostJournals,
  prepareQuickbooksCostJournal,
  cancelQuickbooksCostJournal,
  submitQuickbooksCostJournal,
  reconcileQuickbooksCostJournal,
} from "@/lib/services/quickbooks-cost-journals";
export async function GET(request: Request) {
  try {
    return accountJson(
      await listQuickbooksCostJournals(
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
            orderId: z.string().min(1).max(100),
            returnId: z.string().min(1).max(100).optional(),
            confirmed: z.literal(true),
          })
          .strict(),
        z
          .object({
            action: z.enum(["cancel", "submit", "reconcile"]),
            id: z.string().regex(/^qbc_[a-f0-9]{64}$/),
            confirmed: z.literal(true),
          })
          .strict(),
      ])
      .parse(raw);
    if (input.action === "prepare") {
      const { action, ...data } = input;
      void action;
      return accountJson(await prepareQuickbooksCostJournal(actor, data));
    }
    return accountJson(
      input.action === "cancel"
        ? await cancelQuickbooksCostJournal(actor, input.id)
        : input.action === "submit"
          ? await submitQuickbooksCostJournal(actor, input.id)
          : await reconcileQuickbooksCostJournal(actor, input.id),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
