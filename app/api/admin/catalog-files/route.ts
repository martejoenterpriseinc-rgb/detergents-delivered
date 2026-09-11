import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import {
  previewCatalogFile,
  applyCatalogFile,
  exportCatalogFile,
} from "@/lib/services/catalog-file";
export async function GET(request: Request) {
  try {
    const filter = Object.fromEntries(new URL(request.url).searchParams);
    const csv = await exportCatalogFile(await accountRequest(), filter);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="catalog-${filter.kind}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return accountFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request),
      raw = await readAccountJson(request);
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new AccountError("Invalid import request.");
    const { action, ...input } = raw as Record<string, unknown>;
    if (action === "preview") return accountJson(await previewCatalogFile(actor, input));
    if (action === "apply") return accountJson(await applyCatalogFile(actor, input));
    throw new AccountError("Choose preview or apply.");
  } catch (error) {
    return accountFailure(error);
  }
}
