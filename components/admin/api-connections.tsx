"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import type { ApiEditorData, ApiGroup, ApiRow } from "@/lib/integrations/catalog";
import styles from "./api-connections.module.css";

type Update = { provider: string; field: string; value: string; version: number };
async function sendUpdate(data: ApiEditorData, update: Update) {
  const response = await fetch("/api/admin/integrations/fields", {
    method: "PATCH",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...update, environment: data.active }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not save. Your replacement is still here.");
  return body as ApiEditorData;
}
function FieldRow({
  group,
  row,
  data,
  updated,
  dirtyChanged,
}: {
  group: ApiGroup;
  row: ApiRow;
  data: ApiEditorData;
  updated: (value: ApiEditorData) => void;
  dirtyChanged: (id: string, dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [version, setVersion] = useState(row.version);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const id = `${group.id}-${row.key}`;
  function cancel() {
    setEditing(false);
    setValue("");
    setShown(false);
    setError("");
    dirtyChanged(id, false);
  }
  async function save() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await sendUpdate(data, {
        provider: group.id,
        field: row.key,
        value,
        version,
      });
      updated(result);
      cancel();
      setFeedback("Saved successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <tr
      aria-label={`${group.name}: ${row.label}`}
      className={editing ? styles.editingRow : undefined}
    >
      <td>
        <label htmlFor={id} className={styles.fieldName}>
          {row.label}
        </label>
        <span className={styles.hint}>{row.hint}</span>
      </td>
      <td>
        {editing ? (
          <form
            id={`form-${id}`}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className={styles.inputWrap}>
              <input
                id={id}
                type={shown ? "text" : "password"}
                value={value}
                disabled={busy}
                autoFocus
                autoComplete="new-password"
                spellCheck={false}
                maxLength={4096}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `error-${id}` : undefined}
                placeholder={row.configured ? "Enter replacement value" : row.hint}
                onChange={(e) => {
                  setValue(e.target.value);
                  dirtyChanged(id, Boolean(e.target.value));
                  setError("");
                }}
              />
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setShown(!shown)}
                aria-label={shown ? `Hide ${row.label}` : `Show ${row.label}`}
                title={shown ? "Hide entered value" : "Show entered value"}
              >
                {shown ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && (
              <p id={`error-${id}`} role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </form>
        ) : (
          <>
            <span className={row.configured ? styles.masked : styles.empty}>
              {row.configured ? "••••••••••••" : "—"}
            </span>
            {row.updatedAt && (
              <span className={styles.hint}>
                Updated {new Date(row.updatedAt).toLocaleDateString()}
              </span>
            )}
            <span role="status" className={styles.savedFeedback}>
              {feedback}
            </span>
          </>
        )}
      </td>
      <td>
        <span
          className={`${styles.badge} ${row.configured ? styles.savedBadge : styles.missingBadge}`}
        >
          {busy
            ? "Saving…"
            : editing
              ? "Editing"
              : row.configured
                ? group.ready
                  ? row.source === "hosting"
                    ? "Configured"
                    : "Saved"
                  : "Saved · pending"
                : row.optional &&
                    !(row.key === "EMAIL_ALLOWED_RECIPIENTS" && data.active === "sandbox")
                  ? "Optional"
                  : "Not set"}
        </span>
      </td>
      <td className={styles.actions}>
        {editing ? (
          <>
            <button
              className={styles.saveButton}
              form={`form-${id}`}
              type="submit"
              disabled={busy || !value.trim()}
            >
              <Save size={14} />
              {row.configured ? "Update" : "Save"}
            </button>
            <button
              className={styles.cancelButton}
              type="button"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className={styles.editButton}
            type="button"
            disabled={!data.canSave}
            onClick={() => {
              setEditing(true);
              setValue(row.defaultValue ?? "");
              setVersion(row.version);
              setFeedback("");
              dirtyChanged(id, Boolean(row.defaultValue));
            }}
          >
            <Pencil size={14} />
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}
function groupStatus(group: ApiGroup, sandbox: boolean) {
  if (!group.ready) return "Connector pending";
  const saved = (key: string) => group.rows.some((r) => r.key === key && r.configured);
  const complete =
    group.id === "stripe"
      ? (saved("STRIPE_RESTRICTED_KEY") || saved("STRIPE_SECRET_KEY")) &&
        saved("STRIPE_ACCOUNT_ID") &&
        saved("STRIPE_WEBHOOK_SECRET")
      : group.rows.every(
          (r) =>
            r.configured ||
            (r.optional && !(sandbox && r.key === "EMAIL_ALLOWED_RECIPIENTS")),
        );
  return complete ? "Verification required" : "Setup required";
}
function CopyAddress({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.address}>
      <span>{label}</span>
      <code>{value ?? "Not configured"}</code>
      {value && (
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      )}
    </div>
  );
}
export function ApiConnections({ initial }: { initial: ApiEditorData }) {
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState("all");
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"connect" | "switch" | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const [destinationError, setDestinationError] = useState("");
  const [addressVersion, setAddressVersion] = useState(data.destinationVersion);
  const activeName = data.active === "live" ? "Production" : "Sandbox";
  const targetName = data.active === "live" ? "Sandbox" : "Production";
  const targetSettings = data.targetOrigin ? `${data.targetOrigin}/admin/settings` : null;
  const dirtyRef = useRef(dirty);
  function changed(id: string, isDirty: boolean) {
    const next = new Set(dirtyRef.current);
    if (isDirty) next.add(id);
    else next.delete(id);
    dirtyRef.current = next;
    setDirty(next);
  }
  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirtyRef.current.size) e.preventDefault();
    }
    function navigation(e: MouseEvent) {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (
        a &&
        dirtyRef.current.size &&
        !window.confirm("Leave without saving your edited API rows?")
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigation, true);
    };
  }, []);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  function openDestination(mode: "connect" | "switch") {
    setAddress(data.targetOrigin ?? "");
    setAddressVersion(data.destinationVersion);
    setDestinationError("");
    setDialog(mode);
  }
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/fields", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Status is unavailable.");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status is unavailable.");
    } finally {
      setRefreshing(false);
    }
  }
  async function connect() {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    setDestinationError("");
    try {
      setData(
        await sendUpdate(data, {
          provider: "destination",
          field: "APP_URL",
          value: address,
          version: addressVersion,
        }),
      );
      setDialog(null);
      setAddress("");
    } catch (e) {
      setDestinationError(
        e instanceof Error ? e.message : "Could not save this address.",
      );
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }
  const groups = data.groups.filter(
    (g) => filter === "all" || (filter === "active" ? g.ready : !g.ready),
  );
  const configured = data.groups
    .flatMap((g) => g.rows)
    .filter((r) => r.configured).length;
  return (
    <section className={styles.root} aria-labelledby="api-connections-heading">
      <div
        className={`${styles.environment} ${data.active === "live" ? styles.production : ""}`}
      >
        <div>
          <span className={styles.eyebrow}>Working environment</span>
          <strong>
            {activeName}
            <span className={styles.current}>Current</span>
          </strong>
          <span className={styles.hint}>{data.origin}</span>
        </div>
        <div className={styles.switcher} role="group" aria-label="Switch environment">
          {(["Sandbox", "Production"] as const).map((name) => (
            <button
              type="button"
              key={name}
              aria-pressed={name === activeName}
              className={name === activeName ? styles.selected : ""}
              onClick={() => {
                if (name !== activeName)
                  openDestination(targetSettings ? "switch" : "connect");
              }}
              aria-label={
                name === activeName
                  ? `${name} — current environment`
                  : `Switch to ${name}`
              }
            >
              {name === activeName && <Check size={15} />} {name}
            </button>
          ))}
        </div>
        <div className={styles.destination}>
          <span>
            {data.targetOrigin
              ? `${targetName} address saved`
              : `${targetName} not connected`}
          </span>
          <button
            type="button"
            onClick={() => openDestination("connect")}
            disabled={!data.canSave}
          >
            {data.targetOrigin ? "Edit address" : `Connect ${targetName.toLowerCase()}`}
            <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      <CopyAddress
        label="Current API base URL"
        value={data.origin ? `${data.origin}/api` : null}
      />
      {data.problems.length > 0 && (
        <div role="alert" className={styles.problem}>
          {data.problems.join(" ")}
        </div>
      )}
      <div className={styles.heading}>
        <div>
          <h2 id="api-connections-heading">
            <KeyRound size={21} />
            API connections
          </h2>
          <p>
            Edit a row, enter its value, then save. Changes apply to{" "}
            {activeName.toLowerCase()} only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className={styles.editButton}
        >
          <RefreshCw size={14} />
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
      <div className={styles.toolbar}>
        <div role="group" aria-label="Filter API connections">
          {[
            ["all", "All APIs"],
            ["active", "Available connectors"],
            ["planned", "Coming next"],
          ].map(([id, name]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => {
                if (dirty.size) {
                  setError("Save or cancel edited rows before changing the filter.");
                  return;
                }
                setFilter(id);
                setError("");
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <span>{configured} fields configured</span>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {groups.map((group) => (
        <section key={group.id} className={styles.provider} aria-label={group.name}>
          <div className={styles.providerHeading}>
            <div>
              <h3>{group.name}</h3>
              <p>{group.description}</p>
            </div>
            <span
              className={`${styles.badge} ${group.ready ? styles.neutralBadge : styles.missingBadge}`}
            >
              {groupStatus(group, data.active === "sandbox")}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>API field</th>
                <th>Value</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <FieldRow
                  key={row.key}
                  group={group}
                  row={row}
                  data={data}
                  updated={setData}
                  dirtyChanged={changed}
                />
              ))}
            </tbody>
          </table>
          {group.id === "email" && (
            <details className={styles.emailSetup}>
              <summary>Set up email for launch</summary>
              <div>
                <p>
                  You can finish the build before connecting email. Complete these steps
                  before accepting customer orders.
                </p>
                <ol>
                  <li>
                    Select Sandbox or Production above. Save a separate SendGrid key for
                    each environment.
                  </li>
                  <li>
                    Verify your sending identity in SendGrid, then edit and save the
                    Verified sender row. Sender verification is completed in SendGrid.
                  </li>
                  <li>
                    Create a key with Mail Send permission. Save it in the SendGrid API
                    key row and save sendgrid in the Email provider row.
                  </li>
                  {data.active === "sandbox" && (
                    <li>
                      Save the approved inboxes in Sandbox test recipients. Sandbox sends
                      real email only to these addresses.
                    </li>
                  )}
                  <li>
                    Before launch, confirm delivery through Account → Verify your email
                    and Forgot password. Saving rows or refreshing status does not send a
                    test email or prove delivery.
                  </li>
                </ol>
                <div className={styles.setupLinks}>
                  <a
                    href="https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Sender setup guide <ArrowUpRight size={14} />
                  </a>
                  <a
                    href="https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    API key setup guide <ArrowUpRight size={14} />
                  </a>
                  <a href="/account">
                    Open my account <ArrowUpRight size={14} />
                  </a>
                </div>
                <p>
                  Owner access uses the same customer login. After the intended owner
                  verifies their email, the separate owner setup must be completed before
                  Admin / Owner appears.
                </p>
              </div>
            </details>
          )}
          {group.id === "stripe" && (
            <CopyAddress
              label="Stripe webhook URL"
              value={data.origin ? `${data.origin}/api/stripe/webhook` : null}
            />
          )}
          {group.id === "google" && (
            <CopyAddress
              label="Google callback URL"
              value={data.origin ? `${data.origin}/api/auth/callback/google` : null}
            />
          )}
        </section>
      ))}
      <details className={styles.additional}>
        <summary>
          Services without an API key <ChevronDown size={16} />
        </summary>
        <div>
          <p>
            <strong>Delivery map</strong>
            <span>Uses active delivery ZIP codes. No key required.</span>
            <a href="/admin/settings/launch">Update ZIP codes ↗</a>
          </p>
          <p>
            <strong>Website photos</strong>
            <span>Saved in the app’s database.</span>
            <a href="/admin/website/builder">Open builder ↗</a>
          </p>
          <p>
            <strong>Product & delivery photos</strong>
            <span>
              Durable storage is built in. Delivery proofs are encrypted; the S3 connector
              above is optional future expansion.
            </span>
          </p>
          <p>
            <strong>Stripe Tax</strong>
            <span>
              Uses the Stripe credentials above. Tax setup requires verification.
            </span>
            <a href="/admin/payments">Open payments ↗</a>
          </p>
        </div>
      </details>
      <p className={styles.security}>
        <ShieldCheck size={15} />
        Saved values are encrypted and never shown again. “Saved” confirms storage; it
        does not confirm a working provider connection.
      </p>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        onCancel={(e) => {
          if (connecting) e.preventDefault();
          else setDialog(null);
        }}
      >
        <button
          type="button"
          className={styles.closeDialog}
          aria-label="Close environment dialog"
          disabled={connecting}
          onClick={() => setDialog(null)}
        >
          <X size={20} />
        </button>
        {dialog === "switch" ? (
          <>
            <h2>Switch to {targetName}</h2>
            <p>
              You will open the separate {targetName.toLowerCase()} app. You may need to
              sign in again.
            </p>
            <code>{data.targetOrigin}</code>
            {dirty.size > 0 ? (
              <p role="alert" className={styles.error}>
                Save or cancel edited API rows before switching.
              </p>
            ) : (
              <a
                className={styles.saveButton}
                href={targetSettings!}
                referrerPolicy="no-referrer"
              >
                Open {targetName}
                <ArrowUpRight size={16} />
              </a>
            )}
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => setDialog(null)}
            >
              Stay in {activeName}
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <h2>
              {data.targetOrigin ? "Update" : "Connect"} {targetName.toLowerCase()}
            </h2>
            <p>
              Enter the address of your separately deployed {targetName.toLowerCase()}{" "}
              app. This saves the switch destination; it does not create a service or move
              your records.
            </p>
            <label htmlFor="destination-address">{targetName} application URL</label>
            <input
              id="destination-address"
              type="url"
              required
              placeholder="https://…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={connecting}
            />
            {destinationError && (
              <p role="alert" className={styles.error}>
                {destinationError}
              </p>
            )}
            <button
              type="submit"
              className={styles.saveButton}
              disabled={connecting || !address.trim() || !data.canSave}
            >
              <Save size={15} />
              {connecting
                ? "Saving…"
                : data.targetOrigin
                  ? "Update address"
                  : "Save address"}
            </button>
            <button
              type="button"
              disabled={connecting}
              className={styles.cancelButton}
              onClick={() => setDialog(null)}
            >
              Cancel
            </button>
          </form>
        )}
      </dialog>
    </section>
  );
}
