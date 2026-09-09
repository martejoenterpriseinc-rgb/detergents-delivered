"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LABELS,
  SUPPORT_STATUSES,
} from "@/lib/domain/account";
import type { getCustomerAccount } from "@/lib/services/customer-account";

type Account = Awaited<ReturnType<typeof getCustomerAccount>>;
async function save(url: string, method: string, data: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Your changes could not be saved.");
  return result;
}
function useSave() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection interrupted. Refresh and try again.",
      );
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }
  return {
    pending,
    run,
    setMessage,
    feedback: (
      <div aria-live="polite">
        {error && (
          <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="rounded-xl bg-teal-50 p-3 text-sm text-teal-900">
            {message}
          </p>
        )}
      </div>
    ),
  };
}
export function AccountSettingsForm({
  account,
  section,
}: {
  account: Account;
  section: string;
}) {
  const router = useRouter();
  const state = useSave();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await state.run(async () => {
      if (section === "profile") {
        await save("/api/account", "PATCH", {
          firstName: data.get("firstName"),
          lastName: data.get("lastName"),
          phone: data.get("phone"),
        });
      } else if (section === "notifications") {
        await save("/api/account/notifications", "PATCH", {
          emailNotifications: data.get("emailNotifications") === "on",
          smsNotifications: data.get("smsNotifications") === "on",
        });
      } else {
        await save("/api/account/password", "POST", {
          currentPassword: data.get("currentPassword"),
          newPassword: data.get("newPassword"),
          confirmPassword: data.get("confirmPassword"),
        });
        form.reset();
        state.setMessage(
          "Password changed. All sessions are signed out. Sign in again with your new password.",
        );
        return;
      }
      state.setMessage("Changes saved.");
      router.refresh();
    });
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      {section === "profile" && (
        <>
          <div>
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="firstName"
              required
              maxLength={80}
              autoComplete="given-name"
              defaultValue={account.firstName}
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              name="lastName"
              maxLength={80}
              autoComplete="family-name"
              defaultValue={account.lastName}
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              defaultValue={account.phone}
            />
          </div>
          <p className="text-sm break-words text-teal-800">
            Login email: {account.email}. Email changes require identity verification;
            contact support for help.
          </p>
          <p className="text-sm text-teal-800">
            Request delivery address changes through support so eligibility and existing
            bookings can be reviewed.
          </p>
        </>
      )}
      {section === "notifications" && (
        <>
          <p className="text-sm text-teal-800">
            Choose whether you want delivery updates by email or SMS. Preferences save to
            your account. Email and SMS sending are not connected in staging; check your
            account for updates.
          </p>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-teal-100 p-4">
            <span>Email delivery notifications</span>
            <input
              type="checkbox"
              name="emailNotifications"
              defaultChecked={account.emailNotifications}
              className="h-5 w-5 accent-teal-700"
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-xl border border-teal-100 p-4">
            <span>SMS delivery notifications</span>
            <input
              type="checkbox"
              name="smsNotifications"
              defaultChecked={account.smsNotifications}
              className="h-5 w-5 accent-teal-700"
            />
          </label>
          <p className="text-sm text-teal-800">
            These choices do not hide order history or support replies in your account.
            SMS activation will require verified contact details and provider setup.
          </p>
        </>
      )}
      {section === "security" &&
        (account.hasPassword ? (
          <>
            <div>
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>
            <p className="text-sm text-teal-800">
              Use at least 12 characters and no more than 72 bytes. Changing your password
              signs out all sessions.
            </p>
          </>
        ) : (
          <p>
            Your account uses an external sign-in provider. Manage your password with that
            provider.
          </p>
        ))}
      {state.feedback}
      <Button
        disabled={
          state.pending ||
          (section === "security" ? !account.hasPassword : !account.hasCustomer)
        }
        type="submit"
      >
        {state.pending
          ? "Saving…"
          : section === "security"
            ? "Change password"
            : "Save changes"}
      </Button>
    </form>
  );
}
export function NewTicketForm({
  orders,
  orderId,
}: {
  orders: { id: string; number: string }[];
  orderId: string;
}) {
  const router = useRouter();
  const state = useSave();
  const requestKey = useRef<string | null>(null);
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void state.run(async () => {
          requestKey.current ??= crypto.randomUUID();
          const result = await save("/api/support", "POST", {
            orderId: data.get("orderId") || null,
            category: data.get("category"),
            subject: data.get("subject"),
            message: data.get("message"),
            requestKey: requestKey.current,
          });
          router.push(`/account/support/${result.id}`);
          router.refresh();
        });
      }}
    >
      <div>
        <Label htmlFor="orderId">Order</Label>
        <select
          id="orderId"
          name="orderId"
          defaultValue={orderId}
          className="mt-1 w-full rounded-xl border border-teal-200 bg-white p-3"
        >
          <option value="">General question</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.number}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="category">Problem type</Label>
        <select
          id="category"
          name="category"
          className="mt-1 w-full rounded-xl border border-teal-200 bg-white p-3"
        >
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="subject">Subject</Label>
        <Input id="subject" name="subject" required minLength={3} maxLength={160} />
      </div>
      <div>
        <Label htmlFor="message">What happened?</Label>
        <Textarea
          id="message"
          name="message"
          required
          minLength={5}
          maxLength={4000}
          rows={5}
        />
      </div>
      <p className="text-sm text-teal-800">
        Your ticket and replies are saved in your account. Please do not include passwords
        or card details.
      </p>
      {state.feedback}
      <Button type="submit" disabled={state.pending}>
        {state.pending ? "Submitting…" : "Submit ticket"}
      </Button>
    </form>
  );
}
export function TicketReplyForm({
  ticketId,
  version,
  status,
  staff,
}: {
  ticketId: string;
  version: number;
  status: keyof typeof SUPPORT_LABELS;
  staff: boolean;
}) {
  const router = useRouter();
  const state = useSave();
  const requestKey = useRef<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void state.run(async () => {
          requestKey.current ??= crypto.randomUUID();
          await save(`/api/support/${ticketId}${staff ? "?scope=admin" : ""}`, "POST", {
            message: data.get("message"),
            version,
            requestKey: requestKey.current,
            ...(staff ? { status: data.get("status") } : {}),
          });
          requestKey.current = null;
          form.reset();
          state.setMessage("Reply saved.");
          router.refresh();
        });
      }}
    >
      <div>
        <Label htmlFor="reply">{staff ? "Reply to customer" : "Your reply"}</Label>
        <Textarea id="reply" name="message" required maxLength={4000} rows={4} />
      </div>
      {staff && (
        <div>
          <Label htmlFor="status">Ticket status</Label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="mt-1 w-full rounded-xl border border-teal-200 bg-white p-3"
          >
            {SUPPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SUPPORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="text-sm text-teal-800">
        {staff
          ? "This reply is visible to the customer. Resolving a ticket does not refund or reschedule an order."
          : "Replying reopens the ticket for our team. Replies are available here in your account."}
      </p>
      {state.feedback}
      <Button disabled={state.pending}>
        {state.pending ? "Saving…" : staff ? "Save reply and status" : "Send reply"}
      </Button>
    </form>
  );
}
