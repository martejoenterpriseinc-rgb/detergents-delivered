import {
  accountFailure,
  accountJson,
  accountRequest,
  readAccountJson,
} from "@/lib/account-api";
import {
  documentAction,
  listBusinessDocuments,
  uploadBusinessDocument,
} from "@/lib/business/documents";
import { MAX_DOCUMENT_BYTES } from "@/lib/business/document-security";
import { businessAccess } from "@/lib/business/service";
import { prisma } from "@/lib/prisma";
import { AccountError } from "@/lib/domain/account";
export const runtime = "nodejs";
export async function GET() {
  try {
    return accountJson(await listBusinessDocuments(await accountRequest()));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await documentAction(await accountRequest(request), await readAccountJson(request)),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function PUT(request: Request) {
  try {
    const userId = await accountRequest();
    await businessAccess(prisma, userId);
    const origin = new URL(
      process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? request.url,
    ).origin;
    if (request.headers.get("origin") !== origin)
      throw new AccountError("Request origin is not allowed.", 403);
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;"))
      throw new AccountError("A document upload form is required.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new AccountError("File required.");
    const parts: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_DOCUMENT_BYTES + 32768) {
        await reader.cancel();
        throw new AccountError("Use a document no larger than 5 MB.", 413);
      }
      parts.push(value);
    }
    const form = await new Response(Buffer.concat(parts), {
      headers: { "Content-Type": type },
    }).formData();
    const file = form.get("file"),
      metadata = form.get("metadata");
    if (
      !(file instanceof File) ||
      typeof metadata !== "string" ||
      metadata.length > 16000
    )
      throw new AccountError("File and document details required.");
    let input: unknown;
    try {
      input = JSON.parse(metadata);
    } catch {
      throw new AccountError("Invalid document details.");
    }
    return accountJson(
      await uploadBusinessDocument(
        userId,
        input,
        Buffer.from(await file.arrayBuffer()),
        file.type,
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
