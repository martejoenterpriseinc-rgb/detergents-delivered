import { requireApiRole } from "@/lib/api-auth";
import { putLocalObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireApiRole(["ADMIN", "INVENTORY", "SUPER_ADMIN"]);
  if (gate.error) return gate.error;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await putLocalObject({
    bytes,
    filename: file.name,
    contentType: file.type,
  });

  return Response.json(
    {
      storageKey: stored.storageKey,
      filename: stored.filename,
      byteSize: stored.byteSize,
      contentType: stored.contentType,
    },
    { status: 201 },
  );
}
