"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitCredentialChange } from "./actions";

export function ChangeCredentialsForm({ currentEmail }: { currentEmail: string }) {
  const [state, action, pending] = useActionState(submitCredentialChange, null);

  return (
    <form action={action} className="space-y-4">
      {state?.error ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {state.error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">New username (email)</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue=""
          placeholder={`Not ${currentEmail}`}
        />
        <p className="text-xs text-teal-700">
          Must be different from the temporary bootstrap login.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
        <p className="text-xs text-teal-700">
          At least 12 characters. Do not reuse the temporary password.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}
