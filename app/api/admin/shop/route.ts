import { accountRequest, accountJson, accountFailure } from "@/lib/account-api";
import { AccountError } from "@/lib/domain/account";
import { boundedImageForm } from "@/lib/multipart-form";
import { addShopEntry } from "@/lib/services/shop-entry";
export async function POST(request: Request) {
  try {
    const userId = await accountRequest();
    const form = await boundedImageForm(request);
    let input: unknown;
    try {
      input = JSON.parse(String(form.get("details")));
    } catch {
      throw new AccountError("Invalid product details.");
    }
    const file = form.get("image");
    return accountJson(
      await addShopEntry(
        userId,
        input,
        file instanceof File && file.size
          ? Buffer.from(await file.arrayBuffer())
          : undefined,
      ),
      201,
    );
  } catch (error) {
    return accountFailure(error);
  }
}
