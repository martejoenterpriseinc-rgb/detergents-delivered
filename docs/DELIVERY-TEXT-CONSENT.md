# Delivery text consent

Implementation candidate; no real messages, sender configuration or provider acceptance has occurred.

Account → Notifications now has a separate delivery-text activation flow. It requires verified account email, a saved country-code phone number, a customer-selected time zone and an unchecked explicit consent choice. The server records the consent version and gives the customer a short code to text from that phone to the configured sender. Only its SHA-256 hash is retained. Codes expire after 15 minutes, are consumed once and are limited to five requests per customer per hour. Issuing another code revokes the previous request.

The customer sends `DD <code>` from the saved phone. The app sends no verification message. A valid inbound callback must match the configured environment, Twilio account, sender, current customer phone and pending request. The app uses Twilio SDK request validation against the configured origin and all received form fields. Incoming Host headers cannot choose the signed URL. Bodies are bounded to 16 KB; duplicate form fields and unexpected query strings are rejected. Invalid signatures cannot mutate consent.

STOP and equivalent opt-out commands revoke current consent and disable the delivery-text preference immediately. Callback events are immutable and deduplicated. START by itself never activates application consent. If the recipient previously opted out at the provider, they must send START before their new verification text. The intended sender must support inbound replies and provider opt-out handling before launch.

Changing the saved phone or disabling SMS preferences revokes consent. Existing legacy SMS preferences are preserved as preferences and never treated as verified authorization to send. Turning a preference back on does not revive revoked consent. Consent history and activation/opt-out evidence are protected by PostgreSQL triggers; no synthetic consent is seeded into hosted accounts.

Migration `20260916190000_delivery_sms_consent` adds consent and minimal inbound-event history. It does not change stored customer contact details. Native tests exercise ownership, replay, opt-out, changed phones, audit rollback and throttling. Browser acceptance uses a synthetic encrypted provider configuration and locally signed callback fixtures; it does not send any real SMS or establish Twilio acceptance.

The outbound event queue, sender enablement, status callbacks, delivery reconciliation and staff monitoring are the next integration increment. Outbound delivery remains unavailable until those are built and the intended sender is accepted. Future delivery scheduling uses the recipient-selected time zone and a conservative 08:00–20:00 window; these application defaults do not assert legal compliance for every jurisdiction.

Provider sources checked for this implementation: [Twilio webhook security](https://www.twilio.com/docs/usage/security), [Message resource](https://www.twilio.com/docs/messaging/api/message-resource). The pinned official Node SDK supplies signature validation.
