// app/(customer)/orders/_components/timeAgo.ts

/**
 * Honest, computed-from-real-data relative time ("Ordered 12 min ago").
 * This app has a strict no-fabricated-data convention — there is no
 * ETA/route-time calculation anywhere yet (see tracking/_components/
 * statusCopy.ts), so rather than guess a delivery/prep window, every order
 * card shows how long ago it was actually placed, derived from the order's
 * own `created_at` column.
 */
export function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
