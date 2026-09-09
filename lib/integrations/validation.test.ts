import { expect, it } from "vitest";
import { updateApiSchema, validateApiValue } from "./validation";
it.each(["STRIPE_SECRET_KEY", "STRIPE_RESTRICTED_KEY", "STRIPE_PUBLISHABLE_KEY"])(
  "rejects the wrong mode for %s",
  (field) => {
    const prefix =
      field === "STRIPE_SECRET_KEY"
        ? "sk"
        : field === "STRIPE_RESTRICTED_KEY"
          ? "rk"
          : "pk";
    expect(validateApiValue(field, `${prefix}_test_synthetic`, "sandbox", null)).toBe(
      `${prefix}_test_synthetic`,
    );
    expect(() =>
      validateApiValue(field, `${prefix}_live_synthetic`, "sandbox", null),
    ).toThrow(/test key/);
    expect(() =>
      validateApiValue(field, `${prefix}_test_synthetic`, "live", null),
    ).toThrow(/live key/);
  },
);
it.each([
  "http://production.example.com",
  "https://sandbox.example.com",
  "https://user:password@production.example.com",
  "https://production.example.com/path",
  "https://production.example.com/?environment=live",
  "javascript:alert(1)",
])("rejects an unsafe switch destination %s", (value) => {
  expect(() =>
    validateApiValue("APP_URL", value, "sandbox", "https://sandbox.example.com"),
  ).toThrow();
});
it("normalizes approved recipients and rejects control characters and unknown write fields", () => {
  expect(
    validateApiValue(
      "EMAIL_ALLOWED_RECIPIENTS",
      "TEST@example.com, test@example.com",
      "sandbox",
      null,
    ),
  ).toBe("test@example.com");
  expect(() =>
    validateApiValue("EMAIL_ALLOWED_RECIPIENTS", "invalid", "sandbox", null),
  ).toThrow();
  expect(() =>
    validateApiValue("GOOGLE_CLIENT_SECRET", "secret\nsecond", "sandbox", null),
  ).toThrow();
  expect(() =>
    updateApiSchema.parse({
      environment: "sandbox",
      provider: "google",
      field: "GOOGLE_CLIENT_SECRET",
      value: "secret",
      version: 0,
      APP_ENV: "production",
    }),
  ).toThrow();
});
