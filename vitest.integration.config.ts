import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// The integration script runs global API configuration tests first on the clean
// migrated CI database. Commerce tests deliberately retain payment-history
// fixtures, including pending attempts that correctly prevent credential edits.
// Both invocations use this guard and together execute every integration test.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["./tests/integration-guard.ts"],
    fileParallelism: false,
    include: ["**/*.integration.test.ts"],
    exclude: ["node_modules", ".next"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
