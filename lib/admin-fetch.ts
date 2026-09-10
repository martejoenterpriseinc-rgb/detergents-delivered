export class AdminRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new AdminRequestError(
      data.error || `Request failed (${response.status})`,
      response.status,
    );
  }
  return data;
}

export function dollarsToCents(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const match = trimmed.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new Error("enter money as dollars and cents, e.g. 12.99");
  }
  const sign = match[1] === "-" ? -1 : 1;
  const dollars = Number(match[2]);
  const cents = Number((match[3] ?? "00").padEnd(2, "0"));
  return sign * (dollars * 100 + cents);
}
