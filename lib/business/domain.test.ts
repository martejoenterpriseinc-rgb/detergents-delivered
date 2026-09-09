import { expect, it, vi, afterEach } from "vitest";
import sharp from "sharp";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  addDays,
  annualDue,
  emptyProfile,
  emptyTask,
  requireProfile,
  type BusinessPlan,
} from "./domain";
import {
  definitions,
  planDefinitions,
  progress,
  taskDeadlines,
  sources,
} from "./definitions";
import { checkTask } from "./service";
import {
  checkDownloadToken,
  decryptDocument,
  downloadToken,
  encryptDocument,
  scanDocument,
  validateDocument,
} from "./document-security";
const profile = {
  ...emptyProfile,
  tradeName: "Synthetic Detergents",
  legalOwner: "Synthetic Owner",
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
const plan: BusinessPlan = {
  id: "test",
  profile,
  structure: "SOLE",
  tasks: {},
  createdAt: "2026-09-09",
  filingsStartedAt: null,
  completedAt: null,
  transitionFrom: null,
  reviewNotes: "",
};
afterEach(() => vi.unstubAllEnvs());
it("has explicit structure selection and requires single-owner confirmed jurisdiction", () => {
  expect(() => requireProfile(profile)).not.toThrow();
  expect(() => requireProfile({ ...profile, owners: 2 })).toThrow(/Multiple owners/);
  expect(() => requireProfile({ ...profile, stateConfirmed: false })).toThrow(
    /Confirm Illinois/,
  );
  expect(() => requireProfile({ ...profile, municipality: "" })).toThrow(/Complete/);
});
it("routes county fees and LLC services without mixing branches", () => {
  const mc = definitions(profile, "SOLE");
  const kane = definitions({ ...profile, county: "Kane County" }, "SOLE");
  expect(mc[0].feeCents).toBe(500);
  expect(kane[0].feeCents).toBe(1000);
  expect(kane[0].links[0].url).toBe(sources.kane.url);
  expect(mc.some((d) => d.key === "formation")).toBe(false);
  const llc = definitions({ ...profile, assumedName: "YES" }, "LLC");
  expect(llc.find((d) => d.key === "formation")?.feeCents).toBe(15000);
  expect(llc.some((d) => d.key === "dba")).toBe(false);
  expect(llc.find((d) => d.key === "llc-name")?.links).toContain(sources.llc);
});
it("keeps unknown location applicability unresolved and routes LITH online", () => {
  const unknown = definitions(
    { ...profile, county: "Other", municipality: "Unknown" },
    "SOLE",
  );
  expect(unknown[0].unknown).toBe(true);
  expect(unknown.find((d) => d.key === "local")?.method).toBe("Needs Verification");
  expect(definitions(profile, "SOLE").find((d) => d.key === "local")?.method).toBe(
    "Online",
  );
  expect(
    definitions({ ...profile, municipality: "Algonquin" }, "SOLE").find(
      (d) => d.key === "local",
    )?.notice,
  ).toContain("not verified");
});
it("calculates publication and anniversary deadlines across months and leap years", () => {
  expect(addDays("2026-12-20", 15)).toBe("2027-01-04");
  expect(annualDue("2026-03-15", "2028-01-01")).toBe("2028-02-29");
  const d = definitions(profile, "SOLE")[0];
  expect(taskDeadlines(plan, d, { ...emptyTask, filedDate: "2026-09-01" })).toEqual([
    { label: "First publication", date: "2026-09-16" },
    { label: "Clerk receives publication proof", date: "2026-10-21" },
  ]);
});
it("does not count submitted filings or unknown applicability as complete", () => {
  const p = {
    ...plan,
    profile: { ...profile, municipality: "Unknown" },
    tasks: {
      dba: { ...emptyTask, status: "SUBMITTED" as const },
      local: { ...emptyTask, status: "COMPLETED" as const },
    },
  };
  expect(progress(p).completed).toBe(0);
  expect(progress(p).pending).toBe(1);
});
it("requires approval evidence and clerk receipt with weekly publication", () => {
  const def = definitions(profile, "SOLE")[0];
  const task = {
    ...emptyTask,
    status: "COMPLETED" as const,
    filedDate: "2026-08-01",
    approvedDate: "2026-08-24",
    publicationDates: ["2026-08-03", "2026-08-10", "2026-08-17"],
    proofReceived: true,
    proofReceivedDate: "2026-08-20",
    attestation: "Owner confirmed every filing and publication requirement.",
  };
  expect(() => checkTask(plan, def, task, false, "2026-09-09")).not.toThrow();
  expect(() =>
    checkTask(plan, def, { ...task, proofReceived: false }, false, "2026-09-09"),
  ).toThrow(/publications/);
  expect(() =>
    checkTask(plan, def, { ...task, approvedDate: "" }, false, "2026-09-09"),
  ).toThrow(/approval/);
});
it("creates conditional reviews and leaves future recurring filings out of initial actions", () => {
  const ds = definitions(
    { ...profile, employees: "YES", products: "REBOTTLE", transfers: "YES" },
    "LLC",
  );
  expect(ds.map((d) => d.key)).toEqual(
    expect.arrayContaining([
      "product-review",
      "transfer-review",
      "employer",
      "new-hires",
      "workers",
      "annual",
      "boi",
    ]),
  );
  expect(ds.find((d) => d.key === "annual")?.recurring).toBe(true);
  expect(ds.find((d) => d.key === "boi")?.filing).toBeUndefined();
  expect(
    planDefinitions({
      ...plan,
      tasks: { "supplier:test": { ...emptyTask, reference: "Vendor" } },
    }).some((d) => d.title.includes("Vendor")),
  ).toBe(true);
});
it("authenticates encrypted document contents and binds them to the version", () => {
  vi.stubEnv("DD_BUSINESS_DOCUMENT_KEYS", JSON.stringify({ test: "34".repeat(32) }));
  vi.stubEnv("DD_BUSINESS_DOCUMENT_ACTIVE_KEY", "test");
  const bytes = Buffer.from("private synthetic evidence");
  const encrypted = encryptDocument(bytes, "one");
  expect(encrypted.ciphertext.includes(bytes)).toBe(false);
  expect(decryptDocument(encrypted.ciphertext, "one", "test")).toEqual(bytes);
  expect(() => decryptDocument(encrypted.ciphertext, "other", "test")).toThrow(
    /integrity/,
  );
  encrypted.ciphertext[30] ^= 1;
  expect(() => decryptDocument(encrypted.ciphertext, "one", "test")).toThrow(/integrity/);
});
it("binds expiring download access to user, session and document", () => {
  vi.stubEnv("DD_BUSINESS_DOCUMENT_KEYS", JSON.stringify({ test: "34".repeat(32) }));
  vi.stubEnv("DD_BUSINESS_DOCUMENT_ACTIVE_KEY", "test");
  const token = downloadToken("owner", 1, "version", 10000);
  expect(() => checkDownloadToken(token, "owner", 1, "version", 20000)).not.toThrow();
  for (const args of [
    ["other", 1, "version", 20000],
    ["owner", 2, "version", 20000],
    ["owner", 1, "other", 20000],
    ["owner", 1, "version", 100001],
  ] as const)
    expect(() => checkDownloadToken(token, args[0], args[1], args[2], args[3])).toThrow(/expired/);
});
it("rejects forged, oversized, active PDF and invalid image files; strips image metadata", async () => {
  await expect(
    validateDocument(Buffer.from("<html>fake document</html>"), "application/pdf"),
  ).rejects.toThrow(/contents/);
  await expect(
    validateDocument(Buffer.alloc(6 * 1024 * 1024), "image/png"),
  ).rejects.toThrow(/5 MB/);
  await expect(
    validateDocument(
      Buffer.from("%PDF-1.7\n/JavaScript (alert)\n%%EOF"),
      "application/pdf",
    ),
  ).rejects.toThrow(/scripts/);
  const png = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "white" },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const clean = await validateDocument(png, "image/png");
  expect((await sharp(clean.bytes).metadata()).exif).toBeUndefined();
});
it("keeps uploads quarantined when the scanner is absent or fails", async () => {
  vi.stubEnv("DD_DOCUMENT_SCANNER_PATH", "");
  expect(await scanDocument(Buffer.from("test"))).toBe("QUARANTINED");
  vi.stubEnv("DD_DOCUMENT_SCANNER_PATH", "/does-not-exist/clamscan");
  expect(await scanDocument(Buffer.from("test"))).toBe("QUARANTINED");
});
