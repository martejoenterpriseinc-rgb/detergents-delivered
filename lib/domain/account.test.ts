import { describe, expect, it } from "vitest";
import { csvCell, passwordSchema, profileSchema, ticketSchema } from "./account";
describe("account validation and export safety", () => {
  it("refuses extra identity and privilege fields", () => {
    expect(
      profileSchema.safeParse({
        firstName: "Test",
        lastName: "",
        phone: "",
        roles: ["SUPER_ADMIN"],
      }).success,
    ).toBe(false);
    expect(ticketSchema.safeParse({ customerId: "another" }).success).toBe(false);
  });
  it("rejects bcrypt truncation, mismatch, and unchanged passwords", () => {
    const newPassword = "😀".repeat(19);
    expect(
      passwordSchema.safeParse({
        currentPassword: "old",
        newPassword,
        confirmPassword: newPassword,
      }).success,
    ).toBe(false);
    expect(
      passwordSchema.safeParse({
        currentPassword: "old",
        newPassword: "Longer-Password",
        confirmPassword: "Different",
      }).success,
    ).toBe(false);
    expect(
      passwordSchema.safeParse({
        currentPassword: "Longer-Password",
        newPassword: "Longer-Password",
        confirmPassword: "Longer-Password",
      }).success,
    ).toBe(false);
  });
  it("neutralizes spreadsheet formulas and quotes CSV cells", () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell('line, "two"')).toBe('"line, ""two"""');
    expect(csvCell("\tformula")).toBe('"\'\tformula"');
  });
});
