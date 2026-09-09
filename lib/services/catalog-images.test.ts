import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@/lib/storage", () => ({ putLocalObject: storage.put }));
import { catalogUploadReady, saveCatalogImage } from "./catalog-images";
afterEach(() => {
  vi.unstubAllEnvs();
  storage.put.mockReset();
});
it("does not offer ephemeral catalog uploads on hosted environments", async () => {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("DD_LOCAL_CATALOG_STORAGE", "true");
  expect(catalogUploadReady()).toBe(false);
  await expect(saveCatalogImage(Buffer.from("invalid"))).rejects.toMatchObject({
    status: 503,
  });
  expect(storage.put).not.toHaveBeenCalled();
});
it("rejects fake images and isolates decoded catalog media from private delivery photos", async () => {
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("DD_LOCAL_CATALOG_STORAGE", "true");
  await expect(
    saveCatalogImage(Buffer.from('<svg onload="bad"/>')),
  ).rejects.toMatchObject({ status: 415 });
  expect(storage.put).not.toHaveBeenCalled();
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "#fff" },
  })
    .withExif({ IFD0: { Artist: "Synthetic" } })
    .png()
    .toBuffer();
  storage.put.mockResolvedValue({ storageKey: "local/catalog/synthetic.jpg" });
  await saveCatalogImage(image);
  const input = storage.put.mock.calls[0][0];
  expect(input.namespace).toBe("catalog");
  expect((await sharp(input.bytes).metadata()).exif).toBeUndefined();
  storage.put.mockRejectedValue(new Error("Synthetic write failure"));
  await expect(saveCatalogImage(image)).rejects.toThrow("Synthetic write failure");
});
