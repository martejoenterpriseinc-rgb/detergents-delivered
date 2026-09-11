import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  prepareQuickbooksReceiptDraft,
  cancelQuickbooksReceiptDraft,
  listQuickbooksReceiptDrafts,
} from "@/lib/services/quickbooks-receipt-drafts";
export async function GET(request: Request) {
  try {
    return accountJson(
      await listQuickbooksReceiptDrafts(
        await accountRequest(request),
        new URL(request.url).searchParams.get("cursor") ?? undefined,
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request),
      body = z
        .discriminatedUnion("action", [
          z
            .object({
              action: z.literal("prepare"),
              requestKey: z.uuid(),
              orderId: z.string().min(1).max(100),
              adjustmentId: z.string().min(1).max(100).optional(),
              confirmed: z.literal(true),
            })
            .strict(),
          z
            .object({
              action: z.literal("cancel"),
              id: z.string().min(1).max(100),
              confirmed: z.literal(true),
            })
            .strict(),
        ])
        .parse(await readAccountJson(request));
    if (body.action === "cancel")
      return accountJson(await cancelQuickbooksReceiptDraft(actor, body.id));
    return accountJson(
      await prepareQuickbooksReceiptDraft(actor, {
        requestKey: body.requestKey,
        orderId: body.orderId,
        ...(body.adjustmentId ? { adjustmentId: body.adjustmentId } : {}),
        confirmed: true,
      }),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
