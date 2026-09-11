import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  salesMappingKind,
  salesMappingSources,
  salesProviderChoices,
  saveSalesMapping,
} from "@/lib/services/quickbooks-sales-mapping";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(),
      q = new URL(request.url).searchParams,
      kind = salesMappingKind.parse(q.get("kind")),
      view = z.enum(["sources", "provider"]).parse(q.get("view") ?? "sources");
    return accountJson(
      view === "sources"
        ? await salesMappingSources(actor, { kind, cursor: q.get("cursor") ?? undefined })
        : await salesProviderChoices(actor, { kind, start: Number(q.get("start") ?? 1) }),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveSalesMapping(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
