import { describe, expect, it } from "vitest";
import {
  googleSignInConfigured,
  googleSignInCredentials,
  newAccountPasswordSchema,
  recoveryOrigin,
  registerAccountSchema,
  resetPasswordSchema,
} from "./customer-access";

describe("customer access boundaries", () => {
  it("requires complete Google configuration", () => {
    const fallback = {
      APP_ENV: "development",
      GOOGLE_CLIENT_ID: " ",
      GOOGLE_CLIENT_SECRET: "",
      AUTH_GOOGLE_ID: " client ",
      AUTH_GOOGLE_SECRET: " secret ",
    };
    expect(googleSignInConfigured(fallback)).toBe(true);
    expect(googleSignInCredentials(fallback)).toEqual({
      clientId: "client",
      clientSecret: "secret",
    });
    expect(
      googleSignInConfigured({ APP_ENV: "development", GOOGLE_CLIENT_ID: "client" }),
    ).toBe(false);
    expect(
      googleSignInConfigured({
        APP_ENV: "development",
        GOOGLE_CLIENT_ID: "client",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toBe(true);
    expect(
      googleSignInConfigured({
        APP_ENV: "development",
        AUTH_GOOGLE_ID: "client",
        AUTH_GOOGLE_SECRET: "secret",
      }),
    ).toBe(true);
  });
  it("rejects unsafe recovery origins independently of request headers", () => {
    for (const value of [
      "http://example.com",
      "https://evil:secret@example.com",
      "https://example.com/redirect",
      "https://example.com/?host=evil",
      "https://example.com/#evil",
    ])
      expect(() => recoveryOrigin({ APP_ENV: "production", AUTH_URL: value })).toThrow();
    expect(
      recoveryOrigin({ APP_ENV: "production", AUTH_URL: "https://shop.example.com" }),
    ).toBe("https://shop.example.com");
    expect(
      recoveryOrigin({ APP_ENV: "development", AUTH_URL: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
    expect(() =>
      recoveryOrigin({ APP_ENV: "development", AUTH_URL: "ftp://localhost" }),
    ).toThrow();
  });
  it("prevents bcrypt truncation and requires matching passwords", () => {
    expect(newAccountPasswordSchema.safeParse("😀".repeat(19)).success).toBe(false);
    expect(newAccountPasswordSchema.safeParse("a".repeat(73)).success).toBe(false);
    expect(newAccountPasswordSchema.safeParse("a".repeat(72)).success).toBe(true);
    expect(
      registerAccountSchema.safeParse({
        name: "Customer",
        email: "person@example.com",
        password: "Long-enough-password",
        confirmPassword: "different",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        token: "../invalid",
        password: "Long-enough-password",
        confirmPassword: "Long-enough-password",
      }).success,
    ).toBe(false);
  });
});
