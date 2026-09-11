import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  quickbooksAccountChoices,
  quickbooksMappingData,
  saveQuickbooksMapping,
} from "@/lib/services/quickbooks-mapping";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(),
      q = new URL(request.url).searchParams;
    if (q.get("kind") === "mappings")
      return accountJson(await quickbooksMappingData(actor));
    return accountJson(
      await quickbooksAccountChoices(actor, {
        start: q.has("start") ? Number(q.get("start")) : 1,
      }),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveQuickbooksMapping(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
