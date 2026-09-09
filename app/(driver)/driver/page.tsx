import { requireRole } from "@/lib/authz";
import { dailyQueue } from "@/lib/services/operations";
import { businessDate, dateSchema } from "@/lib/domain/operations";
import { DeliveryQueue } from "@/components/admin/delivery-queue";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("DRIVER", "ADMIN", "SUPER_ADMIN");
  const q = await searchParams;
  const d = dateSchema.safeParse(q.date);
  const data = await dailyQueue(session.user.id, d.success ? d.data : businessDate());
  return (
    <DeliveryQueue
      key={`${data.date}-${q.status ?? "all"}`}
      initial={data}
      initialStatus={q.status === "completed" ? "completed" : "all"}
    />
  );
}
