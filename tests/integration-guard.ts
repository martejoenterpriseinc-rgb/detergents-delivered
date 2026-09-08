// Runs before any test imports Prisma or performs cleanup.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
if (
  process.env.APP_ENV !== "development" ||
  process.env.DD_ALLOW_DATABASE_TESTS !== "true" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  target.pathname !== "/detergents_delivered_ci"
) {
  throw new Error(
    "Database tests require explicit opt-in and an isolated loopback detergents_delivered_ci database. Hosted targets are forbidden.",
  );
}
