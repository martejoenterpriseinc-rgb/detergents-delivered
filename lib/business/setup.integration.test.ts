import "@/tests/integration-guard";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { businessFixture } from "@/tests/business-fixture";
import { emptyProfile, emptyTask, activePlan } from "./domain";
import { getBusinessSetup, mutateBusinessSetup, readSetup } from "./service";
import {
  documentAction,
  downloadBusinessDocument,
  listBusinessDocuments,
  uploadBusinessDocument,
} from "./documents";
import { scanDocument } from "./document-security";
vi.mock("./document-security", async (original) => ({
  ...(await original<typeof import("./document-security")>()),
  scanDocument: vi.fn(async () => "CLEAN"),
}));
const profile = {
  ...emptyProfile,
  tradeName: "Synthetic Business",
  legalOwner: "Synthetic Owner LLC",
  address: "123 Test Lane",
  stateConfirmed: true,
  county: "McHenry",
  municipality: "Lake in the Hills",
  premises: "HOME" as const,
  employees: "NO" as const,
  products: "SEALED" as const,
  transfers: "NO" as const,
  existingConfirmed: true,
  assumedName: "NO" as const,
};
let f: Awaited<ReturnType<typeof businessFixture>>;
beforeEach(async () => {
  vi.stubEnv("DD_BUSINESS_DOCUMENT_KEYS", JSON.stringify({ test: "34".repeat(32) }));
  vi.stubEnv("DD_BUSINESS_DOCUMENT_ACTIVE_KEY", "test");
  vi.mocked(scanDocument).mockResolvedValue("CLEAN");
  f = await businessFixture(prisma);
});
afterEach(async () => {
  await f.cleanup();
  vi.unstubAllEnvs();
});
async function cmd(command: unknown, userId = f.owner.id) {
  return mutateBusinessSetup(userId, { version: (await readSetup()).version, command });
}
async function choose(structure: "SOLE" | "LLC" = "LLC") {
  await cmd({ action: "profile", profile });
  return cmd({ action: "choose", structure, acknowledge: true });
}
async function upload(overrides: Record<string, unknown> = {}) {
  const state = await readSetup();
  const bytes = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  return uploadBusinessDocument(
    f.owner.id,
    {
      requestKey: randomUUID(),
      setupVersion: state.version,
      title: "Synthetic evidence",
      category: "Formation",
      planId: state.data.activePlanId,
      stepKey: "formation",
      issueDate: "",
      expiryDate: "",
      notes: "",
      ...overrides,
    },
    bytes,
    "image/png",
  );
}
it("saves profile and either explicit selection while preserving inactive history", async () => {
  const sole = await choose("SOLE");
  expect(sole.definitions.some((d) => d.key === "formation")).toBe(false);
  await cmd({ action: "change", acknowledge: true });
  const llc = await cmd({ action: "choose", structure: "LLC", acknowledge: true });
  expect(llc.definitions.some((d) => d.key === "dba")).toBe(false);
  expect(llc.data.plans).toHaveLength(2);
  expect((await getBusinessSetup(f.owner.id)).data.profile).toEqual(profile);
});
it("rejects stale concurrent writes without losing the confirmed profile", async () => {
  const version = (await readSetup()).version;
  const results = await Promise.allSettled([
    mutateBusinessSetup(f.owner.id, { version, command: { action: "profile", profile } }),
    mutateBusinessSetup(f.owner.id, {
      version,
      command: { action: "profile", profile: { ...profile, tradeName: "Other" } },
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await prisma.businessSetupRevision.count()).toBe(1);
});
it("keeps submitted separate from completed and blocks silent identity changes", async () => {
  await choose();
  await cmd({
    action: "step",
    key: "formation",
    task: { ...emptyTask, status: "SUBMITTED", filedDate: "2026-08-01" },
  });
  expect((await getBusinessSetup(f.owner.id)).progress.pending).toBe(1);
  await expect(cmd({ action: "change", acknowledge: true })).rejects.toThrow(
    /guided transition/,
  );
  await expect(
    cmd({ action: "profile", profile: { ...profile, legalOwner: "New Owner" } }),
  ).rejects.toThrow(/transition/);
  await cmd({
    action: "transition",
    target: "SOLE",
    reason: "Synthetic review of ownership and registrations is required.",
  });
  const next = await cmd({
    action: "transition-reviewed",
    profile: { ...profile, legalOwner: "Synthetic New Owner" },
    reviewNotes:
      "Synthetic adviser reviewed the transfer and identified new registrations; old accounts remain unchanged.",
    acknowledge: true,
  });
  expect(next.data.plans).toHaveLength(2);
  expect(next.data.plans[0].tasks.formation.status).toBe("SUBMITTED");
  expect(activePlan(next.data)?.tasks.illinois.status).toBe("NOT_STARTED");
});
it("enforces owner and explicit administrator access on every sensitive operation", async () => {
  await expect(getBusinessSetup(f.admin.id)).rejects.toMatchObject({ status: 403 });
  await expect(listBusinessDocuments(f.customer.id)).rejects.toMatchObject({
    status: 403,
  });
  await cmd({ action: "access", email: f.admin.email, grant: true });
  expect((await getBusinessSetup(f.admin.id)).owner).toBe(false);
  await expect(
    cmd({ action: "access", email: f.admin.email, grant: false }, f.admin.id),
  ).rejects.toMatchObject({ status: 403 });
  await cmd({ action: "access", email: f.admin.email, grant: false });
  await expect(getBusinessSetup(f.admin.id)).rejects.toMatchObject({ status: 403 });
});
it("stores encrypted documents, prevents duplicate retries and binds downloads to identity", async () => {
  await choose();
  const state = await readSetup();
  const meta = {
    requestKey: randomUUID(),
    setupVersion: state.version,
    title: "Private synthetic evidence",
    category: "Formation",
    planId: state.data.activePlanId,
    stepKey: "formation",
    issueDate: "",
    expiryDate: "",
    notes: "",
  };
  const bytes = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const saved = await uploadBusinessDocument(f.owner.id, meta, bytes, "image/png");
  expect(
    await uploadBusinessDocument(f.owner.id, meta, bytes, "image/png"),
  ).toMatchObject({ id: saved.id, duplicate: true });
  const row = await prisma.businessDocumentVersion.findFirstOrThrow({
    where: { documentId: saved.id },
  });
  expect(Buffer.from(row.ciphertext!).subarray(0, 8)).not.toEqual(bytes.subarray(0, 8));
  const access = (await documentAction(f.owner.id, {
    action: "access",
    versionId: row.id,
  })) as { url: string };
  const token = new URL(access.url, "https://example.test").searchParams.get("token")!;
  expect((await downloadBusinessDocument(f.owner.id, row.id, token)).contentType).toBe(
    "image/png",
  );
  await expect(
    downloadBusinessDocument(f.customer.id, row.id, token),
  ).rejects.toMatchObject({ status: 403 });
  await prisma.user.update({
    where: { id: f.owner.id },
    data: { sessionVersion: { increment: 1 } },
  });
  await expect(downloadBusinessDocument(f.owner.id, row.id, token)).rejects.toMatchObject(
    { status: 403 },
  );
});
it("quarantines unavailable scans and rejects detected files without exposing downloads", async () => {
  await choose();
  vi.mocked(scanDocument).mockResolvedValue("QUARANTINED");
  const saved = await upload();
  const row = await prisma.businessDocumentVersion.findFirstOrThrow({
    where: { documentId: saved.id },
  });
  await expect(
    documentAction(f.owner.id, { action: "access", versionId: row.id }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    cmd({
      action: "step",
      key: "formation",
      task: {
        ...emptyTask,
        status: "COMPLETED",
        approvedDate: "2026-08-01",
        reference: "SYNTHETIC",
        documentIds: [saved.id],
      },
    }),
  ).rejects.toThrow(/scanning/);
  vi.mocked(scanDocument).mockResolvedValue("REJECTED");
  await expect(upload()).rejects.toMatchObject({ status: 415 });
  expect(await prisma.businessDocument.count()).toBe(1);
});
it("replacement preserves prior versions and removal forces renewed evidence review", async () => {
  await choose();
  const saved = await upload();
  await cmd({
    action: "step",
    key: "formation",
    task: {
      ...emptyTask,
      status: "COMPLETED",
      approvedDate: "2026-08-01",
      reference: "SYNTHETIC",
      documentIds: [saved.id],
    },
  });
  await upload({ documentId: saved.id, version: 1 });
  expect((await readSetup()).data.plans[0].tasks.formation.status).toBe("IN_PROGRESS");
  expect(
    await prisma.businessDocumentVersion.count({ where: { documentId: saved.id } }),
  ).toBe(2);
  await expect(upload({ documentId: saved.id, version: 1 })).rejects.toThrow(
    /another session/,
  );
  await documentAction(f.owner.id, {
    action: "delete",
    documentId: saved.id,
    version: 2,
    acknowledge: true,
  });
  expect(
    await prisma.businessDocumentVersion.count({ where: { ciphertext: { not: null } } }),
  ).toBe(0);
  expect((await listBusinessDocuments(f.owner.id)).documents).toHaveLength(0);
});
it("finishes only a complete owner-reviewed checklist and keeps recurring deadlines", async () => {
  const before = await Promise.all([
    prisma.order.count(),
    prisma.inventoryBalance.count(),
    prisma.subscription.count(),
    prisma.routeStop.count(),
    prisma.payment.count(),
    prisma.checkoutAttempt.count(),
  ]);
  await choose();
  await cmd({
    action: "supplier",
    supplier: {
      name: "Synthetic Vendor",
      deliveredDate: "",
      acceptedDate: "",
      notes: "",
    },
  });
  let state = await getBusinessSetup(f.owner.id);
  for (const def of [
    ...state.definitions.filter((d) => d.key !== "suppliers"),
    state.definitions.find((d) => d.key === "suppliers")!,
  ]) {
    state = await cmd({
      action: "step",
      key: def.key,
      task: {
        ...emptyTask,
        status: "COMPLETED",
        reference: "SYNTHETIC-CONFIRMED",
        filedDate: "2026-08-01",
        approvedDate: "2026-08-02",
        deadline: def.recurring ? "2027-07-31" : "",
        attestation:
          "Synthetic owner confirmed the completed requirement with the named authority.",
      },
    });
  }
  expect(state.progress.percent).toBe(100);
  await expect(
    cmd({ action: "finish", reviewed: true }, f.admin.id),
  ).rejects.toMatchObject({ status: 403 });
  state = await cmd({ action: "finish", reviewed: true });
  expect(activePlan(state.data)?.completedAt).not.toBeNull();
  expect(state.progress.deadlines.length).toBeGreaterThan(0);
  expect(
    await Promise.all([
      prisma.order.count(),
      prisma.inventoryBalance.count(),
      prisma.subscription.count(),
      prisma.routeStop.count(),
      prisma.payment.count(),
      prisma.checkoutAttempt.count(),
    ]),
  ).toEqual(before);
});

it("rolls back the profile and private history when the audit write fails", async () => {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION dd_business_audit_test_fail() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.action LIKE ''business.%'' THEN RAISE EXCEPTION ''synthetic audit failure''; END IF; RETURN NEW; END'`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER dd_business_audit_test BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dd_business_audit_test_fail()`,
  );
  try {
    await expect(cmd({ action: "profile", profile })).rejects.toThrow();
    expect((await readSetup()).version).toBe(0);
    expect(await prisma.businessSetupRevision.count()).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER dd_business_audit_test ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION dd_business_audit_test_fail()`);
  }
});
