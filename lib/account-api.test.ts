import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth }));
import { accountRequest, accountFailure, readAccountJson } from "./account-api";
beforeEach(() => {
  vi.stubEnv("AUTH_URL", "http://localhost:3000");
  auth.mockResolvedValue({ user: { id: "synthetic", mustChangeCredentials: false } });
});
describe("account HTTP boundary (mocked authentication)", () => {
  it("requires authentication and rejects cross-origin or missing-origin writes", async () => {
    auth.mockResolvedValueOnce(null);
    await expect(accountRequest()).rejects.toMatchObject({ status: 401 });
    for (const origin of [undefined, "https://other.example"]) {
      await expect(
        accountRequest(
          new Request("http://localhost:3000/api/account", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              ...(origin ? { origin } : {}),
            },
            body: "{}",
          }),
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(
      await accountRequest(
        new Request("http://localhost:3000/api/account", {
          method: "PATCH",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: "{}",
        }),
      ),
    ).toBe("synthetic");
  });
  it("bounds bodies and redacts save/database failures", async () => {
    await expect(
      readAccountJson(
        new Request("http://localhost/api", {
          method: "POST",
          body: '"' + "x".repeat(16001) + '"',
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    const response = accountFailure(new Error("private database/password details"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database");
  });
});
