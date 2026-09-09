import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ArrowUpRight, ArrowRight, UserPlus, Play, CalendarDays } from "lucide-react";
import { stopLabels, type StopRow } from "@/lib/domain/operations";
export function Kpi({
  label,
  value,
  detail,
  href,
  icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  detail: string;
  href: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <Link href={href as Route} className={`ops-kpi ${accent ? "ops-kpi-accent" : ""}`}>
      <div className="ops-kpi-top">
        <span>{label}</span>
        <span className="ops-kpi-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="ops-kpi-bottom">
        <span>{detail}</span>
        <ArrowUpRight size={17} />
      </div>
    </Link>
  );
}
export function OperationsHeading({
  eyebrow,
  title,
  subtitle,
  date,
  invite = true,
  start = true,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  date: string;
  invite?: boolean;
  start?: boolean;
}) {
  return (
    <div className="ops-heading">
      <div>
        <div className="ops-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="ops-heading-actions">
        {invite && (
          <Link className="ops-button secondary" href="/admin/customers/invite">
            <UserPlus size={16} />
            Add customer
          </Link>
        )}
        {start && (
          <Link className="ops-button" href={`/admin/deliveries?date=${date}`}>
            <Play size={15} fill="currentColor" />
            Start deliveries
          </Link>
        )}
      </div>
    </div>
  );
}
export function StatusPill({ status }: { status: StopRow["status"] }) {
  return (
    <span className={`ops-status status-${status.toLowerCase()}`}>
      <i />
      {stopLabels[status]}
    </span>
  );
}
export function DatePicker({ date, path }: { date: string; path: string }) {
  return (
    <form action={path} className="ops-date">
      <CalendarDays size={16} />
      <label className="sr-only" htmlFor="service-date">
        Service date
      </label>
      <input id="service-date" type="date" name="date" defaultValue={date} required />
      <button type="submit">View</button>
    </form>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="ops-empty">{children}</div>;
}
export function SectionTitle({
  title,
  subtitle,
  href,
  label = "View all",
}: {
  title: string;
  subtitle?: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="ops-section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {href && (
        <Link href={href as Route}>
          {label}
          <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}
