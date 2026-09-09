// Visual-only rendering of the actual components. No server, authentication,
// database, external email or payment actions are used by this preview.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { OperationsOverview } from "../components/admin/operations-overview";
import { AdminShell } from "../components/admin/admin-shell";
import { CustomerDirectory } from "../components/admin/customer-directory";
import { DeliveryQueue } from "../components/admin/delivery-queue";
import type { CustomerRow, QueueData } from "../lib/domain/operations";
const date = "2026-09-09";
const names = [
  "Sarah Mitchell",
  "James Wilson",
  "Emily Thompson",
  "Michael Davis",
  "Olivia Bennett",
  "Daniel Brooks",
];
const customers: CustomerRow[] = names.map((name, i) => ({
  id: `synthetic-${i}`,
  name,
  firstName: name.split(" ")[0],
  lastName: name.split(" ")[1],
  email: `${name.split(" ")[0].toLowerCase()}@example.test`,
  phone: "+15555550100",
  createdAt: `2026-09-0${i + 1}T14:00:00Z`,
  updatedAt: "2026-09-09T12:00:00Z",
  city: ["Algonquin", "Lake in the Hills", "Crystal Lake", "Cary"][i % 4],
  address: `${100 + i} Synthetic Lane, IL 60102`,
  lat: [42.165, 42.181, 42.218, 42.205, 42.145, 42.19][i],
  lng: [-88.294, -88.33, -88.321, -88.245, -88.279, -88.289][i],
  totalOrders: 5 + i,
  revenueCents: 18900 + i * 3780,
  referrer: i % 2 ? "Sarah Mitchell" : null,
}));
const queue: QueueData = {
  canManage: true,
  date,
  checkedAt: "2026-09-09T12:00:00Z",
  routeIds: ["synthetic-route"],
  total: 6,
  completed: 0,
  revenueCents: 30780,
  plannedMiles: "28.4",
  actualMiles: null,
  proofReady: false,
  stops: customers.map((c, i) => ({
    id: c.id,
    routeId: "synthetic-route",
    routeNumber: "NORTH-01",
    sequence: i + 1,
    customerId: c.id,
    customer: c.name,
    address: c.address,
    city: c.city,
    lat: c.lat,
    lng: c.lng,
    orderId: `synthetic-order-${i}`,
    orderNumber: `DD-${1001 + i}`,
    items: "1 × Fresh Linen · 5 gallon",
    revenueCents: 3780 + i * 540,
    status: "SCHEDULED",
    eta: `${date}T${15 + Math.floor(i / 2)}:${i % 2 ? "30" : "00"}:00Z`,
    completedAt: null,
    photoId: null,
    assignedTo: "synthetic-driver",
  })),
};
const directory = {
  filter: {
    q: "",
    group: "all" as const,
    sort: "newest" as const,
    city: "",
    date,
    page: 1,
  },
  total: 6,
  referred: 3,
  newCustomers: 6,
  cities: ["Algonquin", "Cary", "Crystal Lake", "Lake in the Hills"],
  matching: 6,
  pins: customers.map((c) => ({
    id: c.id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    city: c.city,
    referrer: c.referrer,
  })),
  rows: customers,
};
const out = process.argv[2];
if (!out) throw Error("Provide a dedicated output directory");
async function main() {
  await mkdir(out, { recursive: true });
  const cssFile = (await readdir(".next/static/chunks")).find((x) => x.endsWith(".css"));
  if (!cssFile) throw Error("Run build first");
  const css = await readFile(join(".next/static/chunks", cssFile), "utf8");
  // A no-op router context is required for rendering interactive components to a
  // static document; it never authenticates a user or executes application actions.
  const router = {
    bfcacheId: "synthetic-preview",
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace() {},
    prefetch: async () => {},
  };
  const screens = [
    [
      "admin-overview",
      <OperationsOverview
        key="overview"
        date={date}
        queue={queue}
        customers={{ total: 6, referred: 3, newCustomers: 6 }}
        revenue={[{ revenueCents: 189000 }]}
        support={{ OPEN: 2, IN_PROGRESS: 1, WAITING_CUSTOMER: 0 }}
      />,
    ],
    ["customer-directory", <CustomerDirectory key="customers" data={directory} />],
    ["daily-delivery-dashboard", <DeliveryQueue key="queue" initial={queue} />],
  ] as const;
  for (const [name, view] of screens) {
    const body = renderToStaticMarkup(
      <PathnameContext.Provider
        value={
          name === "admin-overview"
            ? "/admin"
            : name === "customer-directory"
              ? "/admin/customers"
              : "/admin/deliveries"
        }
      >
        <AppRouterContext.Provider value={router}>
          <AdminShell email="owner@example.test" roles={["ADMIN"]}>
            <div className="ops-test-banner">
              VISUAL PREVIEW · Synthetic data · Not an end-to-end browser test
            </div>
            {view}
          </AdminShell>
        </AppRouterContext.Provider>
      </PathnameContext.Provider>,
    );
    await writeFile(
      join(out, `${name}.html`),
      `<!doctype html><html><head><meta charset="utf-8"><title>Detergents Delivered — ${name}</title><style>${css}</style></head><body>${body.replaceAll('src="/brand/logo.png"', `src="${join(process.cwd(), "public/brand/logo.png")}"`)}</body></html>`,
    );
  }
  console.log("Rendered three screens from actual UI components using synthetic data.");
}
void main();
