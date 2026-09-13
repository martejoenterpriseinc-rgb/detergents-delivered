import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runtimeCommerceConfiguration } from "@/lib/commerce/runtime";
import { integrationEnvironment } from "@/lib/integration-environment";
import {
  paymentFilters,
  paymentCategories,
  unavailableMetrics,
  type PaymentCategory,
} from "@/lib/domain/payment-overview";
import { financeAccess } from "./finance";
import { AccountError } from "@/lib/domain/account";
export type PaymentRecord = {
  id: string;
  order_id: string | null;
  number: string | null;
  customer_id: string;
  customer: string;
  email: string;
  method: string;
  status: string;
  reference: string | null;
  date: string;
  cents: number | null;
  categories: string[];
  tip_id: string | null;
};
type Metric = { count: number | null; cents: number | null };
type Summary = {
  metrics: Record<string, Metric>;
  previous: Record<string, Metric>;
  rows: PaymentRecord[];
  count: number;
  trend: { date: string; gross: number; refunds: number; net: number }[];
  top: PaymentRecord[];
  failures: PaymentRecord[];
};
/** Read-only operational ledger. Provider reconciliation and CPA source certification remain separate. */
export async function readPaymentOverview(
  actor: string,
  raw: unknown,
  category: PaymentCategory = "gross",
  exporting = false,
) {
  const filter = paymentFilters(raw),
    { range } = filter;
  const mode = integrationEnvironment();
  if (!mode) throw new AccountError("Reporting environment is unavailable.", 503);
  const config = await runtimeCommerceConfiguration();
  const account = config.accountId || "";
  const sort = {
    newest: Prisma.sql`date DESC, id DESC`,
    oldest: Prisma.sql`date ASC, id ASC`,
    amountDesc: Prisma.sql`cents DESC NULLS LAST, id DESC`,
    amountAsc: Prisma.sql`cents ASC NULLS LAST, id ASC`,
  }[filter.sort];
  const summary = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '20000ms'`;
      await financeAccess(tx, actor, true);
      const result = await tx.$queryRaw<{ result: Summary }[]>(Prisma.sql`
WITH scope AS MATERIALIZED (
 SELECT c.*, o.number, o."placedAt", o."totalCents" AS total, u.email,
 concat_ws(' ',cu."firstName",cu."lastName") AS customer
 FROM "CheckoutAttempt" c JOIN "Customer" cu ON cu.id=c."customerId" JOIN "User" u ON u.id=cu."userId"
 LEFT JOIN "Order" o ON o.id=c."orderId"
 WHERE c.livemode=${mode === "live"} AND (${account}='' OR c."stripeAccountId"=${account})
), sales AS MATERIALIZED (
 SELECT p.id,c."orderId" AS order_id,c.number,c."customerId" AS customer_id,c.customer,c.email,c."paymentMethod" AS method,
 p.status::text AS status,coalesce(s.reference,p."externalId") AS reference,
 coalesce(s."receivedAt",c."placedAt") AS date,p."amountCents"::bigint AS cents,
 ARRAY['gross','succeeded','net','customers',CASE WHEN c."paymentMethod"='CASH' THEN 'cash' WHEN c."paymentMethod"='ZELLE' THEN 'zelle' ELSE 'card' END]::text[] AS categories, NULL::text AS tip_id
 FROM scope c JOIN "Payment" p ON p."orderId"=c."orderId"
 LEFT JOIN "ManualCheckoutSettlement" s ON s."checkoutId"=c.id AND s.state='SETTLED' AND s.livemode=c.livemode AND s."accountId"=c."stripeAccountId" AND s."amountCents"=p."amountCents" AND s.method=c."paymentMethod"
 WHERE c.state='PAID' AND p.currency='USD' AND p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED') AND p."amountCents"=c.total
 AND c."placedAt" IS NOT NULL AND ((c."paymentMethod"='STRIPE' AND p.provider='STRIPE') OR (c."paymentMethod" IN ('CASH','ZELLE') AND p.provider='MANUAL' AND s.id IS NOT NULL))
 AND EXISTS (SELECT 1 FROM "PaymentEvent" e WHERE e."paymentId"=p.id AND e."verifiedAt" IS NOT NULL AND e."externalId"='checkout:'||c.id||':paid' AND e.type IN ('checkout.session.completed','checkout.session.reconciled','manual.payment.settled'))
), tip_source AS MATERIALIZED (
 SELECT t.*,o.number,o."customerId",concat_ws(' ',cu."firstName",cu."lastName") AS customer,u.email
 FROM "DeliveryTip" t JOIN "Order" o ON o.id=t."orderId" JOIN "Customer" cu ON cu.id=o."customerId" JOIN "User" u ON u.id=cu."userId"
 WHERE t.livemode=${mode === "live"} AND (${account}='' OR t."stripeAccountId"=${account}) AND t.currency='USD' AND t.state='PAID' AND t."paidAt" IS NOT NULL
 AND t."totalCents"=t."amountCents"+t."taxCents" AND t.source->>'driverUserId' IS NOT NULL
 AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."entityId"=t.id AND a."entityType"='DeliveryTip' AND a.action='delivery.tip.reconciled'
 AND a."afterJson" @> jsonb_build_object('state','PAID','source','stripe-api','accountId',t."stripeAccountId",'livemode',t.livemode,'paymentIntentId',t."paymentIntentId",'stripeSessionId',t."stripeSessionId",'taxCents',t."taxCents",'totalCents',t."totalCents"))
), ledger AS MATERIALIZED (
 SELECT * FROM sales
 UNION ALL
 SELECT p.id,c."orderId",c.number,c."customerId",c.customer,c.email,c."paymentMethod",'PAYMENT EVIDENCE REVIEW',p."externalId",p."createdAt",NULL::bigint,ARRAY['review'],NULL::text
 FROM "Payment" p JOIN scope c ON c."orderId"=p."orderId" WHERE p.currency='USD' AND p.status IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED')
 AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id=p.id)
 UNION ALL
 SELECT a.id,c."orderId",c.number,c."customerId",c.customer,c.email,c."paymentMethod",a.kind,
 coalesce(a."providerRefundId",(SELECT e."evidenceJson"->>'reference' FROM "RefundRequestEvent" e WHERE e."refundRequestId"=r.id AND e.type='manual-refund.returned' LIMIT 1)),
 a."createdAt",a."cashCents"::bigint,ARRAY['refunded','net','customers'],NULL::text
 FROM "RefundAdjustment" a JOIN "RefundRequest" r ON r.id=a."requestId" JOIN scope c ON c."orderId"=r."orderId"
 WHERE a.currency='USD' AND a.kind IN ('SETTLEMENT','COMPENSATION') AND r.livemode=c.livemode AND r."providerAccountId"=c."stripeAccountId"
 UNION ALL
 SELECT p.id,c."orderId",c.number,c."customerId",c.customer,c.email,c."paymentMethod",p.status::text,p."externalId",p."createdAt",p."amountCents"::bigint,
 ARRAY[CASE p.status WHEN 'AUTHORIZED' THEN 'uncaptured' WHEN 'FAILED' THEN 'failed' ELSE 'processing' END],NULL::text
 FROM "Payment" p JOIN scope c ON c."orderId"=p."orderId" WHERE p.currency='USD' AND p.status IN ('PENDING','AUTHORIZED','FAILED')
 UNION ALL
 SELECT c.id,c."orderId",c.number,c."customerId",c.customer,c.email,c."paymentMethod",c.state,c."stripeSessionId",c."createdAt",NULL::bigint,
 ARRAY[CASE WHEN c.state='REVIEW' THEN 'review' WHEN c."paymentMethod" IN ('CASH','ZELLE') THEN 'manualPending' ELSE 'processing' END],NULL::text
 FROM scope c WHERE (c.state IN ('REVIEW','PROCESSING') OR (c.state='PREPARING' AND c."paymentMethod" IN ('CASH','ZELLE'))) AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId"=c."orderId" AND p.status IN ('PENDING','AUTHORIZED','FAILED'))
 UNION ALL
 SELECT s.id,c."orderId",c.number,c."customerId",c.customer,c.email,s.method,s.state,s.reference,s."receivedAt",s."amountCents"::bigint,ARRAY['review'],NULL::text
 FROM "ManualCheckoutSettlement" s JOIN scope c ON c.id=s."checkoutId" WHERE s.state<>'SETTLED' AND c.state<>'REVIEW'
 UNION ALL
 SELECT r.id,c."orderId",c.number,c."customerId",c.customer,c.email,c."paymentMethod",r.status::text,r."providerRefundId",coalesce(r."reconciledAt",r."submittedAt",r."createdAt"),r."amountCents"::bigint,
 ARRAY[CASE WHEN r.status='SUCCEEDED' THEN 'refundCompleted' WHEN r.status IN ('FAILED','CANCELED') THEN 'refundFailed' ELSE 'refundPending' END],NULL::text
 FROM "RefundRequest" r JOIN scope c ON c."orderId"=r."orderId" WHERE r.currency='USD' AND r.livemode=c.livemode AND r."providerAccountId"=c."stripeAccountId" AND NOT (r.status='CANCELED' AND r."submittedAt" IS NULL)
 UNION ALL
 SELECT t.id,t."orderId",t.number,t."customerId",t.customer,t.email,'STRIPE',t.state,t."paymentIntentId",t."paidAt",t."amountCents"::bigint,ARRAY['tips','tipAwaiting'],t.id FROM tip_source t
 UNION ALL
 SELECT p.id,t."orderId",t.number,t."customerId",t.customer,t.email,'STRIPE',p.kind,p.reference,((p."paidOn"::date::timestamp AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC'),
 (CASE WHEN p.kind='REVERSAL' THEN -p."amountCents" ELSE p."amountCents" END)::bigint,ARRAY['tipPaid'],t.id
 FROM "TipPayoutEntry" p JOIN tip_source t ON t.id=p."tipId"
 UNION ALL
 SELECT r.id,t."orderId",t.number,t."customerId",t.customer,t.email,'STRIPE',r.state,r."providerRefundId",(SELECT min(a."createdAt") FROM "AuditLog" a WHERE a."entityType"='TipRefundRequest' AND a."entityId"=r.id AND a.action='delivery.tip.refund.reconciled' AND a."afterJson" @> jsonb_build_object('state','SUCCEEDED','source','stripe-api','providerRefundId',r."providerRefundId",'amountCents',r."amountCents")),r."amountCents"::bigint,ARRAY['tipRefunded'],t.id
 FROM "TipRefundRequest" r JOIN tip_source t ON t.id=r."tipId" WHERE r.state='SUCCEEDED' AND r.livemode=t.livemode AND r."accountId"=t."stripeAccountId"
), first_paid AS (
 SELECT customer_id,min(date) AS first_date FROM sales GROUP BY customer_id
), enriched AS MATERIALIZED (
 SELECT l.*, CASE WHEN 'gross'=ANY(l.categories) AND l.date=f.first_date THEN true ELSE false END AS new_customer
 FROM ledger l LEFT JOIN first_paid f ON f.customer_id=l.customer_id
), searched AS MATERIALIZED (
 SELECT * FROM enriched WHERE (${filter.method}='ALL' OR method=${filter.method}) AND (${filter.customer ?? ""}='' OR customer_id=${filter.customer ?? ""})
 AND (${filter.q}='' OR strpos(lower(concat_ws(' ',number,customer,email,reference,id)),lower(${filter.q}))>0)
), current_rows AS MATERIALIZED (
 SELECT * FROM searched WHERE date >= ${range.start} AND date < ${range.end}
), period_rows AS (
 SELECT *, 'current' AS period FROM current_rows UNION ALL SELECT *, 'previous' FROM searched WHERE date>=${range.previousStart} AND date<${range.start}
), metric_rows AS (
 SELECT period, k, count(*) AS count, sum(CASE WHEN k IN ('net','customers') AND 'refunded'=ANY(categories) THEN -cents ELSE cents END) AS cents
 FROM period_rows CROSS JOIN LATERAL unnest(categories) k WHERE k<>'customers' GROUP BY period,k
 UNION ALL SELECT period,'customers',count(DISTINCT customer_id),sum(CASE WHEN 'refunded'=ANY(categories) THEN -cents ELSE cents END) FROM period_rows WHERE 'customers'=ANY(categories) GROUP BY period
 UNION ALL SELECT period,'newCustomers',count(DISTINCT customer_id),NULL::bigint FROM period_rows WHERE new_customer GROUP BY period
), customer_totals AS (
 SELECT customer_id, min(customer) AS customer,min(email) AS email,max(date) AS date,
 sum(CASE WHEN 'refunded'=ANY(categories) THEN -cents ELSE cents END) AS cents
 FROM current_rows WHERE 'customers'=ANY(categories) GROUP BY customer_id
), details AS (
 SELECT id,order_id,number,customer_id,customer,email,method,status,reference,date,
 CASE WHEN ${category}='net' AND 'refunded'=ANY(categories) THEN -cents WHEN ${category}='tipAwaiting' THEN NULL ELSE cents END AS cents,categories,tip_id
 FROM current_rows WHERE ${category}=ANY(categories) AND ${category} NOT IN ('customers','newCustomers')
 UNION ALL
 SELECT customer_id,NULL::text,NULL::text,customer_id,min(customer),min(email),${filter.method},'FIRST PAYMENT',NULL::text,min(date),NULL::bigint,ARRAY['newCustomers'],NULL::text
 FROM current_rows WHERE ${category}='newCustomers' AND new_customer GROUP BY customer_id
 UNION ALL
 SELECT customer_id,NULL::text,NULL::text,customer_id,customer,email,${filter.method},'NET SPEND',NULL::text,date,cents,ARRAY['customers'],NULL::text FROM customer_totals WHERE ${category}='customers'
), observed_trend AS (
 SELECT to_char(date_trunc(${filter.interval}, date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago'),'YYYY-MM-DD') AS date,
 coalesce(sum(cents) FILTER (WHERE 'gross'=ANY(categories)),0) AS gross,coalesce(sum(cents) FILTER (WHERE 'refunded'=ANY(categories)),0) AS refunds
 FROM current_rows WHERE 'net'=ANY(categories) GROUP BY 1
), trend AS (
 SELECT to_char(d,'YYYY-MM-DD') AS date,coalesce(t.gross,0) AS gross,coalesce(t.refunds,0) AS refunds
 FROM generate_series(date_trunc(${filter.interval},${range.from}::date::timestamp),${range.to}::date::timestamp,('1 '||${filter.interval})::interval) d
 LEFT JOIN observed_trend t ON t.date=to_char(d,'YYYY-MM-DD')
)
SELECT jsonb_build_object(
 'metrics',coalesce((SELECT jsonb_object_agg(k,jsonb_build_object('count',count,'cents',cents)) FROM metric_rows WHERE period='current'),'{}'::jsonb),
 'previous',coalesce((SELECT jsonb_object_agg(k,jsonb_build_object('count',count,'cents',cents)) FROM metric_rows WHERE period='previous'),'{}'::jsonb),
 'count',(SELECT count(*) FROM details),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(d)) FROM (SELECT * FROM details ORDER BY ${sort} LIMIT ${exporting ? 10001 : 50} OFFSET ${exporting ? 0 : (filter.page - 1) * 50}) d),'[]'::jsonb),
 'trend',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY date) FROM (SELECT *,gross-refunds AS net FROM trend) t),'[]'::jsonb),
 'top',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM customer_totals ORDER BY cents DESC,customer_id LIMIT 5) t),'[]'::jsonb),
 'failures',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT * FROM current_rows WHERE 'failed'=ANY(categories) ORDER BY date DESC,id DESC LIMIT 5) t),'[]'::jsonb)
) AS result`);
      return result[0].result;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
  );
  if (exporting && summary.count > 10000)
    throw new AccountError(
      "Narrow the filters to export at most 10,000 records. Dashboard totals still cover every matching record.",
      422,
    );
  // JSON numeric aggregates must stay exact in JavaScript.
  const check = (v: unknown): void => {
    if (typeof v === "number" && !Number.isSafeInteger(v))
      throw new AccountError("Reporting total exceeds the supported exact range.", 422);
    if (v && typeof v === "object") Object.values(v).forEach(check);
  };
  check(summary);
  for (const key of Object.keys(paymentCategories) as PaymentCategory[]) {
    for (const metrics of [summary.metrics, summary.previous]) {
      metrics[key] ??= { count: 0, cents: key === "newCustomers" ? null : 0 };
      if (unavailableMetrics[key])
        metrics[key] = {
          count: key === "tipAwaiting" ? metrics[key].count : null,
          cents: null,
        };
    }
  }
  // Customer cards count people, rather than payment/refund rows.
  if (category === "customers") summary.metrics.customers.count = summary.count;
  return {
    ...summary,
    filter,
    range,
    live: mode === "live",
    enabled: config.enabled,
    checkedAt: new Date().toISOString(),
    accountScope: account
      ? "Configured provider account"
      : "All recorded accounts in this environment",
    stripeUrl: `https://dashboard.stripe.com/${/^acct_[A-Za-z0-9]+$/.test(account) ? account + "/" : ""}${mode === "live" ? "" : "test/"}payments`,
  };
}
