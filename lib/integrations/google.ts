import Google from "next-auth/providers/google";
import {
  googleSignInConfigured,
  googleSignInCredentials,
} from "@/lib/domain/customer-access";
import { readManagedEnvironment } from "./vault";
export async function runtimeGoogleProviders() {
  try {
    const env = await readManagedEnvironment(["google"]);
    return googleSignInConfigured(env) ? [Google(googleSignInCredentials(env))] : [];
  } catch {
    // Fail closed for OAuth while keeping password login available to repair setup.
    return [];
  }
}
export async function runtimeGoogleConfigured() {
  return (await runtimeGoogleProviders()).length > 0;
}
