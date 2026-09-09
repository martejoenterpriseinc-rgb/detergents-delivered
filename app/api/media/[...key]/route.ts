import { requireApiRole } from "@/lib/api-auth";
import { isLocalStorageKey, readLocalObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const gate = await requireApiRole([
    "ADMIN",
    "INVENTORY",
    "CPA",
    "SUPER_ADMIN",
    "DRIVER",
  ]);
  if (gate.error) return gate.error;
  if (process.env.APP_ENV !== "development")
    return Response.json({ error: "object not found" }, { status: 404 });
  const { key } = await params;
  const storageKey = key.join("/");
  if (!isLocalStorageKey(storageKey) && !storageKey.startsWith("local/")) {
    return Response.json(
      {
        error: "remote objects require a signed URL; unsigned public URLs are not issued",
      },
      { status: 409 },
    );
  }
  try {
    const bytes = await readLocalObject(
      storageKey.startsWith("local/") ? storageKey : `local/${storageKey}`,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return Response.json({ error: "object not found" }, { status: 404 });
  }
}
