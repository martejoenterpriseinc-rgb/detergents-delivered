import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import { saveVehicleCapacity } from "@/lib/services/launch";
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveVehicleCapacity(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
