import Link from "next/link";
import {
  Truck,
  Check,
  DollarSign,
  TrendingUp,
  UserPlus,
  Users,
  Gift,
  Headphones,
  ArrowRight,
  MapPin,
} from "lucide-react";
import { money, type QueueData } from "@/lib/domain/operations";
import { Kpi, OperationsHeading, SectionTitle, StatusPill, Empty } from "./operations-ui";
import { AreaMap } from "./area-map";
export function OperationsOverview({
  date,
  queue,
  customers,
  revenue,
  support,
}: {
  date: string;
  queue: QueueData;
  customers: { newCustomers: number; referred: number; total: number };
  revenue: { revenueCents: number }[];
  support: { OPEN: number; IN_PROGRESS: number; WAITING_CUSTOMER: number };
}) {
  const remaining = queue.stops.filter((s) => s.status !== "COMPLETED");
  return (
    <div className="ops-page">
      <OperationsHeading
        eyebrow={
          new Intl.DateTimeFormat("en-US", {
            timeZone: "UTC",
            weekday: "long",
            month: "long",
            day: "numeric",
          })
            .format(new Date(date))
            .toUpperCase() + " · AMERICA/CHICAGO"
        }
        title="Your day, delivered."
        subtitle="A clear view of your deliveries, customers and business."
        date={date}
      />
      <div className="ops-kpi-grid">
        <Kpi
          accent
          label="Today's deliveries"
          value={queue.total}
          detail={`${remaining.length} remaining · Open delivery queue`}
          href={`/admin/deliveries?date=${date}`}
          icon={<Truck size={21} />}
        />
        <Kpi
          label="Completed deliveries"
          value={queue.completed}
          detail="View today's completed stops"
          href={`/admin/deliveries?date=${date}&status=completed`}
          icon={<Check size={21} />}
        />
        <Kpi
          label="Daily delivery revenue"
          value={money(queue.revenueCents)}
          detail="Orders on today's delivery list"
          href={`/admin/deliveries?date=${date}&report=revenue`}
          icon={<DollarSign size={21} />}
        />
        <Kpi
          label="Total revenue MTD"
          value={money(revenue.reduce((n, o) => n + o.revenueCents, 0))}
          detail="Month to date · View paid orders"
          href={`/admin/reports/revenue?date=${date}`}
          icon={<TrendingUp size={21} />}
        />
        <Kpi
          label="New customers"
          value={customers.newCustomers}
          detail="Signed up this month"
          href={`/admin/customers?group=new&date=${date}`}
          icon={<UserPlus size={21} />}
        />
        <Kpi
          label="Referred customers"
          value={customers.referred}
          detail="View customers and their referrers"
          href="/admin/customers?group=referred"
          icon={<Gift size={21} />}
        />
        <Kpi
          label="Total customers"
          value={customers.total}
          detail="Open customer directory"
          href="/admin/customers"
          icon={<Users size={21} />}
        />
        <Kpi
          label="Support tickets"
          value={support.OPEN + support.IN_PROGRESS + support.WAITING_CUSTOMER}
          detail={`${support.OPEN} open · View support queue`}
          href="/admin/support?status=ACTIVE"
          icon={<Headphones size={21} />}
        />
      </div>
      <div className="ops-overview-grid">
        <section className="ops-panel">
          <SectionTitle
            title="Today's route at a glance"
            subtitle={`${queue.total} stops · Saved delivery sequence`}
            href={`/admin/deliveries?date=${date}`}
            label="Open dashboard"
          />
          <AreaMap
            numbered
            label="Today's route map"
            pins={queue.stops.map((s, i) => ({
              id: s.id,
              name: s.customer,
              lat: s.lat,
              lng: s.lng,
              number: i + 1,
              color: s.status === "COMPLETED" ? "#8b9c99" : "#087b74",
            }))}
          />
          <div className="ops-map-footer">
            <MapPin size={15} />
            <span>Numbered pins match the delivery queue.</span>
            <span className="ops-live">
              <i />
              Saved route data
            </span>
          </div>
        </section>
        <section className="ops-panel ops-up-next">
          <SectionTitle title="Up next" subtitle="Your next delivery stops" />
          {remaining.slice(0, 3).map((s, i) => (
            <div className="ops-next-stop" key={s.id}>
              <span className="ops-stop-number">{queue.stops.indexOf(s) + 1}</span>
              <div>
                <h3>{s.customer}</h3>
                <p>{s.city}</p>
                <StatusPill status={s.status} />
                {i === 0 && (
                  <Link href={`/admin/deliveries?date=${date}`} className="ops-next-link">
                    Open this delivery
                    <ArrowRight size={15} />
                  </Link>
                )}
              </div>
            </div>
          ))}
          {!remaining.length && (
            <Empty>
              {queue.total
                ? "All deliveries completed. You're all set."
                : "No deliveries scheduled for today."}
            </Empty>
          )}
          <Link href={`/admin/deliveries?date=${date}`} className="ops-button secondary">
            View full delivery queue
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      <p className="ops-footnote">
        Revenue is paid order totals less recorded refunds, including tax. MTD uses
        purchase date; daily delivery revenue uses the route’s service date. All dates use
        America/Chicago.
      </p>
    </div>
  );
}
