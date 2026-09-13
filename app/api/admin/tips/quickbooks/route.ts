import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import {
  readQuickbooksTipJournals,
  prepareQuickbooksTipJournal,
  actQuickbooksTipJournal,
} from "@/lib/services/quickbooks-tip-journals";
export async function GET(request: Request) {
  try {
    return accountJson(
      await readQuickbooksTipJournals(
        await accountRequest(),
        new URL(request.url).searchParams.get("tipId") ?? "",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await prepareQuickbooksTipJournal(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    return accountJson(
      await actQuickbooksTipJournal(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
