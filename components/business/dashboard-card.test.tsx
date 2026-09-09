import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  plan: null as null | { structure: string; completedAt?: string },
  percent: 0,
}));
vi.mock("@/lib/business/service", () => ({
  getBusinessSetup: async () => ({
    data: {},
    progress: { percent: state.percent, completed: 0, total: 1, deadlines: [] },
  }),
}));
vi.mock("@/lib/business/domain", () => ({
  activePlan: () => state.plan,
  structureNames: { LLC: "Single-member LLC" },
}));
import { BusinessSetupCard } from "./dashboard-card";
beforeEach(() => {
  state.plan = null;
  state.percent = 0;
});
it("keeps incomplete setup visible on the dashboard", async () => {
  expect(await BusinessSetupCard({ userId: "synthetic-owner" })).not.toBeNull();
});
it("hides only completed setup on the dashboard while keeping settings access", async () => {
  state.plan = { structure: "LLC", completedAt: "2026-09-10" };
  state.percent = 100;
  expect(await BusinessSetupCard({ userId: "synthetic-owner" })).toBeNull();
  expect(
    await BusinessSetupCard({ userId: "synthetic-owner", showCompleted: true }),
  ).not.toBeNull();
});
it("does not mistake 100 percent requirements for owner-confirmed completion", async () => {
  state.plan = { structure: "LLC" };
  state.percent = 100;
  expect(await BusinessSetupCard({ userId: "synthetic-owner" })).not.toBeNull();
});
