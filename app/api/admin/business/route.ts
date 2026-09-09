import {
  accountFailure,
  accountJson,
  accountRequest,
  readAccountJson,
} from "@/lib/account-api";
import { getBusinessSetup, mutateBusinessSetup } from "@/lib/business/service";
export async function GET() {
  try {
    return accountJson(await getBusinessSetup(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await mutateBusinessSetup(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
