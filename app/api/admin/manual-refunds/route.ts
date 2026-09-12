import {
  accountRequest,
  readAccountJson,
  accountJson,
  accountFailure,
} from "@/lib/account-api";
import {
  prepareManualRefund,
  recordManualRefund,
  readManualRefunds,
  cancelManualRefund,
} from "@/lib/services/manual-refunds";
export async function GET(request: Request) {
  try {
    return accountJson(
      await readManualRefunds(
        await accountRequest(),
        new URL(request.url).searchParams.get("orderId") ?? "",
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await prepareManualRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PATCH(request: Request) {
  try {
    return accountJson(
      await recordManualRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    return accountJson(
      await cancelManualRefund(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
