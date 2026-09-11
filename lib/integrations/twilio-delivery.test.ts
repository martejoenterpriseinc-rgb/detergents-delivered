import { afterEach, expect, it, vi } from "vitest";
import { readDeliveryText, submitDeliveryText, SmsRateLimit } from "./twilio-delivery";
const config = {
  mode: "sandbox" as const,
  origin: "https://dd.example.test",
  accountSid: "AC" + "a".repeat(32),
  authToken: "synthetic",
  sender: "+15555550100",
};
const sid = "SM" + "b".repeat(32),
  id = "00000000-0000-4000-8000-000000000001";
afterEach(() => vi.unstubAllGlobals());
it("uses fixed endpoints, signed callback identity and no automatic retry on uncertain sends", async () => {
  const send = vi.fn().mockRejectedValue(new Error("synthetic timeout"));
  vi.stubGlobal("fetch", send);
  await expect(
    submitDeliveryText(config, id, "+15555550101", "Synthetic"),
  ).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  const [url, request] = send.mock.calls[0];
  expect(url).toBe(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
  );
  expect(request.redirect).toBe("error");
  expect(new URLSearchParams(request.body).get("StatusCallback")).toBe(
    config.origin + "/api/twilio/status/" + id,
  );
});
it("distinguishes confirmed rate limiting and reads only an exact provider message ID", async () => {
  const call = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  vi.stubGlobal("fetch", call);
  await expect(
    submitDeliveryText(config, id, "+15555550101", "Synthetic"),
  ).rejects.toBeInstanceOf(SmsRateLimit);
  await expect(readDeliveryText(config, "../other")).rejects.toThrow();
  expect(call).toHaveBeenCalledTimes(1);
  call.mockResolvedValue(
    Response.json({
      sid,
      account_sid: config.accountSid,
      from: config.sender,
      to: "+15555550101",
      body: "Synthetic",
      status: "delivered",
    }),
  );
  expect((await readDeliveryText(config, sid)).status).toBe("delivered");
  expect(call.mock.calls[1][1].method).toBe("GET");
});
