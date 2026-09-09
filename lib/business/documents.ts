import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
import { categories, dateField } from "./domain";
import {
  businessAccess,
  readSetup,
  setupLock,
  writeSetup,
  type BusinessDb,
} from "./service";
import {
  checkDownloadToken,
  contentHash,
  decryptDocument,
  documentReadiness,
  downloadToken,
  encryptDocument,
  scanDocument,
  validateDocument,
} from "./document-security";
import { planDefinitions } from "./definitions";
export const uploadSchema = z
  .object({
    requestKey: z.uuid(),
    setupVersion: z.number().int().min(0),
    documentId: z.string().max(100).optional(),
    version: z.number().int().min(1).optional(),
    title: z.string().trim().min(1).max(160),
    category: z.enum(categories),
    planId: z.string().max(100).nullable(),
    stepKey: z.string().max(100).nullable(),
    issueDate: dateField,
    expiryDate: dateField,
    notes: z.string().trim().max(2000),
  })
  .strict();
export async function listBusinessDocuments(userId: string) {
  const { owner } = await businessAccess(prisma, userId);
  const documents = await prisma.businessDocument.findMany({
    where: { deletedAt: null },
    orderBy: { updatedAt: "desc" },
    include: {
      versions: {
        select: {
          id: true,
          number: true,
          metadataJson: true,
          contentType: true,
          size: true,
          scanStatus: true,
          scannedAt: true,
          createdAt: true,
          deletedAt: true,
        },
        orderBy: { number: "desc" },
      },
    },
  });
  return { documents, owner, readiness: documentReadiness() };
}
async function invalidateEvidence(
  tx: BusinessDb,
  userId: string,
  documentId: string,
  action: string,
) {
  const current = await readSetup(tx);
  const related = await tx.businessDocument.findUnique({
    where: { id: documentId },
    select: { planId: true, stepKey: true },
  });
  for (const plan of current.data.plans)
    for (const [key, task] of Object.entries(plan.tasks))
      if (
        task.documentIds.includes(documentId) ||
        (related?.planId === plan.id && related.stepKey === key)
      ) {
        task.documentIds = task.documentIds.filter((id) => id !== documentId);
        if (task.status === "COMPLETED") {
          task.status = "IN_PROGRESS";
          task.nextAction =
            "Supporting evidence changed or was removed. Review and confirm completion again.";
          task.updatedAt = new Date().toISOString();
        }
        plan.completedAt = null;
      }
  await writeSetup(tx, userId, current.version, current.data, action);
}
export async function uploadBusinessDocument(
  userId: string,
  input: unknown,
  bytes: Buffer,
  contentType: string,
) {
  await businessAccess(prisma, userId);
  const meta = uploadSchema.parse(input);
  if (meta.expiryDate && meta.issueDate && meta.expiryDate < meta.issueDate)
    throw new AccountError("Expiration cannot precede issue date.");
  // Validate and scan outside transaction. Encrypted bytes are durable in the existing private PostgreSQL database.
  const content = await validateDocument(bytes, contentType);
  const hash = contentHash(content.bytes);
  const requestHash = contentHash(
    Buffer.from(JSON.stringify({ ...meta, requestKey: undefined }) + hash),
  );
  const old = await prisma.businessDocumentVersion.findUnique({
    where: { requestKey: meta.requestKey },
  });
  if (old) {
    if (old.uploadedBy !== userId || old.requestHash !== requestHash || old.deletedAt)
      throw new AccountError("Upload request already used for different content.", 409);
    return { id: old.documentId, duplicate: true };
  }
  const versionId = randomUUID();
  const encrypted = encryptDocument(content.bytes, versionId);
  const scanStatus = await scanDocument(content.bytes);
  if (scanStatus === "REJECTED")
    throw new AccountError(
      "Security scanning rejected this file. It was not saved.",
      415,
    );
  return prisma.$transaction(async (tx) => {
    await businessAccess(tx, userId);
    await setupLock(tx);
    const retry = await tx.businessDocumentVersion.findUnique({
      where: { requestKey: meta.requestKey },
    });
    if (retry) {
      if (
        retry.uploadedBy !== userId ||
        retry.requestHash !== requestHash ||
        retry.deletedAt
      )
        throw new AccountError("Conflicting upload retry.", 409);
      return { id: retry.documentId, duplicate: true };
    }
    const state = await readSetup(tx);
    if (state.version !== meta.setupVersion)
      throw new AccountError("Business setup changed. Reload before uploading.", 409);
    if (meta.planId) {
      const plan = state.data.plans.find((p) => p.id === meta.planId);
      if (
        !plan ||
        (meta.stepKey && !planDefinitions(plan).some((d) => d.key === meta.stepKey))
      )
        throw new AccountError("Invalid business plan or related step.", 404);
    } else if (meta.stepKey)
      throw new AccountError("A related step requires its business plan.");
    const total = await tx.businessDocumentVersion.aggregate({
      where: { deletedAt: null },
      _sum: { size: true },
      _count: true,
    });
    if (
      (total._sum.size ?? 0) + content.bytes.length > 250 * 1024 * 1024 ||
      total._count >= 500
    )
      throw new AccountError(
        "The private document allowance is full. Review retained versions or contact the owner.",
        409,
      );
    const { requestKey, setupVersion: _setup, version, documentId, ...metadata } = meta;
    void _setup;
    let id = documentId;
    let number = 1;
    if (id) {
      const existing = await tx.businessDocument.findUnique({ where: { id } });
      if (!existing || existing.deletedAt)
        throw new AccountError("Document not found.", 404);
      if (existing.version !== version)
        throw new AccountError(
          "Document changed in another session. Reload before replacing it.",
          409,
        );
      if (existing.planId !== meta.planId || existing.stepKey !== meta.stepKey)
        throw new AccountError(
          "Replacement must retain the original plan and related step.",
        );
      number = existing.version + 1;
      await tx.businessDocument.update({
        where: { id },
        data: {
          ...metadata,
          version: number,
          issueDate: meta.issueDate || null,
          expiryDate: meta.expiryDate || null,
        },
      });
      await invalidateEvidence(tx, userId, id, "document.replaced");
    } else {
      const document = await tx.businessDocument.create({
        data: {
          ...metadata,
          issueDate: meta.issueDate || null,
          expiryDate: meta.expiryDate || null,
        },
      });
      id = document.id;
      await writeSetup(tx, userId, state.version, state.data, "document.uploaded");
    }
    await tx.businessDocumentVersion.create({
      data: {
        id: versionId,
        documentId: id,
        number,
        requestKey,
        requestHash,
        metadataJson: metadata as unknown as Prisma.InputJsonValue,
        uploadedBy: userId,
        contentType: content.contentType,
        size: content.bytes.length,
        sha256: hash,
        ...encrypted,
        scanStatus,
        scannedAt: scanStatus === "CLEAN" ? new Date() : null,
      },
    });
    return { id, duplicate: false, scanStatus };
  });
}
export async function documentAction(userId: string, input: unknown) {
  const data = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("access"), versionId: z.string().max(100) }),
      z.object({
        action: z.literal("delete"),
        documentId: z.string().max(100),
        version: z.number().int(),
        acknowledge: z.literal(true),
      }),
      z.object({ action: z.literal("scan"), versionId: z.string().max(100) }),
    ])
    .parse(input);
  const { user } = await businessAccess(prisma, userId);
  if (data.action === "access") {
    const row = await prisma.businessDocumentVersion.findFirst({
      where: {
        id: data.versionId,
        deletedAt: null,
        scanStatus: "CLEAN",
        document: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!row)
      throw new AccountError("Document is unavailable or still quarantined.", 404);
    return {
      url: `/api/admin/business/documents/${row.id}?token=${downloadToken(userId, user.sessionVersion, row.id)}`,
    };
  }
  if (data.action === "delete")
    return prisma.$transaction(async (tx) => {
      await businessAccess(tx, userId, true);
      await setupLock(tx);
      const doc = await tx.businessDocument.findUnique({
        where: { id: data.documentId },
      });
      if (!doc || doc.deletedAt) throw new AccountError("Document not found.", 404);
      if (doc.version !== data.version)
        throw new AccountError("Document changed. Reload before deleting.", 409);
      await tx.businessDocument.update({
        where: { id: doc.id },
        data: { deletedAt: new Date() },
      });
      // Remove payloads; keep minimal version/audit metadata. Provider backups expire under retention policy.
      await tx.businessDocumentVersion.updateMany({
        where: { documentId: doc.id },
        data: { ciphertext: null, deletedAt: new Date() },
      });
      await invalidateEvidence(tx, userId, doc.id, "document.deleted");
      return { ok: true };
    });
  const row = await prisma.businessDocumentVersion.findFirst({
    where: {
      id: data.versionId,
      deletedAt: null,
      scanStatus: "QUARANTINED",
      document: { deletedAt: null },
    },
  });
  if (!row?.ciphertext) throw new AccountError("Quarantined document not found.", 404);
  const bytes = decryptDocument(row.ciphertext, row.id, row.keyId);
  const status = await scanDocument(bytes);
  if (status === "QUARANTINED")
    throw new AccountError(
      "The malware scanner is unavailable. The file remains encrypted and quarantined.",
      503,
    );
  await prisma.$transaction(async (tx) => {
    await businessAccess(tx, userId);
    await setupLock(tx);
    const changed = await tx.businessDocumentVersion.updateMany({
      where: {
        id: row.id,
        deletedAt: null,
        scanStatus: "QUARANTINED",
        document: { deletedAt: null },
      },
      data: {
        scanStatus: status,
        scannedAt: new Date(),
        ...(status === "REJECTED" ? { ciphertext: null } : {}),
      },
    });
    if (!changed.count) throw new AccountError("Document changed during scanning.", 409);
    const state = await readSetup(tx);
    await writeSetup(tx, userId, state.version, state.data, "document.scanned");
  });
  return { status };
}
export async function downloadBusinessDocument(
  userId: string,
  versionId: string,
  token: string,
) {
  const { user } = await businessAccess(prisma, userId);
  checkDownloadToken(token, userId, user.sessionVersion, versionId);
  const row = await prisma.businessDocumentVersion.findFirst({
    where: {
      id: versionId,
      deletedAt: null,
      scanStatus: "CLEAN",
      document: { deletedAt: null },
    },
  });
  if (!row?.ciphertext) throw new AccountError("Document unavailable.", 404);
  const bytes = decryptDocument(row.ciphertext, row.id, row.keyId);
  if (contentHash(bytes) !== row.sha256)
    throw new AccountError("Document integrity check failed.", 503);
  return {
    bytes,
    contentType: row.contentType,
    filename: `business-document-v${row.number}.${row.contentType === "application/pdf" ? "pdf" : "png"}`,
  };
}
