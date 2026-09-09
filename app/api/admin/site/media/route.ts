import { requireApiRole } from "@/lib/api-auth";
import { WEBSITE_MANAGER_ROLES } from "@/lib/domain/site-content";
import { boundedImageForm } from "@/lib/multipart-form";
import { accountFailure, accountJson } from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { saveSiteImage } from "@/lib/services/site-media";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const gate = await requireApiRole([...WEBSITE_MANAGER_ROLES]);
  if (gate.error) return gate.error;
  try {
    const file = (await boundedImageForm(request)).get("file");
    if (!(file instanceof File)) throw new AccountError("Choose a photo.");
    return accountJson(
      await saveSiteImage(Buffer.from(await file.arrayBuffer()), gate.session.user.id),
      201,
    );
  } catch (error) {
    return accountFailure(error);
  }
}
