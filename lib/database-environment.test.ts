import { expect, it } from "vitest";
import { validateDatabaseEnvironment } from "./database-environment";
it("requires a matching production database identity, not a reused test marker", () => {
  expect(() => validateDatabaseEnvironment(undefined, "production", "dd_live")).toThrow();
  expect(() =>
    validateDatabaseEnvironment(
      {
        project: "detergents-delivered",
        environment: "staging",
        databaseName: "dd_live",
      },
      "production",
      "dd_live",
    ),
  ).toThrow();
  expect(() =>
    validateDatabaseEnvironment(
      { project: "other", environment: "production", databaseName: "dd_live" },
      "production",
      "dd_live",
    ),
  ).toThrow();
  expect(() =>
    validateDatabaseEnvironment(
      {
        project: "detergents-delivered",
        environment: "production",
        databaseName: "dd_live",
      },
      "production",
      "dd_live",
    ),
  ).not.toThrow();
  expect(() => validateDatabaseEnvironment(null, "staging", "dd_staging")).not.toThrow();
});
