import { z } from "zod";
import { AccountError } from "@/lib/domain/account";
export const BUSINESS_ID = "detergents-delivered";
export const structures = ["SOLE", "LLC"] as const;
export type Structure = (typeof structures)[number];
export const structureNames = { SOLE: "Sole proprietor", LLC: "Single-member LLC" };
export const statuses = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUBMITTED",
  "AWAITING_APPROVAL",
  "COMPLETED",
  "BLOCKED",
  "NOT_APPLICABLE",
] as const;
export const statusNames = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted",
  AWAITING_APPROVAL: "Awaiting Approval",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
  NOT_APPLICABLE: "Not Applicable",
};
export const categories = [
  "Formation",
  "DBA / publication",
  "EIN",
  "Illinois registration",
  "Resale certificates",
  "Local permits",
  "Insurance",
  "Banking confirmation",
  "Other",
] as const;
const text = z.string().trim().max(2000);
export const dateField = z.union([z.literal(""), z.iso.date()]);
export const profileSchema = z
  .object({
    tradeName: z.string().trim().max(160),
    legalOwner: z.string().trim().max(160),
    address: text,
    state: z.string().trim().max(50),
    stateConfirmed: z.boolean(),
    county: z.string().trim().max(100),
    municipality: z.string().trim().max(100),
    premises: z.enum(["", "HOME", "COMMERCIAL"]),
    owners: z.number().int().min(1).max(100),
    employees: z.enum(["", "YES", "NO"]),
    products: z.enum(["", "SEALED", "MANUFACTURE", "REBOTTLE", "RELABEL"]),
    transfers: z.enum(["", "YES", "NO"]),
    existing: z
      .array(
        z.enum(["formation", "dba", "ein", "illinois", "bank", "insurance", "stripe"]),
      )
      .max(7),
    existingConfirmed: z.boolean(),
    assumedName: z.enum(["", "YES", "NO"]),
  })
  .strict();
export type BusinessProfile = z.infer<typeof profileSchema>;
export const emptyProfile: BusinessProfile = {
  tradeName: "DetergentsDelivered",
  legalOwner: "",
  address: "",
  state: "IL",
  stateConfirmed: false,
  county: "",
  municipality: "",
  premises: "",
  owners: 1,
  employees: "",
  products: "",
  transfers: "",
  existing: [],
  existingConfirmed: false,
  assumedName: "",
};
export function requireProfile(p: BusinessProfile) {
  if (p.owners !== 1)
    throw new AccountError(
      "Multiple owners need a different-structure review. Do not continue with either single-owner process.",
    );
  if (!["IL", "ILLINOIS"].includes(p.state.toUpperCase()) || !p.stateConfirmed)
    throw new AccountError(
      "Confirm Illinois or obtain a state-specific review before selecting this Illinois checklist.",
    );
  if (
    !p.tradeName ||
    !p.legalOwner ||
    !p.address ||
    !p.county ||
    !p.municipality ||
    !p.premises ||
    !p.employees ||
    !p.products ||
    !p.transfers ||
    !p.existingConfirmed ||
    !p.assumedName
  )
    throw new AccountError(
      "Complete the business profile and confirm existing registrations before choosing a structure.",
    );
}
export const taskSchema = z
  .object({
    status: z.enum(statuses),
    notes: text,
    nextAction: text,
    reference: z.string().trim().max(200),
    providerUrl: z.union([
      z.literal(""),
      z
        .url()
        .max(1000)
        .refine((v) => {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        }, "Use an HTTPS provider website without credentials."),
    ]),
    filedDate: dateField,
    approvedDate: dateField,
    deadline: dateField,
    publicationDates: z.array(dateField).length(3),
    proofReceived: z.boolean(),
    proofReceivedDate: dateField,
    actualPaidCents: z.number().int().min(0).max(100000000).nullable(),
    variablePaidCents: z.number().int().min(0).max(100000000).nullable(),
    attestation: text,
    naReason: text,
    applicabilityConfirmed: z.boolean(),
    existing: z.boolean(),
    documentIds: z.array(z.string().max(100)).max(20),
    updatedAt: z.string(),
  })
  .strict();
export type TaskRecord = z.infer<typeof taskSchema>;
export const emptyTask: TaskRecord = {
  status: "NOT_STARTED",
  notes: "",
  nextAction: "",
  reference: "",
  providerUrl: "",
  filedDate: "",
  approvedDate: "",
  deadline: "",
  publicationDates: ["", "", ""],
  proofReceived: false,
  proofReceivedDate: "",
  actualPaidCents: null,
  variablePaidCents: null,
  attestation: "",
  naReason: "",
  applicabilityConfirmed: false,
  existing: false,
  documentIds: [],
  updatedAt: "",
};
export const planSchema = z.object({
  id: z.string(),
  structure: z.enum(structures),
  profile: profileSchema,
  tasks: z.record(z.string(), taskSchema),
  createdAt: z.string(),
  filingsStartedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  transitionFrom: z.string().nullable(),
  reviewNotes: text,
});
export type BusinessPlan = z.infer<typeof planSchema>;
export const setupSchema = z.object({
  profile: profileSchema,
  activePlanId: z.string().nullable(),
  plans: z.array(planSchema).max(50),
  transition: z
    .object({
      target: z.enum(structures),
      reason: text,
      requestedAt: z.string(),
      draftProfile: profileSchema,
      draftReviewNotes: text,
    })
    .nullable(),
});
export type SetupData = z.infer<typeof setupSchema>;
export const emptySetup: SetupData = {
  profile: emptyProfile,
  activePlanId: null,
  plans: [],
  transition: null,
};
export function activePlan(data: SetupData) {
  return data.plans.find((p) => p.id === data.activePlanId);
}
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function annualDue(
  formation: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const d = new Date(`${formation}T12:00:00Z`);
  let year = Math.max(d.getUTCFullYear() + 1, Number(today.slice(0, 4)));
  let due = new Date(Date.UTC(year, d.getUTCMonth(), 0, 12)).toISOString().slice(0, 10);
  if (due < today) {
    year++;
    due = new Date(Date.UTC(year, d.getUTCMonth(), 0, 12)).toISOString().slice(0, 10);
  }
  return due;
}
export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  deliveredDate: dateField,
  acceptedDate: dateField,
  notes: text,
});
export const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transition-draft"),
    profile: profileSchema,
    reviewNotes: text,
  }),
  z.object({ action: z.literal("profile"), profile: profileSchema }),
  z.object({
    action: z.literal("choose"),
    structure: z.enum(structures),
    acknowledge: z.literal(true),
  }),
  z.object({ action: z.literal("change"), acknowledge: z.literal(true) }),
  z.object({
    action: z.literal("transition"),
    target: z.enum(structures),
    reason: text.min(20),
  }),
  z.object({
    action: z.literal("transition-reviewed"),
    profile: profileSchema,
    reviewNotes: text.min(30),
    acknowledge: z.literal(true),
  }),
  z.object({ action: z.literal("step"), key: z.string().max(100), task: taskSchema }),
  z.object({ action: z.literal("supplier"), supplier: supplierSchema }),
  z.object({ action: z.literal("finish"), reviewed: z.literal(true) }),
  z.object({ action: z.literal("access"), email: z.email(), grant: z.boolean() }),
]);
