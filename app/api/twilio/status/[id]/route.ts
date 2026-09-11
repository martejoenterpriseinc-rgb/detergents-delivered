import { ZodError, z } from "zod";
import { AccountError } from "@/lib/domain/account";
import { validatedSmsWebhook } from "@/lib/integrations/twilio-client";
import { receiveDeliveryTextStatus } from "@/lib/services/sms-delivery";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const { config, fields } = await validatedSmsWebhook(
      request,
      "/api/twilio/status/" + id,
    );
    await receiveDeliveryTextStatus(config, id, fields);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response("Callback not accepted.", {
      status: e instanceof AccountError ? e.status : e instanceof ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
