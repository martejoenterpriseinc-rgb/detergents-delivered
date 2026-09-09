import { after } from "next/server";
import { setTimeout } from "node:timers/promises";
import { accountFailure, accountJson, readAccountJson } from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { RECOVERY_RESPONSE, recoveryOrigin } from "@/lib/domain/customer-access";
import {
  deliverRecoveryEmails,
  requestPasswordRecovery,
  resetRecoveredPassword,
} from "@/lib/services/password-recovery";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  try {
    if (request.headers.get("origin") !== recoveryOrigin())
      throw new AccountError("Request origin is not allowed.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AccountError("JSON is required.", 415);
    const { operation } = await params;
    if (!["request", "reset"].includes(operation))
      throw new AccountError("Not found.", 404);
    const input = await readAccountJson(request);
    if (operation === "request") {
      const started = Date.now();
      const email =
        input && typeof input === "object" && "email" in input ? input.email : undefined;
      await requestPasswordRecovery(email);
      await setTimeout(Math.max(0, 250 - (Date.now() - started)));
      after(async () => {
        try {
          await deliverRecoveryEmails();
        } catch {
          /* Durable jobs remain available to the scheduled worker. */
        }
      });
      return accountJson({ message: RECOVERY_RESPONSE });
    }
    await resetRecoveredPassword(input);
    return accountJson({ message: "Password reset. Sign in with your new password." });
  } catch (error) {
    return accountFailure(error);
  }
}
