import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { createLaunchResource } from "@/lib/services/launch";
export async function POST(request: Request) {
  try {
    return accountJson(
      await createLaunchResource(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
