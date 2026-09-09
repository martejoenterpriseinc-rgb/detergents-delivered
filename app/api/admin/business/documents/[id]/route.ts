import { accountRequest, accountFailure } from "@/lib/account-api";
import { downloadBusinessDocument } from "@/lib/business/documents";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await accountRequest();
    const { id } = await context.params;
    const url = new URL(request.url);
    const doc = await downloadBusinessDocument(
      userId,
      id,
      url.searchParams.get("token") ?? "",
    );
    return new Response(new Uint8Array(doc.bytes), {
      headers: {
        "Content-Type": doc.contentType,
        "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${doc.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (e) {
    return accountFailure(e);
  }
}
