# Delivery text dispatch and recovery

Implementation candidate; sender activation, hosted release and real provider acceptance remain pending.

The existing driver workflow atomically queues one out-for-delivery and one completed-delivery text per order when the customer already has active verified consent. A failed delivery transaction rolls back its queued text. Old orders are not backfilled into a message campaign. The queue points to immutable consent evidence and contains only the relevant order/status identity.

Before a new submission, the worker rechecks customer/account availability, phone, current consent, exact environment/account/sender, current order state, expiry, recipient time zone and staging recipient allowance. Pending messages whose consent or delivery state changed are skipped. Dispatch is restricted to 08:00–20:00 in the customer's selected time zone; a pending update expires after 24 hours. Texts contain a short delivery update, an authenticated account link and STOP instructions, not a delivery address or payment details.

The existing scheduler runs `delivery-sms`, with at most five reads and five new submissions per run. New submissions are paced at least one second apart. The durable SUBMITTING claim and attempt audit commit before the sole provider request. A timeout, ambiguous response or failed receipt save is held as UNKNOWN; the worker does not submit it again. Only an explicit HTTP 429 permits an automatic retry, with exponential backoff and jitter, limited to five attempts. Exact provider message IDs support read-only recovery. An unknown submission without an ID awaits its signed callback or operator investigation; it is not guessed from message-list matches.

Twilio status callbacks validate the configured full URL, all received form fields, account, sender, recipient and claimed queue record. Provider message IDs are permanent. Replayed and out-of-order callbacks do not move a terminal status backward. Contradictory terminal evidence raises a review issue while retaining the original state and callback history. Accepted/queued/sent states are not called delivered; only provider delivery evidence does that. A consent withdrawal blocks future claims but cannot retract a submission already in flight at the provider.

Administrators can review the latest 50 message states in Deliveries → Delivery text messages. The view omits phone numbers, message bodies, credentials and raw provider errors. It offers no blind resend action. Persistent issues are reflected in the background-job status.

## Activation fields

- `DD_SMS_DELIVERY_ENABLED=true`
- `DD_SMS_DELIVERY_ACCOUNT=<sandbox|live>:<Twilio Account SID>:<sender phone>`
- `DD_SMS_ALLOWED_RECIPIENTS`: comma-separated exact E.164 numbers, mandatory for sandbox dispatch.

These are server/operator controls and default off. They must not be enabled from a customer's request or merely because credentials exist. The intended sender must support inbound opt-outs and signed delivery callbacks. Complete provider sender registration and controlled acceptance before enabling public dispatch. No real messages were sent while building this increment.

Migration `20260916200000_delivery_sms_outbox` adds the queue and immutable callback evidence. Existing orders, customer contacts and earlier migrations remain unchanged. PostgreSQL tests cover transactional enqueue, concurrent claims, lost-response recovery, opt-out/recipient/lease/disabled gates, 429-only retry and protected monitoring. Browser fixtures exercise the real monitoring page using synthetic saved queue records.

Provider references: [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource), [webhook security](https://www.twilio.com/docs/usage/security). Application-level fixtures and mocks are not real-provider acceptance.
