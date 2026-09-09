import { auth } from "@/auth";
import { ZodError } from "zod";
import { AccountError } from "@/lib/domain/account";

export async function accountRequest(request?: Request) {
  const session = await auth();
  if (!session?.user?.id) throw new AccountError("Please sign in.", 401);
  if (session.user.mustChangeCredentials)
    throw new AccountError("Complete your required credential change first.", 403);
  if (request && request.method !== "GET") {
    const origin = new URL(
      process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? request.url,
    ).origin;
    if (request.headers.get("origin") !== origin)
      throw new AccountError("Request origin is not allowed.", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new AccountError("JSON is required.", 415);
  }
  return session.user.id;
}
export async function readAccountJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError("Request body is required.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16000) {
      await reader.cancel();
      throw new AccountError("Request is too large.", 413);
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new AccountError("Invalid JSON.");
  }
}
export function accountJson(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function accountFailure(error: unknown) {
  if (error instanceof AccountError)
    return accountJson({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return accountJson({ error: error.issues[0]?.message ?? "Invalid fields." }, 400);
  return accountJson(
    { error: "The operation could not be confirmed. Refresh and try again." },
    503,
  );
}
