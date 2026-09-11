import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  quickbooksConnectionStatus,
  beginQuickbooksConnection,
  maintainQuickbooksConnection,
} from "@/lib/services/quickbooks-connection";
export async function GET() {
  try {
    return accountJson(await quickbooksConnectionStatus(await accountRequest()));
  } catch (error) {
    return accountFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request);
    const input = z
      .object({
        action: z.enum(["connect", "refresh", "disconnect"]),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(await readAccountJson(request));
    return accountJson(
      input.action === "connect"
        ? await beginQuickbooksConnection(actor)
        : await maintainQuickbooksConnection(actor, input.action),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
