// Only a pristine database can take the initial migration path. Later releases
// use the normal read-only preflight, with separately reviewed migrations.
export function productionProvisioningAction(tables: string[], markerPresent: boolean) {
  if (markerPresent) return "preflight" as const;
  if (tables.length === 0) return "initialize" as const;
  throw new Error(
    "Production provisioning requires an empty database or its existing environment identity. Review incomplete provisioning instead of resetting it.",
  );
}
