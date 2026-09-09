import sharp from "sharp";
import { afterEach, describe, it, expect, vi } from "vitest";
const writes = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  putLocalObject: writes.put,
  readLocalObject: vi.fn(),
}));
import { proofStorageReady, saveProof } from "./proof-storage";
afterEach(() => {
  vi.unstubAllEnvs();
  writes.put.mockReset();
});
describe("private photo adapter guards (storage mocked)", () => {
  it("never enables ephemeral photo storage on staging", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("DD_LOCAL_PROOF_STORAGE", "true");
    vi.stubEnv("DD_BUSINESS_DOCUMENT_KEYS", "");
    vi.stubEnv("DD_BUSINESS_DOCUMENT_ACTIVE_KEY", "");
    expect(proofStorageReady()).toBe(false);
  });
  it("rejects forged image headers before writing", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("DD_LOCAL_PROOF_STORAGE", "true");
    const bytes = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(30)]);
    await expect(saveProof(bytes)).rejects.toMatchObject({ status: 415 });
    expect(writes.put).not.toHaveBeenCalled();
  });
  it("decodes real pixels and removes metadata before storage", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("DD_LOCAL_PROOF_STORAGE", "true");
    writes.put.mockResolvedValue({ storageKey: "local/test-photo.jpg" });
    const bytes = await sharp({
      create: { width: 50, height: 30, channels: 3, background: "#21715a" },
    })
      .withExif({ IFD0: { Artist: "Synthetic" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    await saveProof(bytes);
    const stored = writes.put.mock.calls[0][0];
    expect(stored.contentType).toBe("image/jpeg");
    const metadata = await sharp(stored.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.width).toBe(50);
  });
  it("propagates write failure instead of returning a success", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("DD_LOCAL_PROOF_STORAGE", "true");
    writes.put.mockRejectedValue(new Error("Synthetic disk write failure"));
    const bytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#21715a" },
    })
      .png()
      .toBuffer();
    await expect(saveProof(bytes)).rejects.toThrow("Synthetic disk write failure");
  });
});
