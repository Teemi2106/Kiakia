import { formatNaira, koboOf } from "@kiakia/domain";

export function money(kobo: number): string {
  return formatNaira(koboOf(kobo));
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export function formatPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** An order's delivery_address snapshot as one line, same shape the customer and vendor views read. */
export function formatAddress(address: unknown): string | null {
  const a = address as { line1?: string; landmark?: string; city?: string; state?: string } | null;
  if (!a?.line1) return null;
  return [a.line1, a.landmark ? `near ${a.landmark}` : null, a.city, a.state].filter(Boolean).join(", ");
}

/** "ready_for_pickup" -> "Ready for pickup". */
export function humanize(value: string): string {
  const spaced = value.replace(/[_.]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Naira input value for a kobo amount: 150000 -> "1500", 150050 -> "1500.50". */
export function nairaInputValue(kobo: number): string {
  const naira = kobo / 100;
  return Number.isInteger(naira) ? String(naira) : naira.toFixed(2);
}
