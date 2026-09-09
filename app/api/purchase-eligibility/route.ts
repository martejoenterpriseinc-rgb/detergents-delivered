import { auth } from "@/auth";
import { purchaseEligibility } from "@/lib/services/purchase-eligibility";
import { accountJson, accountFailure } from "@/lib/account-api";
export async function GET(request: Request) {
  try {
    const session = await auth();
    return accountJson(
      await purchaseEligibility(
        session?.user?.id ?? null,
        new URL(request.url).searchParams.get("zip") ?? "",
      ),
    );
  } catch (error) {
    return accountFailure(error);
  }
}
