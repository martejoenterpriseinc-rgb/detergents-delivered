"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Mail, Copy, ArrowLeft } from "lucide-react";
export function InviteCustomer() {
  const key = useRef("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function create(form: FormData) {
    setBusy(true);
    setError("");
    key.current ||= crypto.randomUUID();
    try {
      const r = await fetch("/api/admin/operations/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          firstName: form.get("firstName"),
          requestKey: key.current,
        }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error ?? "Invite could not be created.");
      setUrl(result.url);
      setMessage("Invitation link created. No email has been sent.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ops-page">
      <Link className="ops-next-link" href="/admin/customers">
        <ArrowLeft size={16} />
        Back to customers
      </Link>
      <div className="ops-heading">
        <div>
          <div className="ops-eyebrow">GROW YOUR COMMUNITY</div>
          <h1>Invite a customer</h1>
          <p>A simple invitation to create their own account.</p>
        </div>
      </div>
      <form action={create} className="ops-panel ops-form ops-invite-form">
        <div className="ops-invite-icon">
          <Mail size={26} />
        </div>
        <h2>Let’s make the introduction.</h2>
        <label>
          Customer’s first name
          <input
            name="firstName"
            required
            maxLength={80}
            onChange={() => {
              key.current = "";
              setUrl("");
            }}
          />
        </label>
        <label>
          Customer’s email
          <input
            name="email"
            type="email"
            required
            onChange={() => {
              key.current = "";
              setUrl("");
            }}
          />
        </label>
        <p className="ops-callout">
          Email delivery is not connected yet. Create a link to share yourself; the
          customer still completes signup, verification and delivery eligibility checks.
        </p>
        {error && (
          <p className="ops-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="ops-success" role="status">
            {message}
          </p>
        )}
        <button className="ops-button" disabled={busy}>
          {busy ? "Creating…" : "Create invitation link"}
        </button>
        {url && (
          <div className="ops-invite-result">
            <label>
              Invitation link · expires in 7 days
              <input value={url} readOnly />
            </label>
            <button
              type="button"
              className="ops-button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setMessage("Invitation link copied.");
                } catch {
                  setError("Copy unavailable. Select and copy the link above.");
                }
              }}
            >
              <Copy size={15} />
              Copy link
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
