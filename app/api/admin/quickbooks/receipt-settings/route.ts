import {
  accountRequest,
  accountJson,
  accountFailure,
  readAccountJson,
} from "@/lib/account-api";
import {
  receiptSettingsData,
  saveReceiptSettings,
} from "@/lib/services/quickbooks-receipt-settings";
export async function GET(request: Request) {
  try {
    return accountJson(await receiptSettingsData(await accountRequest(request)));
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: Request) {
  try {
    return accountJson(
      await saveReceiptSettings(
        await accountRequest(request),
        await readAccountJson(request),
      ),
    );
  } catch (e) {
    return accountFailure(e);
  }
}
