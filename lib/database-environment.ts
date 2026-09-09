export const ENVIRONMENT_KEY = "system.databaseEnvironment";
export function validateDatabaseEnvironment(
  marker: unknown,
  expected: string,
  databaseName: string,
) {
  if (!marker && expected !== "production") return; // existing isolated staging history
  const value = marker as {
    project?: string;
    environment?: string;
    databaseName?: string;
  } | null;
  if (
    value?.project !== "detergents-delivered" ||
    value?.environment !== expected ||
    value?.databaseName !== databaseName
  )
    throw new Error(
      "Database environment identity is missing or does not match this service. Production requires a separately initialized empty database.",
    );
}
