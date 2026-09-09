import { accountRequest, accountFailure } from "@/lib/account-api";
import { ownedProof } from "@/lib/services/delivery-operations";
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const bytes = await ownedProof(await accountRequest(), (await params).id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": bytes[0] === 255 ? "image/jpeg" : "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return accountFailure(e);
  }
}
