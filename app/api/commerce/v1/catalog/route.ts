import { accountJson, accountFailure } from "@/lib/account-api";
import { machineCatalog } from "@/lib/services/commerce-gateway";
export async function GET(request: Request) {
  try {
    return accountJson(
      await machineCatalog(Object.fromEntries(new URL(request.url).searchParams)),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
