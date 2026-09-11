import { z } from "zod";
import {
  accountFailure,
  accountJson,
  accountRequest,
  readAccountJson,
} from "@/lib/account-api";
import {
  confirmEmailVerification,
  requestEmailVerification,
} from "@/lib/services/email-verification";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }).strict(),
  z
    .object({ action: z.literal("confirm"), token: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
]);
export async function POST(request: Request) {
  try {
    const userId = await accountRequest(request);
    const input = inputSchema.parse(await readAccountJson(request));
    const result =
      input.action === "request"
        ? await requestEmailVerification(userId)
        : await confirmEmailVerification(userId, { token: input.token });
    return accountJson({
      ...result,
      message: result.verified
        ? "Email verified. Your password and account access are unchanged."
        : "Verification email requested. Check your inbox and spam folder.",
    });
  } catch (error) {
    return accountFailure(error);
  }
}
