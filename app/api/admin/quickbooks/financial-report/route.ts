import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { quickbooksFinancialReport } from "@/lib/services/quickbooks-financial-report";
export async function GET(request: Request) {
  try {
    const actor = await accountRequest(request),
      params = new URL(request.url).searchParams;
    return accountJson(
      await quickbooksFinancialReport(actor, {
        report: params.get("report") ?? undefined,
        period: params.get("period") ?? undefined,
        basis: params.get("basis") ?? undefined,
      }),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
