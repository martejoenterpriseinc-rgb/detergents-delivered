import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  readClaimReviews,
  proposeClaimReview,
  decideClaimReview,
} from "@/lib/services/financial-claim-reviews";
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    return accountJson(
      await readClaimReviews(await accountRequest(), {
        kind: q.get("kind"),
        claimId: q.get("claimId"),
      }),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await proposeClaimReview(
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
      await decideClaimReview(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
