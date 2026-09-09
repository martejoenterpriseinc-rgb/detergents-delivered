import { auth } from "@/auth";
import { accountJson, accountFailure } from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { completeWithPhoto } from "@/lib/services/delivery-operations";
export async function POST(r: Request) {
  try {
    const s = await auth();
    if (!s?.user?.id || s.user.mustChangeCredentials)
      throw new AccountError("Please sign in.", 401);
    if (r.headers.get("origin") !== new URL(process.env.AUTH_URL!).origin)
      throw new AccountError("Origin is not allowed.", 403);
    if (!r.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new AccountError("A photo upload is required.", 415);
    const reader = r.body?.getReader();
    if (!reader) throw new AccountError("Photo required.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4 * 1024 * 1024 + 20000) {
        await reader.cancel();
        throw new AccountError("Use a photo smaller than 4 MB.", 413);
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": r.headers.get("content-type")! },
    }).formData();
    const f = form.get("photo");
    if (!(f instanceof File)) throw new AccountError("Choose a photo.");
    return accountJson(
      await completeWithPhoto(
        s.user.id,
        String(form.get("routeId") ?? ""),
        String(form.get("stopId") ?? ""),
        String(form.get("requestKey") ?? ""),
        Buffer.from(await f.arrayBuffer()),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
