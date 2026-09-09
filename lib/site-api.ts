import { AccountError } from "@/lib/domain/account";
export async function readSiteJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("origin") !== new URL(process.env.AUTH_URL ?? request.url).origin
  )
    throw new AccountError("Request origin is not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AccountError("JSON is required.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError("Request body is required.");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 600_000) {
      await reader.cancel();
      throw new AccountError("Page is too large.", 413);
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new AccountError("Invalid JSON.");
  }
}
