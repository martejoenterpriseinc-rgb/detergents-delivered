# Routing

Local delivery is a first-class mode of this app. Optimization can wait; the data model cannot.

## Zones

`DeliveryZone` has a name, slug, optional GeoJSON / postal boundary (`boundaryJson`), and `capacityPerDay`.

Addresses may point at a zone after geocode (Phase 5). Checkout will reject (or flag) destinations outside active zones.

Capacity is a hard planning constraint: do not auto-schedule more stops than `capacityPerDay` without an explicit override (admin, logged).

## Auto-schedule (Phase 5 plan)

1. Paid orders with a deliverable address and no open stop.
2. Assign zone from address.
3. Place onto a `Route` for the next service date that has remaining capacity and compatible vehicle.
4. Create `RouteStop` with a provisional `sequence`.
5. Notify driver mode.

Manual drag-and-drop remains available. Auto-schedule never changes order money.

## Optimization plan

Phase 5 ships a simple heuristic:

- Cluster by zone
- Sequence by nearest-neighbor from the depot (depot stored in `Setting` later)
- Maps provider (`MAPS_API_KEY`) for distance/duration — not for inventory

Later:

- Time windows
- Vehicle capacity (`Vehicle.capacityStops` is the first proxy)
- Recalc after exceptions (`DeliveryAttemptResult`: failed / refused / rescheduled)

## Driver execution

Driver UI (`/driver`) will list today’s stops, capture `DeliveryAttempt`, and upload photos to private storage. Mileage is a `MileageTrip` on a `Vehicle`, optionally linked to a `Route`.

Phase 1 only ships the driver layout shell.
