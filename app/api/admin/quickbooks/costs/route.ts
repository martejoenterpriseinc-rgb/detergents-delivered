import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { costMappingData, saveCostMapping } from "@/lib/services/quickbooks-cost-mapping";
import { costOrderChoices, reviewOrderCost } from "@/lib/services/quickbooks-cost-source";
import { z } from "zod";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(request),
      q = new URL(request.url).searchParams;
    const kind = z
      .enum(["orders", "source", "mapping"])
      .parse(q.get("kind") ?? "mapping");
    return accountJson(
      kind === "orders"
        ? await costOrderChoices(actor, q.get("cursor") ?? undefined)
        : kind === "source"
          ? await reviewOrderCost(actor, {
              orderId: q.get("orderId"),
              ...(q.get("returnId") ? { returnId: q.get("returnId") } : {}),
            })
          : await costMappingData(actor),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveCostMapping(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
