"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function EmailVerification({
  verified = false,
  available = true,
  confirm = false,
}: {
  verified?: boolean;
  available?: boolean;
  confirm?: boolean;
}) {
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(!confirm);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const read = useRef(false);
  const router = useRouter();
  useEffect(() => {
    if (!confirm || read.current) return;
    read.current = true;
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
    setLoaded(true);
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
  }, [confirm]);
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/email-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          confirm ? { action: "confirm", token } : { action: "request" },
        ),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Sign in to your account, then reopen the link from your email."
            : (result.error ?? "Please try again."),
        );
      setMessage(result.message);
      if (result.verified) {
        setToken("");
        router.refresh();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection interrupted. Please try again.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (!confirm && verified)
    return <p className="mt-4 text-sm text-teal-800">Email verified</p>;
  return (
    <section
      className="my-6 space-y-3 rounded-xl border border-teal-100 bg-teal-50 p-4"
      aria-label="Email verification"
    >
      <h2 className="font-semibold text-teal-950">
        {confirm ? "Confirm your email" : "Verify your email"}
      </h2>
      {!confirm && (
        <p className="text-sm text-teal-900">
          Confirm that you can receive email at your account address. Your password stays
          the same.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-teal-900">
          {message}
        </p>
      )}
      {confirm ? (
        <>
          {!loaded ? (
            <p role="status">Opening your verification link…</p>
          ) : (
            !message &&
            (/^[a-f0-9]{64}$/.test(token) ? (
              <Button onClick={submit} disabled={pending}>
                {pending ? "Confirming…" : "Confirm email"}
              </Button>
            ) : (
              <p>
                Open the complete link from your email, or request a new one from your
                account.
              </p>
            ))
          )}
          <p className="text-sm">
            <Link href="/account" className="font-semibold underline">
              Your account
            </Link>{" "}
            ·{" "}
            <Link href="/sign-in" className="underline">
              Sign in
            </Link>
          </p>
        </>
      ) : (
        <>
          <Button onClick={submit} disabled={pending || !available}>
            {pending
              ? "Requesting…"
              : message
                ? "Resend verification email"
                : "Send verification email"}
          </Button>
          {!available && (
            <p role="status" className="text-sm text-teal-900">
              Email verification is temporarily unavailable. Please try again later.
            </p>
          )}
        </>
      )}
    </section>
  );
}
