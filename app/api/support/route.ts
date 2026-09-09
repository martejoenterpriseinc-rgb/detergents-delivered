import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { createSupportTicket, listSupportTickets } from "@/lib/services/support";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return accountJson(
      await listSupportTickets(
        await accountRequest(),
        Object.fromEntries(params),
        params.get("scope") === "admin",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await createSupportTicket(
        await accountRequest(request),
        await readAccountJson(request),
      ),
      201,
    );
  } catch (e) {
    return accountFailure(e);
  }
}
