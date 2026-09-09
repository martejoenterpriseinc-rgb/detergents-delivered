// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSavedForm } from "./shared";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
let root: Root;
let container: HTMLDivElement;
let form: ReturnType<typeof useSavedForm<string>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(save: (value: string) => Promise<void>) {
  function Harness() {
    form = useSavedForm<string>("original", save);
    return null;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => form.edit("pending edit"));
}
it("waits for a pending save before allowing a workflow action without another write", async () => {
  let release!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await mount(save);
  let first!: Promise<boolean>;
  let action!: Promise<boolean>;
  let settled = false;
  await act(async () => {
    first = form.flush();
    action = form.flush();
    void action.then(() => {
      settled = true;
    });
  });
  expect(save).toHaveBeenCalledExactlyOnceWith("pending edit");
  expect(settled).toBe(false);
  await act(async () => {
    release();
    await Promise.all([first, action]);
  });
  expect(await action).toBe(true);
  expect(save).toHaveBeenCalledTimes(1);
  expect(form.dirty).toBe(false);
});
it("blocks waiting actions after save failure and retains the edit for retry", async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  await mount(save);
  let first!: Promise<boolean>;
  let action!: Promise<boolean>;
  await act(async () => {
    first = form.flush();
    action = form.flush();
  });
  await act(async () => {
    reject(new Error("Save interrupted"));
    await Promise.all([first, action]);
  });
  expect(await action).toBe(false);
  expect(form.value).toBe("pending edit");
  expect(form.dirty).toBe(true);
  expect(form.error).toBe("Save interrupted");
  save.mockResolvedValueOnce(undefined);
  await act(async () => {
    expect(await form.flush()).toBe(true);
  });
  expect(form.dirty).toBe(false);
});
