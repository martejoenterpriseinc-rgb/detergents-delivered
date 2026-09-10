import { readSiteImage } from "@/lib/services/site-media";
import { accountFailure } from "@/lib/account-api";
import { publishedMediaExists } from "@/lib/services/site-content";
import { auth } from "@/auth";
import { canManageWebsite } from "@/lib/domain/site-content";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return new Response(null, { status: 404 });
  if (!(await publishedMediaExists(id))) {
    const session = await auth();
    if (
      !session?.user?.id ||
      session.user.mustChangeCredentials ||
      !canManageWebsite(session.user.roles)
    )
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      });
  }
  try {
    return new Response(new Uint8Array(await readSiteImage(id)), {
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return accountFailure(error);
  }
}
