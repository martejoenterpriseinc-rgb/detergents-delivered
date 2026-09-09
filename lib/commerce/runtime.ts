import { commerceConfiguration, requireCommerce } from "./config";
import { readManagedEnvironment } from "@/lib/integrations/vault";
export async function readCommerce(recovery = false) {
  return requireCommerce(recovery, await readManagedEnvironment(["stripe"]));
}
export async function runtimeCommerceConfiguration() {
  return commerceConfiguration(await readManagedEnvironment(["stripe"]));
}
