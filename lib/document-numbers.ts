export function documentNumber(prefix: string, at = new Date()): string {
  const day = at.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${day}-${suffix}`;
}
