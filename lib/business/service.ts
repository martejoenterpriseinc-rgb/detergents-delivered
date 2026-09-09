import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { accountIdentity } from "@/lib/services/customer-account";
import { AccountError } from "@/lib/domain/account";
import {
  BUSINESS_ID,
  activePlan,
  actionSchema,
  emptySetup,
  emptyTask,
  requireProfile,
  setupSchema,
  addDays,
  type SetupData,
  type BusinessPlan,
  type TaskRecord,
} from "./domain";
import {
  definitions,
  planDefinitions,
  progress,
  type StepDefinition,
} from "./definitions";
export type BusinessDb = Prisma.TransactionClient;
export async function businessAccess(db: BusinessDb, userId: string, ownerOnly = false) {
  const user = await accountIdentity(db, userId);
  const owner = user.userRoles.some((r) => r.role.code === "SUPER_ADMIN");
  const granted =
    !ownerOnly &&
    user.userRoles.some((r) => r.role.code === "ADMIN") &&
    (await db.businessAccess.findUnique({ where: { userId } }));
  if (!owner && !granted)
    throw new AccountError(
      "Owner or explicitly authorized business administrator access required.",
      403,
    );
  return { user, owner };
}
export async function readSetup(db: BusinessDb = prisma) {
  const row = await db.businessSetup.findUnique({ where: { id: BUSINESS_ID } });
  return {
    version: row?.version ?? 0,
    data: row ? setupSchema.parse(row.dataJson) : structuredClone(emptySetup),
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
export async function setupLock(db: BusinessDb) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(613279109)`;
}
export async function writeSetup(
  db: BusinessDb,
  userId: string,
  version: number,
  data: SetupData,
  action: string,
) {
  const parsed = setupSchema.parse(data);
  await db.businessSetup.upsert({
    where: { id: BUSINESS_ID },
    create: {
      id: BUSINESS_ID,
      version: version + 1,
      dataJson: parsed as unknown as Prisma.InputJsonValue,
    },
    update: {
      version: version + 1,
      dataJson: parsed as unknown as Prisma.InputJsonValue,
    },
  });
  await db.businessSetupRevision.create({
    data: {
      version: version + 1,
      actorId: userId,
      action,
      dataJson: parsed as unknown as Prisma.InputJsonValue,
    },
  });
  // Sensitive profile, notes and document metadata stay out of the general audit stream.
  await db.auditLog.create({
    data: {
      actorUserId: userId,
      action: `business.${action}`,
      entityType: "BusinessSetup",
      entityId: BUSINESS_ID,
      afterJson: { version: version + 1 },
    },
  });
}
export async function getBusinessSetup(userId: string) {
  const { owner } = await businessAccess(prisma, userId);
  const result = await readSetup();
  const plan = activePlan(result.data);
  return {
    ...result,
    owner,
    progress: progress(plan),
    definitions: plan ? planDefinitions(plan) : [],
    history: await prisma.businessSetupRevision.findMany({
      select: { version: true, action: true, createdAt: true },
      orderBy: { version: "desc" },
      take: 50,
    }),
    grants: owner
      ? await prisma.businessAccess.findMany({ select: { userId: true } })
      : [],
  };
}
export type BusinessWorkspace = Awaited<ReturnType<typeof getBusinessSetup>>;
export function checkTask(
  plan: BusinessPlan,
  def: StepDefinition,
  task: TaskRecord,
  cleanEvidence: boolean,
  today = new Date().toISOString().slice(0, 10),
) {
  if (
    [
      task.filedDate,
      task.approvedDate,
      task.proofReceivedDate,
      ...task.publicationDates,
    ].some((d) => d && d > today)
  )
    throw new AccountError(
      "Completed filing, approval and publication dates cannot be in the future.",
    );
  if (task.approvedDate && task.filedDate && task.approvedDate < task.filedDate)
    throw new AccountError("Approval cannot precede filing.");
  if (["SUBMITTED", "AWAITING_APPROVAL"].includes(task.status) && !task.filedDate)
    throw new AccountError("Record the submission date.");
  if (task.status === "NOT_APPLICABLE") {
    if (
      !def.allowNA ||
      task.naReason.length < 20 ||
      (def.unknown && !task.applicabilityConfirmed)
    )
      throw new AccountError(
        "Record an allowed, supported Not Applicable decision with a reason and resolve unknown requirements.",
      );
    return;
  }
  if (["SUBMITTED", "AWAITING_APPROVAL", "COMPLETED"].includes(task.status)) {
    for (const dep of def.dependencies ?? [])
      if (!["COMPLETED", "NOT_APPLICABLE"].includes(plan.tasks[dep]?.status))
        throw new AccountError(
          `Complete the prerequisite ${dep} before recording submission or completion.`,
        );
  }
  if (task.status !== "COMPLETED") return;
  if (!cleanEvidence && task.attestation.length < 20)
    throw new AccountError(
      "Add cleared supporting evidence or an explicit completion attestation of at least 20 characters.",
    );
  if (def.unknown && (!task.applicabilityConfirmed || task.notes.length < 20))
    throw new AccountError(
      "Record the agency/professional response and confirm applicability before completing this review.",
    );
  if (def.approval && !task.approvedDate)
    throw new AccountError(
      "Record actual approval or acceptance; submission alone is not completion.",
    );
  if (["formation", "illinois"].includes(def.key) && !task.reference)
    throw new AccountError("Record the state file number or Illinois account ID.");
  if (def.key === "dba" && !def.unknown) {
    const dates = task.publicationDates;
    if (
      !task.filedDate ||
      !task.proofReceived ||
      dates.some((d) => !d) ||
      dates[0] < task.filedDate ||
      dates[0] > addDays(task.filedDate, 15) ||
      dates[1] <= dates[0] ||
      dates[2] <= dates[1] ||
      Math.floor((Date.parse(dates[1]) + 3 * 86400000) / (7 * 86400000)) !==
        Math.floor((Date.parse(dates[0]) + 3 * 86400000) / (7 * 86400000)) + 1 ||
      Math.floor((Date.parse(dates[2]) + 3 * 86400000) / (7 * 86400000)) !==
        Math.floor((Date.parse(dates[1]) + 3 * 86400000) / (7 * 86400000)) + 1 ||
      !task.proofReceivedDate ||
      task.proofReceivedDate < dates[2] ||
      task.proofReceivedDate > addDays(task.filedDate, 50) ||
      task.approvedDate < task.proofReceivedDate
    )
      throw new AccountError(
        "Confirm three weekly publications, first within 15 days, and clerk receipt within 50 days and the final certificate. If a deadline was missed, resolve with the clerk and record a new valid filing.",
      );
  }
  if (def.key === "annual" && !task.deadline)
    throw new AccountError(
      "Confirm and save the next annual-report deadline against the state record.",
    );
  if (def.key === "tax-ready" && !task.deadline)
    throw new AccountError(
      "Save the next filing deadline and record the filing-frequency confirmation.",
    );
  if (def.key === "suppliers") {
    const suppliers = Object.entries(plan.tasks).filter(([k]) =>
      k.startsWith("supplier:"),
    );
    if (!suppliers.length || suppliers.some(([, t]) => t.status !== "COMPLETED"))
      throw new AccountError(
        "Add and complete a separate certificate/acceptance record for each supplier first.",
      );
  }
}
export async function mutateBusinessSetup(userId: string, input: unknown) {
  const envelope = z
    .object({ version: z.number().int().min(0), command: actionSchema })
    .strict()
    .parse(input);
  await prisma.$transaction(async (tx) => {
    const { owner } = await businessAccess(tx, userId);
    await setupLock(tx);
    const current = await readSetup(tx);
    if (current.version !== envelope.version)
      throw new AccountError(
        "Business setup changed in another session. Reload the saved version before applying these edits.",
        409,
      );
    const data = current.data;
    const plan = activePlan(data);
    const c = envelope.command;
    const now = new Date().toISOString();
    if (c.action === "profile") {
      if (plan?.filingsStartedAt)
        throw new AccountError(
          "A filing has been recorded. Use a reviewed transition to change this legal profile; existing records stay intact.",
          409,
        );
      data.profile = c.profile;
      if (plan) {
        requireProfile(c.profile);
        plan.profile = c.profile;
        plan.completedAt = null;
        for (const t of Object.values(plan.tasks))
          if (["COMPLETED", "NOT_APPLICABLE"].includes(t.status)) {
            t.status = "IN_PROGRESS";
            t.nextAction = "Profile changed. Review applicability and prior evidence.";
          }
      }
    } else if (c.action === "choose") {
      if (!owner)
        throw new AccountError("The owner must choose the business structure.", 403);
      if (plan)
        throw new AccountError(
          "Use Change Business Type before choosing another structure.",
          409,
        );
      requireProfile(data.profile);
      const next: BusinessPlan = {
        id: randomUUID(),
        structure: c.structure,
        profile: structuredClone(data.profile),
        tasks: {},
        createdAt: now,
        filingsStartedAt: null,
        completedAt: null,
        transitionFrom: null,
        reviewNotes: "",
      };
      for (const d of definitions(next.profile, next.structure))
        next.tasks[d.key] = {
          ...structuredClone(emptyTask),
          existing: next.profile.existing.includes(
            d.key as (typeof next.profile.existing)[number],
          ),
        };
      data.plans.push(next);
      data.activePlanId = next.id;
    } else if (c.action === "change") {
      if (!owner) throw new AccountError("Owner review required.", 403);
      if (plan?.filingsStartedAt)
        throw new AccountError(
          "Submitted filings require a guided transition. Original filings and documents cannot be rewritten.",
          409,
        );
      data.activePlanId = null;
    } else if (c.action === "transition") {
      if (!owner || !plan?.filingsStartedAt)
        throw new AccountError(
          "A transition requires the owner and a recorded filing.",
          403,
        );
      data.transition = {
        target: c.target,
        reason: c.reason,
        requestedAt: now,
        draftProfile: {
          ...structuredClone(plan.profile),
          existing: [],
          existingConfirmed: false,
        },
        draftReviewNotes: "",
      };
    } else if (c.action === "transition-draft") {
      if (!owner || !data.transition)
        throw new AccountError("Owner transition review is required.", 403);
      data.transition.draftProfile = c.profile;
      data.transition.draftReviewNotes = c.reviewNotes;
    } else if (c.action === "transition-reviewed") {
      if (!owner || !data.transition || !plan)
        throw new AccountError("Owner transition review is required.", 403);
      requireProfile(c.profile);
      // Fresh plan, no carried tax IDs, completed tasks or evidence links. Original plan is immutable history.
      const next: BusinessPlan = {
        id: randomUUID(),
        structure: data.transition.target,
        profile: c.profile,
        tasks: {},
        createdAt: now,
        filingsStartedAt: null,
        completedAt: null,
        transitionFrom: plan.id,
        reviewNotes: c.reviewNotes,
      };
      for (const d of definitions(next.profile, next.structure))
        next.tasks[d.key] = structuredClone(emptyTask);
      data.plans.push(next);
      data.activePlanId = next.id;
      data.profile = c.profile;
      data.transition = null;
    } else if (c.action === "step") {
      if (!plan) throw new AccountError("Choose a business structure first.");
      const def = planDefinitions(plan).find((d) => d.key === c.key);
      if (!def)
        throw new AccountError("This task does not belong to the active process.", 404);
      const evidence = await tx.businessDocument.findMany({
        where: { id: { in: c.task.documentIds }, planId: plan.id, deletedAt: null },
        include: {
          versions: { where: { deletedAt: null }, orderBy: { number: "desc" }, take: 1 },
        },
      });
      if (
        evidence.length !== new Set(c.task.documentIds).size ||
        evidence.some((d) => d.versions[0]?.scanStatus !== "CLEAN")
      )
        throw new AccountError(
          "Evidence must belong to this plan and pass security scanning.",
        );
      checkTask(plan, def, c.task, evidence.length > 0);
      const previous = plan.tasks[c.key];
      plan.tasks[c.key] = { ...c.task, updatedAt: now };
      if (
        def.filing &&
        (["SUBMITTED", "AWAITING_APPROVAL", "COMPLETED"].includes(c.task.status) ||
          c.task.existing ||
          c.task.filedDate)
      )
        plan.filingsStartedAt ??= now;
      // Editing or retracting a completed prerequisite forces downstream owner review.
      if (
        previous?.status === "COMPLETED" &&
        JSON.stringify({ ...previous, updatedAt: "" }) !==
          JSON.stringify({ ...c.task, updatedAt: "" })
      )
        for (const d of planDefinitions(plan))
          if (
            d.dependencies?.includes(c.key) &&
            plan.tasks[d.key]?.status === "COMPLETED"
          ) {
            plan.tasks[d.key].status = "IN_PROGRESS";
            plan.tasks[d.key].nextAction =
              "Prerequisite evidence changed. Review this task again.";
          }
      plan.completedAt = null;
    } else if (c.action === "supplier") {
      if (!plan) throw new AccountError("Choose a structure first.");
      const name = c.supplier.name.toLowerCase();
      if (
        Object.entries(plan.tasks).some(
          ([k, t]) => k.startsWith("supplier:") && t.reference.toLowerCase() === name,
        )
      )
        throw new AccountError("This supplier already has a certificate record.", 409);
      if (Object.keys(plan.tasks).length >= 120)
        throw new AccountError(
          "Review the existing supplier records before adding more.",
        );
      plan.tasks[`supplier:${randomUUID()}`] = {
        ...structuredClone(emptyTask),
        reference: c.supplier.name,
        filedDate: c.supplier.deliveredDate,
        approvedDate: c.supplier.acceptedDate,
        notes: c.supplier.notes,
        updatedAt: now,
      };
      plan.completedAt = null;
      if (plan.tasks.suppliers?.status === "COMPLETED")
        plan.tasks.suppliers.status = "IN_PROGRESS";
    } else if (c.action === "finish") {
      if (!owner || !plan)
        throw new AccountError("The owner must review the summary.", 403);
      const p = progress(plan);
      if (!p.total || p.completed !== p.total || data.transition)
        throw new AccountError(
          "Resolve all applicable setup requirements and pending transition reviews first.",
        );
      plan.completedAt = now;
    } else if (c.action === "access") {
      if (!owner)
        throw new AccountError("Only the owner can grant business-document access.", 403);
      const target = await tx.user.findUnique({
        where: { email: c.email.toLowerCase() },
        include: { userRoles: { include: { role: true } } },
      });
      if (
        !target ||
        target.deletedAt ||
        target.mustChangeCredentials ||
        !target.userRoles.some((r) => r.role.code === "ADMIN")
      )
        throw new AccountError(
          "Choose an existing active ADMIN account with completed credentials.",
        );
      if (c.grant)
        await tx.businessAccess.upsert({
          where: { userId: target.id },
          create: { userId: target.id, grantedBy: userId },
          update: { grantedBy: userId },
        });
      else await tx.businessAccess.deleteMany({ where: { userId: target.id } });
    }
    await writeSetup(tx, userId, current.version, data, c.action);
  });
  return getBusinessSetup(userId);
}
