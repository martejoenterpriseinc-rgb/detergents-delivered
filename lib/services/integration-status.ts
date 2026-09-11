import { commerceConfiguration } from "@/lib/commerce/config";
import { googleSignInConfigured, recoveryOrigin } from "@/lib/domain/customer-access";
import { recoveryEmailConfiguration } from "@/lib/services/password-recovery";
import { documentReadiness } from "@/lib/business/document-security";
import { environmentSettings } from "@/lib/integration-environment";

export type IntegrationStatus = {
  id: string;
  name: string;
  state: "configuration-needed" | "verification-needed" | "implementation-needed";
  summary: string;
  nextSteps: string[];
  action?: { label: string; href: string };
};
// Explicit admin DTO: no environment objects, provider keys, account identities,
// recovery recipients, encrypted payloads or raw provider errors leave this service.
export function integrationStatus(env: Record<string, string | undefined> = process.env) {
  const commerce = commerceConfiguration(env);
  const google = googleSignInConfigured(env);
  const documents = documentReadiness();
  let email = false;
  try {
    recoveryEmailConfiguration(env);
    email = true;
  } catch {
    /* configuration only */
  }
  let origin: string | null = null;
  try {
    origin = recoveryOrigin(env);
  } catch {
    /* invalid origins must not be reflected */
  }
  const connections: IntegrationStatus[] = [
    {
      id: "checkout",
      name: "Stripe payments",
      state: commerce.missing.length ? "configuration-needed" : "verification-needed",
      summary: commerce.enabled
        ? "Checkout configuration is present. A verified payment workflow is still required."
        : "Checkout remains closed until its required configuration is complete.",
      nextSteps: [
        ...commerce.missing,
        "Verify a controlled payment, webhook, receipt, inventory reservation and delivery booking in the correct environment.",
      ],
      action: { label: "Open payments", href: "/admin/payments" },
    },
    {
      id: "tax",
      name: "Stripe Tax",
      state: "verification-needed",
      summary:
        "Tax is calculated through the checkout provider. Provider tax registration and calculation have not been verified by this page.",
      nextSteps: [
        "Complete business tax setup and provider registration.",
        "Verify destination tax on a controlled checkout and compare the stored tax record with its receipt.",
      ],
      action: { label: "Business setup", href: "/admin/settings/business/setup" },
    },
    {
      id: "google",
      name: "Google sign-in",
      state: google && origin ? "verification-needed" : "configuration-needed",
      summary:
        google && origin
          ? "Google credentials and the application origin are configured. Sign-in still needs provider acceptance."
          : "Both Google credentials and a trusted application origin are required.",
      nextSteps: [
        "Configure the Google sign-in client for this environment.",
        "Verify consent, callback, a new customer and an existing email collision using approved test accounts.",
      ],
    },
    {
      id: "email",
      name: "Password recovery email",
      state: email ? "verification-needed" : "configuration-needed",
      summary: email
        ? "SendGrid recovery configuration is present. Inbox delivery and worker operation remain unverified."
        : "Recovery needs a verified sender, mail credential, trusted origin and permitted staging recipients.",
      nextSteps: [
        "Connect a verified SendGrid sender and a mail-send credential securely through hosting settings.",
        "Run the recovery delivery worker every minute.",
        "Verify an approved test inbox receives an expiring link and that using it revokes earlier sessions.",
      ],
    },
    {
      id: "website-media",
      name: "Website photos",
      state: "verification-needed",
      summary:
        "Website photos use durable database storage with private drafts and explicit publication.",
      nextSteps: [
        "Verify upload, save and public display after a staging redeploy.",
        "Verify photo and page recovery from a separate restored database.",
      ],
      action: { label: "Open Website Builder", href: "/admin/website/builder" },
    },
    {
      id: "operating-media",
      name: "Product and delivery photos",
      state: documents.encryption ? "verification-needed" : "configuration-needed",
      summary:
        "Product photos and encrypted delivery proofs use durable database storage. Private proofs retain their customer and driver access checks.",
      nextSteps: [
        "Monitor photo capacity in Background jobs & photo storage and retain encryption keys with backups.",
        "Verify upload, access control and persistence through redeploy and recovery.",
      ],
    },
    {
      id: "documents",
      name: "Private business documents",
      state:
        documents.encryption && documents.scannerConfigured
          ? "verification-needed"
          : "configuration-needed",
      summary: documents.encryption
        ? "Document encryption is configured. File scanning and recovery still need verification."
        : "Private document uploads require a configured encryption key.",
      nextSteps: [
        ...(!documents.encryption
          ? ["Configure and securely retain the document encryption key."]
          : []),
        ...(!documents.scannerConfigured
          ? [
              "Configure the approved document scanner; unverified PDFs remain quarantined.",
            ]
          : []),
        "Verify authorized downloads and recovery with retained encryption keys.",
      ],
      action: { label: "Business documents", href: "/admin/settings/business/documents" },
    },
    {
      id: "maps",
      name: "Delivery coverage map",
      state: "verification-needed",
      summary:
        "The map uses active delivery ZIP settings, cached ZIP centers and an OpenStreetMap background.",
      nextSteps: [
        "Add approved delivery ZIPs and verify their map locations.",
        "Verify map-provider access and ensure the ZIP checker stays available when the background fails.",
      ],
      action: { label: "Launch & capacity", href: "/admin/settings/launch" },
    },
    {
      id: "quickbooks",
      name: "QuickBooks accounting",
      state: "implementation-needed",
      summary:
        "Company authorization, expense mapping and reviewed expense exports are available. Sales/refund/COGS sync and real posting acceptance remain outstanding.",
      nextSteps: [
        "Confirm the intended company, finish account mapping and duplicate-posting protection, and verify sandbox posting before enabling financial sync.",
      ],
      action: { label: "QuickBooks connection", href: "/admin/reports/quickbooks" },
    },
    {
      id: "sms",
      name: "Customer text messages",
      state: "implementation-needed",
      summary:
        "Phone-verified delivery consent, transactional delivery updates, signed receipts and protected recovery are implemented. Sender activation and real delivery acceptance remain outstanding.",
      nextSteps: [
        "Finish the approved sender, customer consent, delivery notifications and retry handling before sending messages.",
      ],
    },
    {
      id: "workers",
      name: "Scheduled recovery jobs",
      state: "verification-needed",
      summary:
        "The operational scheduler records leases, heartbeats, retries and attention counts. See Background jobs & photo storage for its current state.",
      nextSteps: [
        "Schedule payment reconciliation and recovery email delivery with environment-specific credentials.",
        "Verify restart recovery, retries, monitoring and operator alerts.",
      ],
    },
  ];
  return {
    apiEnvironments: environmentSettings(env),
    environment: ["development", "staging", "production"].includes(env.APP_ENV ?? "")
      ? env.APP_ENV!
      : "unknown",
    checkedAt: new Date().toISOString(),
    checkoutEnabled: commerce.enabled,
    callbacks: {
      google: origin ? `${origin}/api/auth/callback/google` : null,
      stripeWebhook: origin ? `${origin}/api/stripe/webhook` : null,
    },
    connections,
  };
}
