import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { quickbooksHealth } from "@/lib/services/quickbooks-health";
export async function GET() {
  try {
    return accountJson(await quickbooksHealth(await accountRequest()));
  } catch (error) {
    return accountFailure(error);
  }
}
