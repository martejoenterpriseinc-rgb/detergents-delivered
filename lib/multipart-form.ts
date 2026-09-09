import { AccountError } from "@/lib/domain/account";
export async function boundedImageForm(request: Request) {
  if (
    request.headers.get("origin") !== new URL(process.env.AUTH_URL ?? request.url).origin
  )
    throw new AccountError("Request origin is not allowed.", 403);
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError("Form is required.");
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 4 * 1024 * 1024 + 20000) {
      await reader.cancel();
      throw new AccountError("Choose an image under 4 MB.", 413);
    }
    parts.push(value);
  }
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
      body: Buffer.concat(parts),
    }).formData();
  } catch {
    throw new AccountError("Invalid form.");
  }
}
