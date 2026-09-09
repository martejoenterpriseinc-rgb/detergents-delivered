// Shared labels only. This module must never import the vault or server secrets.
export const integrationCatalog = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, sales tax and signed webhooks",
    ready: true,
    fields: [
      {
        key: "STRIPE_RESTRICTED_KEY",
        label: "Restricted API key",
        hint: "Recommended server key",
      },
      {
        key: "STRIPE_SECRET_KEY",
        label: "Secret API key",
        hint: "Alternative to a restricted key",
        optional: true,
      },
      {
        key: "STRIPE_PUBLISHABLE_KEY",
        label: "Publishable key",
        hint: "Optional for hosted checkout",
        optional: true,
      },
      { key: "STRIPE_ACCOUNT_ID", label: "Stripe account ID", hint: "acct_…" },
      { key: "STRIPE_WEBHOOK_SECRET", label: "Webhook signing secret", hint: "whsec_…" },
    ],
  },
  {
    id: "google",
    name: "Google sign-in",
    description: "Customer registration and login",
    ready: true,
    fields: [
      {
        key: "GOOGLE_CLIENT_ID",
        label: "OAuth client ID",
        hint: "Web application client",
      },
      {
        key: "GOOGLE_CLIENT_SECRET",
        label: "OAuth client secret",
        hint: "Enter the client secret",
      },
    ],
  },
  {
    id: "email",
    name: "SendGrid email",
    description: "Password recovery and approved test inboxes",
    ready: true,
    fields: [
      {
        key: "EMAIL_PROVIDER",
        label: "Email provider",
        hint: "sendgrid",
        defaultValue: "sendgrid",
      },
      { key: "EMAIL_API_KEY", label: "SendGrid API key", hint: "Mail Send permission" },
      { key: "EMAIL_FROM", label: "Verified sender", hint: "Name <email@example.com>" },
      {
        key: "EMAIL_ALLOWED_RECIPIENTS",
        label: "Sandbox test recipients",
        hint: "Comma-separated approved email addresses",
        optional: true,
      },
    ],
  },
  {
    id: "sms",
    name: "Twilio SMS",
    description: "Customer texts · connector still to be built",
    ready: false,
    fields: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID", hint: "AC…" },
      { key: "TWILIO_AUTH_TOKEN", label: "Auth token", hint: "Enter the account token" },
      { key: "TWILIO_FROM", label: "Sender phone number", hint: "+1…" },
    ],
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Accounting sync · connector still to be built",
    ready: false,
    fields: [
      {
        key: "QUICKBOOKS_CLIENT_ID",
        label: "OAuth client ID",
        hint: "Use this environment’s Intuit app",
      },
      {
        key: "QUICKBOOKS_CLIENT_SECRET",
        label: "OAuth client secret",
        hint: "Enter the client secret",
      },
      { key: "QUICKBOOKS_REALM_ID", label: "Company ID", hint: "QuickBooks realm ID" },
    ],
  },
  {
    id: "storage",
    name: "Product & delivery photos",
    description: "S3-compatible storage · adapter still to be built",
    ready: false,
    fields: [
      { key: "STORAGE_ENDPOINT", label: "Storage endpoint", hint: "https://…" },
      { key: "STORAGE_REGION", label: "Region", hint: "Provider region" },
      {
        key: "STORAGE_ACCESS_KEY_ID",
        label: "Access key ID",
        hint: "Limited to the approved buckets",
      },
      {
        key: "STORAGE_SECRET_ACCESS_KEY",
        label: "Secret access key",
        hint: "Enter the storage secret",
      },
      {
        key: "STORAGE_PUBLIC_BUCKET",
        label: "Product photo bucket",
        hint: "Public catalog photos",
      },
      {
        key: "STORAGE_PRIVATE_BUCKET",
        label: "Delivery proof bucket",
        hint: "Private, authorized access only",
      },
    ],
  },
] as const;
export type ManagedProvider = (typeof integrationCatalog)[number]["id"];
export type ApiField = {
  key: string;
  label: string;
  hint: string;
  optional?: boolean;
  defaultValue?: string;
};
export type ApiRow = ApiField & {
  configured: boolean;
  version: number;
  updatedAt: string | null;
  source: "saved" | "hosting" | "missing";
};
export type ApiGroup = {
  id: ManagedProvider;
  name: string;
  description: string;
  ready: boolean;
  rows: ApiRow[];
};
export type ApiEditorData = {
  active: "sandbox" | "live" | null;
  origin: string | null;
  targetOrigin: string | null;
  destinationVersion: number;
  canSave: boolean;
  problems: string[];
  groups: ApiGroup[];
};
