import { z } from "zod";
import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  smsConsentStatus,
  beginSmsConsent,
  stopSmsConsent,
} from "@/lib/services/sms-consent";
export async function GET(request: Request) {
  try {
    return accountJson(await smsConsentStatus(await accountRequest(request)));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await accountRequest(request),
      raw = await readAccountJson(request);
    const { action, ...input } = z
      .object({ action: z.enum(["begin", "stop"]) })
      .passthrough()
      .parse(raw);
    if (action === "stop") {
      z.object({ confirmed: z.literal(true) })
        .strict()
        .parse(input);
      return accountJson(await stopSmsConsent(actor));
    }
    return accountJson(await beginSmsConsent(actor, input));
  } catch (e) {
    return accountFailure(e);
  }
}
