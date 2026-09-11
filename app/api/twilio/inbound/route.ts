import { ZodError } from "zod";
import { validatedSmsWebhook } from "@/lib/integrations/twilio-client";
import { receiveSmsConsent } from "@/lib/services/sms-consent";
import { AccountError } from "@/lib/domain/account";
export async function POST(request: Request) {
  try {
    const { config, fields } = await validatedSmsWebhook(request, "/api/twilio/inbound");
    await receiveSmsConsent(config, fields);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response("Callback not accepted.", {
      status: e instanceof AccountError ? e.status : e instanceof ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
