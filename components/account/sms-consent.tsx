"use client";
import { useEffect, useState } from "react";
import { smsTimezones } from "@/lib/domain/delivery-sms";
import type { smsConsentStatus } from "@/lib/services/sms-consent";
type Status = Awaited<ReturnType<typeof smsConsentStatus>>;
export function SmsConsentPanel() {
  const [status, setStatus] = useState<Status | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [timezone, setTimezone] = useState(""),
    [challenge, setChallenge] = useState<{
      message: string;
      sender: string;
      expiresAt: string;
    } | null>(null);
  async function load() {
    const r = await fetch("/api/account/sms-consent");
    const value = await r.json();
    if (!r.ok) throw new Error(value.error ?? "Text preferences could not be loaded.");
    setStatus(value);
    return value as Status;
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/account/sms-consent", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((value) => setStatus(value))
      .catch(() => {
        if (!controller.signal.aborted) setError("Text preferences could not be loaded.");
      });
    return () => controller.abort();
  }, []);
  async function act(action: "begin" | "stop" | "check") {
    setBusy(true);
    setError("");
    try {
      if (action !== "check") {
        const r = await fetch("/api/account/sms-consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "begin"
              ? { action, confirmed: true, timezone }
              : { action, confirmed: true },
          ),
        });
        const value = await r.json();
        if (!r.ok) throw new Error(value.error ?? "Text preferences could not be saved.");
        setChallenge(action === "begin" ? value : null);
        setConfirmed(false);
      }
      const latest = await load();
      if (latest.active) setChallenge(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Text preferences could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-2xl border border-teal-100 bg-white p-6"
      aria-labelledby="delivery-texts"
    >
      <h2 id="delivery-texts" className="text-xl font-semibold">
        Activate delivery texts
      </h2>
      <p>
        Receive text updates about your deliveries. This is optional and is not required
        to purchase. Message frequency varies; message and data rates may apply. Reply
        STOP to stop texts, or turn them off here. Check your account for the latest
        delivery status.
      </p>
      {status?.active ? (
        <>
          <p role="status">Your phone is verified for delivery texts.</p>
          <button className="ops-button" disabled={busy} onClick={() => act("stop")}>
            Turn off delivery texts
          </button>
        </>
      ) : (
        <>
          {status && !status.available ? (
            <p>
              Delivery texts are not available yet. You can still follow deliveries in
              your account.
            </p>
          ) : (
            <>
              <p>
                First save your phone with its country code in customer info. Verify your
                email, then confirm this request by texting the code below from that
                phone.
              </p>
              <label className="block">
                Your time zone
                <select
                  aria-label="Your time zone"
                  className="mt-2 block w-full rounded border p-3"
                  value={timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Select your time zone</option>
                  {smsTimezones.map((t) => (
                    <option key={t} value={t}>
                      {t
                        .replaceAll("_", " ")
                        .replace("America/", "")
                        .replace("Pacific/", "")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0"
                />
                <span>
                  I control my saved phone number and agree to receive delivery texts from
                  Detergents Delivered.
                </span>
              </label>
              <button
                className="ops-button"
                disabled={busy || !status?.available || !confirmed || !timezone}
                onClick={() => act("begin")}
              >
                Get verification instructions
              </button>
            </>
          )}
          {challenge && (
            <div className="space-y-3 rounded-xl bg-teal-50 p-4" role="status">
              <p>
                From your saved phone, text <strong>{challenge.message}</strong> to{" "}
                <strong>{challenge.sender}</strong> within 15 minutes.
              </p>
              <p>
                If you previously replied STOP, text START to that number first, then send
                your verification code. Sending START alone does not activate delivery
                updates.
              </p>
              <p>
                No verification text is sent by this page. Your phone carrier may charge
                for the text you send.
              </p>
            </div>
          )}
          {(challenge || status?.state === "PENDING") && (
            <div className="flex flex-wrap gap-3">
              <button className="ops-button" disabled={busy} onClick={() => act("check")}>
                Check phone verification
              </button>
              <button className="ops-button" disabled={busy} onClick={() => act("stop")}>
                Cancel text activation
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </section>
  );
}
