import { beforeEach, describe, expect, it, vi } from "vitest";
const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst } } }));
import { loadSessionAccount } from "./session-account";
describe("persistent session permissions (mocked database)", () => {
  beforeEach(() => findFirst.mockReset());
  it("reloads roles and the forced credential-change flag", async () => {
    findFirst
      .mockResolvedValueOnce({
        email: "test@example.test",
        sessionVersion: 0,
        mustChangeCredentials: false,
        userRoles: [{ role: { code: "ADMIN" } }],
      })
      .mockResolvedValueOnce({
        email: "test@example.test",
        sessionVersion: 0,
        mustChangeCredentials: true,
        userRoles: [],
      });
    expect((await loadSessionAccount("synthetic"))?.roles).toEqual(["ADMIN"]);
    expect(await loadSessionAccount("synthetic")).toEqual({
      email: "test@example.test",
      sessionVersion: 0,
      mustChangeCredentials: true,
      roles: [],
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "synthetic", deletedAt: null } }),
    );
  });
  it("invalidates missing/deleted accounts and fails closed on database loss", async () => {
    findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    expect(await loadSessionAccount("removed")).toBeNull();
    await expect(loadSessionAccount("synthetic")).rejects.toThrow("offline");
  });
});
