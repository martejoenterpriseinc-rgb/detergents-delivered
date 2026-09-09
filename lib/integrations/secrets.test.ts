import { expect, it } from "vitest";
import { canSealIntegrations, openIntegration, sealIntegration } from "./secrets";
const env = {
  DD_BUSINESS_DOCUMENT_ACTIVE_KEY: "retained",
  DD_BUSINESS_DOCUMENT_KEYS: JSON.stringify({ retained: "ab".repeat(32) }),
};
it("encrypts with random nonces and authenticates the environment, provider and revision", () => {
  const value = { secret: "private-provider-value" };
  const context = "integrations:v1:sandbox:google:1";
  const one = sealIntegration(value, context, env);
  const two = sealIntegration(value, context, env);
  expect(one.ciphertext).not.toBe(two.ciphertext);
  expect(Buffer.from(one.ciphertext, "base64").includes(Buffer.from(value.secret))).toBe(
    false,
  );
  expect(openIntegration(one, context, env)).toEqual(value);
  for (const other of [
    "integrations:v1:live:google:1",
    "integrations:v1:sandbox:stripe:1",
    "integrations:v1:sandbox:google:2",
  ])
    expect(() => openIntegration(one, other, env)).toThrow(/could not be unlocked/);
  const altered = Buffer.from(one.ciphertext, "base64");
  altered[30] ^= 1;
  expect(() =>
    openIntegration({ ...one, ciphertext: altered.toString("base64") }, context, env),
  ).toThrow(/could not be unlocked/);
});
it("retains old key support during rotation and fails closed when the retained key is missing", () => {
  const context = "integrations:v1:sandbox:email:1";
  const sealed = sealIntegration({ key: "old" }, context, env);
  const rotated = {
    ...env,
    DD_INTEGRATION_ACTIVE_KEY: "new",
    DD_INTEGRATION_KEYS: JSON.stringify({ new: "cd".repeat(32) }),
  };
  expect(openIntegration(sealed, context, rotated)).toEqual({ key: "old" });
  expect(sealIntegration({}, context, rotated).keyId).toBe("api:new");
  expect(() =>
    openIntegration(sealed, context, {
      DD_INTEGRATION_KEYS: rotated.DD_INTEGRATION_KEYS,
    }),
  ).toThrow();
  expect(canSealIntegrations({ AUTH_SECRET: "must-not-be-used-as-a-vault-key" })).toBe(
    false,
  );
  expect(canSealIntegrations({ ...env, DD_INTEGRATION_ACTIVE_KEY: "missing" })).toBe(
    false,
  );
});
