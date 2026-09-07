# Routing

Local delivery is a first-class mode of this app. Optimization can wait; the data model cannot.

## Service area (current business rules)

Coverage is **select towns** in **admin-enabled Chicagoland-area counties**. The selectable county catalog lives in `lib/domain/delivery-schedule.ts` (`CHICAGOLAND_COUNTIES`): Cook, DuPage, Kane, Lake, McHenry, Will, Kendall, Grundy, and DeKalb.

- Admins toggle counties under **Settings**. Seed/staging defaults enable **McHenry, Kane, and Cook only**.
- Enabling a county does **not** mean every ZIP in that county. Select-town ZIP lists live in `lib/delivery-area.ts`.
- Storefront copy lists the **currently enabled** counties. Do not hardcode only three counties in UI copy.
- Downtown Chicago / unlisted ZIPs stay rejected unless they are on that county’s select list.

**No same-day delivery.** Delivery is **weekly only** on the route days and time windows stored in `Setting` key `delivery.settings`. Not same-day, not any day.

## Weekly windows

`lib/domain/delivery-schedule.ts` is the source of scheduling rules:

- Enable/disable each weekday
- Window start/end (`HH:MM`, America/Chicago)
- Optional cutoff hours before the window
- `nextDeliverySlot(settings, now)` skips today and any day whose cutoff has passed

Seed defaults (editable in admin): Tuesday and Thursday, 9:00 AM–3:00 PM, 12-hour cutoff.

Storefront, FAQ, checkout, and the ZIP checker must never claim same-day service. They should say “weekly delivery on scheduled route days” and show the next window from settings when one exists.

## Zones

`DeliveryZone` has a name, slug, optional GeoJSON / postal boundary (`boundaryJson`), and `capacityPerDay`.

Addresses may point at a zone after geocode (Phase 4+). Checkout will reject (or flag) destinations outside active zones.

Capacity is a hard planning constraint: do not auto-schedule more stops than `capacityPerDay` without an explicit override (admin, logged).

## Auto-schedule (Phase 4+ plan)

1. Paid orders with a deliverable address and no open stop.
2. Assign zone from address.
3. Place onto a `Route` for the next configured service date that has remaining capacity and compatible vehicle.
4. Create `RouteStop` with a provisional `sequence`.
5. Notify driver mode.

Manual drag-and-drop remains available. Auto-schedule never changes order money.

## Optimization plan

Later phases can ship a simple heuristic:

- Cluster by zone
- Sequence by nearest-neighbor from the depot (depot stored in `Setting` later)
- Maps provider (`MAPS_API_KEY`) for distance/duration — not for inventory

Later:

- Vehicle capacity (`Vehicle.capacityStops` is the first proxy)
- Recalc after exceptions (`DeliveryAttemptResult`: failed / refused / rescheduled)

## Driver execution

Driver UI (`/driver`) will list today’s stops, capture `DeliveryAttempt`, and upload photos to private storage. Mileage is a `MileageTrip` on a `Vehicle`, optionally linked to a `Route`.

Phase 1 only ships the driver layout shell.
