"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export function PasswordRecoveryForm({ reset = false }: { reset?: boolean }) {
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(!reset);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const tokenRead = useRef(false);
  useEffect(() => {
    if (!reset || tokenRead.current) return;
    tokenRead.current = true;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(value);
    setLoaded(true);
    // The token never appears in a page request or referrer, and is removed from
    // the visible URL after reading. Reloading requires reopening the email link.
    if (window.location.hash)
      window.history.replaceState(null, "", window.location.pathname);
  }, [reset]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/account-recovery/${reset ? "reset" : "request"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            reset
              ? {
                  token,
                  password: data.get("password"),
                  confirmPassword: data.get("confirmPassword"),
                }
              : { email: data.get("email") },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Please try again.");
      setMessage(result.message);
      setToken("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection interrupted. Please try again.",
      );
    } finally {
      setPending(false);
      submitting.current = false;
    }
  }
  if (message)
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-xl bg-teal-50 p-4 text-teal-900">
          {message}
        </p>
        <Link href="/sign-in" className="font-semibold text-teal-800 underline">
          Back to sign in
        </Link>
      </div>
    );
  if (reset && !loaded) return <p role="status">Opening your reset link…</p>;
  if (reset && !/^[a-f0-9]{64}$/.test(token))
    return (
      <div className="space-y-4">
        <p>Open the complete reset link from your email, or request a new one.</p>
        <Link href="/forgot-password" className="font-semibold text-teal-800 underline">
          Request a reset link
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      {reset ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={72}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={72}
            />
          </div>
          <p className="text-sm text-teal-800">
            Use at least 12 characters. Resetting your password signs out all devices.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Account email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {error}{" "}
          {reset && (
            <Link href="/forgot-password" className="underline">
              Request a new link
            </Link>
          )}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait…" : reset ? "Reset password" : "Send reset link"}
      </Button>
    </form>
  );
}
