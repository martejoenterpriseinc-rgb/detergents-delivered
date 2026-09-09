import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { getSupportTicket, replyToSupportTicket } from "@/lib/services/support";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return accountJson(
      await getSupportTicket(
        await accountRequest(),
        (await context.params).id,
        new URL(request.url).searchParams.get("scope") === "admin",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    return accountJson(
      await replyToSupportTicket(
        await accountRequest(request),
        (await context.params).id,
        await readAccountJson(request),
        new URL(request.url).searchParams.get("scope") === "admin",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
