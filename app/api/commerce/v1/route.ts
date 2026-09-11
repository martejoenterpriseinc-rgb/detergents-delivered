import { accountJson, accountFailure, readAccountJson } from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { commerceGateway } from "@/lib/services/commerce-gateway";
export async function GET() {
  return accountJson({
    version: "1",
    catalog: "/api/commerce/v1/catalog",
    coverage: "/api/delivery-coverage",
    policies: { refunds: "/refunds", privacy: "/privacy", terms: "/terms" },
    authorization: { type: "Bearer", manage: "/account/connections", maxDays: 7 },
    actions: [
      "orders.list",
      "subscriptions.list",
      "rewards.balance",
      "addresses.list",
      "quotes.create",
    ],
    payment:
      "Customer review and payment through the existing checkout are required. This API cannot charge, reserve stock or change subscriptions.",
  });
}
export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AccountError("JSON is required.", 415);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(process.env.AUTH_URL!).origin)
      throw new AccountError("Request origin is not allowed.", 403);
    return accountJson(
      await commerceGateway(
        request.headers.get("authorization"),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
