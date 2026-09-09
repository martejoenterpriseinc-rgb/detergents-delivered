import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { customerDirectory, editOperationsCustomer } from "@/lib/services/operations";
export async function GET(r: Request) {
  try {
    return accountJson(
      await customerDirectory(
        await accountRequest(),
        Object.fromEntries(new URL(r.url).searchParams),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PATCH(r: Request) {
  try {
    return accountJson(
      await editOperationsCustomer(await accountRequest(r), await readAccountJson(r)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
