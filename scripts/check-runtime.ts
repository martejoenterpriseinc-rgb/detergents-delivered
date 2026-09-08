import { validateRuntimeConfig } from "../lib/runtime-config";

try {
  validateRuntimeConfig(process.env);
  console.log(
    "Detergents Delivered runtime configuration passed. No database writes performed.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Runtime configuration is invalid.",
  );
  process.exitCode = 1;
}
