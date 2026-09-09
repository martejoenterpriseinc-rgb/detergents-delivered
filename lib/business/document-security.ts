import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import sharp from "sharp";
import { AccountError } from "@/lib/domain/account";
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const exec = promisify(execFile);
function keys() {
  try {
    const values: Record<string, string> = JSON.parse(
      process.env.DD_BUSINESS_DOCUMENT_KEYS ?? "{}",
    );
    const active = process.env.DD_BUSINESS_DOCUMENT_ACTIVE_KEY ?? "";
    const valid = Object.entries(values).every(
      ([id, value]) =>
        /^[a-zA-Z0-9_-]{1,40}$/.test(id) &&
        typeof value === "string" &&
        /^[0-9a-f]{64}$/i.test(value),
    );
    if (!valid || !values[active]) throw new Error();
    return { active, values };
  } catch {
    throw new AccountError(
      "Private document encryption is not configured. Uploads are unavailable.",
      503,
    );
  }
}
export function documentReadiness() {
  let encryption = false;
  try {
    keys();
    encryption = true;
  } catch {
    /* fail closed */
  }
  return {
    encryption,
    scannerConfigured: Boolean(process.env.DD_DOCUMENT_SCANNER_PATH),
    maxBytes: MAX_DOCUMENT_BYTES,
  };
}
export function encryptDocument(bytes: Buffer, id: string) {
  const { active, values } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(values[active], "hex"), iv);
  cipher.setAAD(Buffer.from(`DD-business-document:${id}`));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    keyId: active,
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
  };
}
export function decryptDocument(bytes: Uint8Array, id: string, keyId: string) {
  const { values } = keys();
  if (!values[keyId])
    throw new AccountError("The document's retained encryption key is unavailable.", 503);
  try {
    const data = Buffer.from(bytes);
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(values[keyId], "hex"),
      data.subarray(0, 12),
    );
    cipher.setAuthTag(data.subarray(12, 28));
    cipher.setAAD(Buffer.from(`DD-business-document:${id}`));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
  } catch {
    throw new AccountError("Document integrity could not be verified.", 503);
  }
}
export async function validateDocument(bytes: Buffer, contentType: string) {
  if (bytes.length < 16 || bytes.length > MAX_DOCUMENT_BYTES)
    throw new AccountError("Use a PDF, JPG or PNG no larger than 5 MB.", 413);
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (pdf && contentType === "application/pdf") {
    // Header/trailer validation is not antivirus. PDFs remain quarantined until ClamAV clears them.
    if (!bytes.subarray(-1024).includes(Buffer.from("%%EOF")))
      throw new AccountError("This PDF is incomplete.", 415);
    if (
      /\/JavaScript|\/JS\b|\/Launch\b|\/EmbeddedFile|\/RichMedia|\/Encrypt\b/i.test(
        bytes.toString("latin1"),
      )
    )
      throw new AccountError(
        "Use a PDF without scripts, embedded files or password protection.",
        415,
      );
    return { bytes, contentType };
  }
  if (!(jpg && contentType === "image/jpeg") && !(png && contentType === "image/png"))
    throw new AccountError("The file contents must match PDF, JPG or PNG.", 415);
  try {
    const sanitized = await sharp(bytes, {
      limitInputPixels: 24000000,
      failOn: "warning",
    })
      .rotate()
      .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    if (sanitized.length > MAX_DOCUMENT_BYTES) throw new Error();
    return { bytes: sanitized, contentType: "image/png" };
  } catch {
    throw new AccountError(
      "This image could not be safely decoded. Use a valid JPG or PNG.",
      415,
    );
  }
}
export async function scanDocument(
  bytes: Buffer,
): Promise<"CLEAN" | "REJECTED" | "QUARANTINED"> {
  const path = process.env.DD_DOCUMENT_SCANNER_PATH;
  if (!path || !isAbsolute(path)) return "QUARANTINED";
  const directory = await mkdtemp(join(tmpdir(), "dd-business-scan-"));
  try {
    const file = join(directory, "upload.bin");
    await writeFile(file, bytes, { mode: 0o600 });
    // Only an operator-configured executable. No user filenames or shell interpolation.
    const scanned = await exec(
      path,
      [
        "--no-summary",
        "--stdout",
        "--max-filesize=6M",
        "--max-scansize=24M",
        "--alert-exceeds-max=yes",
        "--alert-encrypted=yes",
        file,
      ],
      {
        timeout: 20000,
        maxBuffer: 8192,
        env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" },
      },
    );
    return String(scanned.stdout).trim() === `${file}: OK` ? "CLEAN" : "QUARANTINED";
  } catch (error) {
    return (error as { code?: number }).code === 1 ? "REJECTED" : "QUARANTINED";
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function signingKey() {
  const { active, values } = keys();
  return createHmac("sha256", Buffer.from(values[active], "hex"))
    .update("DD-business-download-v1")
    .digest();
}
export function downloadToken(
  userId: string,
  sessionVersion: number,
  versionId: string,
  now = Date.now(),
) {
  const body = Buffer.from(
    JSON.stringify({ userId, sessionVersion, versionId, expires: now + 90000 }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", signingKey()).update(body).digest("base64url")}`;
}
export function checkDownloadToken(
  token: string,
  userId: string,
  sessionVersion: number,
  versionId: string,
  now = Date.now(),
) {
  try {
    if (token.length > 1500) throw new Error();
    const [body, signature, ...extra] = token.split(".");
    const expected = createHmac("sha256", signingKey()).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (
      extra.length ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new Error();
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (
      data.userId !== userId ||
      data.sessionVersion !== sessionVersion ||
      data.versionId !== versionId ||
      data.expires <= now ||
      data.expires > now + 90000
    )
      throw new Error();
  } catch {
    throw new AccountError("Download access expired. Open the document again.", 403);
  }
}
export function contentHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
