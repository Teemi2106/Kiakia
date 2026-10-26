import { z } from "zod";
import { formatSeconds } from "./dispatch-settings-info";

/**
 * "How dispatch is doing" from admin_dispatch_metrics() (0105): the last 7
 * days, in plain words. Rates arrive as 0-1 (null with no samples); times in
 * seconds. Pure, so the panel and the tests say the same thing.
 */

const rate = z.number().nullish();
const seconds = z.number().nullish();
const count = z.number().nullish();

const metricsSchema = z.object({
  since: z.string().nullish(),
  offers: z
    .object({ made: count, accepted: count, declined: count, expired: count, accept_rate: rate, decline_rate: rate, expiry_rate: rate })
    .nullish(),
  assignment: z.object({ orders_assigned: count, median_s: seconds, p90_s: seconds }).nullish(),
  reliability: z.object({ needs_attention_now: count }).nullish(),
  readiness: z
    .object({
      samples: count,
      rider_waited_share: rate,
      food_waited_share: rate,
      median_rider_wait_s: seconds,
      median_food_wait_s: seconds,
    })
    .nullish(),
  areas: z
    .array(
      z.object({
        service_area_id: z.string(),
        name: z.string().nullish(),
        speed_kmh: z.number().nullish(),
        speed_source: z.string().nullish(),
        speed_samples: count,
        secure_buffer_s: z.number().nullish(),
        buffer_source: z.string().nullish(),
        buffer_samples: count,
      }),
    )
    .nullish(),
});

export interface AreaLearning {
  readonly id: string;
  readonly name: string;
  readonly speedText: string;
  readonly bufferText: string;
}

export interface DispatchMetrics {
  readonly offersMade: number;
  readonly acceptedText: string;
  readonly declinedText: string;
  readonly noAnswerText: string;
  readonly ordersAssigned: number;
  readonly assignTimeText: string;
  readonly pickupSamples: number;
  readonly riderWaitText: string;
  readonly foodWaitText: string;
  readonly needsAttentionNow: number;
  readonly areas: readonly AreaLearning[];
}

const NO_DATA = "No data yet";

/** 0.4286 -> "43%"; null -> "No data yet". */
export function formatRate(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? NO_DATA : `${Math.round(value * 100)}%`;
}

function withCount(rateValue: number | null | undefined, n: number | null | undefined): string {
  const text = formatRate(rateValue);
  return text === NO_DATA || n == null ? text : `${text} (${n})`;
}

/** "42 s", "1.6 minutes" for a metric; "No data yet" when missing. */
export function formatDuration(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  return value < 60 ? `${Math.round(value)} s` : formatSeconds(Math.round(value));
}

function share(shareValue: number | null | undefined, typical: number | null | undefined): string {
  if (shareValue == null) return NO_DATA;
  return typical == null || shareValue === 0 ? formatRate(shareValue) : `${formatRate(shareValue)} of pickups, typically ${formatDuration(typical)}`;
}

function learned(source: string | null | undefined, samples: number | null | undefined, unit: string): string {
  return source === "history" && samples != null ? `learned from ${samples} ${unit}` : "using default";
}

export function readDispatchMetrics(data: unknown): DispatchMetrics {
  const parsed = metricsSchema.safeParse(data);
  if (!parsed.success) throw new Error("admin_dispatch_metrics returned an unexpected shape");
  const { offers, assignment, readiness, reliability } = parsed.data;
  return {
    offersMade: offers?.made ?? 0,
    acceptedText: withCount(offers?.accept_rate, offers?.accepted),
    declinedText: withCount(offers?.decline_rate, offers?.declined),
    noAnswerText: withCount(offers?.expiry_rate, offers?.expired),
    ordersAssigned: assignment?.orders_assigned ?? 0,
    assignTimeText: formatDuration(assignment?.median_s),
    pickupSamples: readiness?.samples ?? 0,
    riderWaitText: share(readiness?.rider_waited_share, readiness?.median_rider_wait_s),
    foodWaitText: share(readiness?.food_waited_share, readiness?.median_food_wait_s),
    needsAttentionNow: reliability?.needs_attention_now ?? 0,
    areas: (parsed.data.areas ?? []).map((area) => ({
      id: area.service_area_id,
      name: area.name ?? "Delivery area",
      speedText: `${area.speed_kmh == null ? "—" : `${Number(area.speed_kmh.toFixed(1))} km/h`}, ${learned(area.speed_source, area.speed_samples, "deliveries")}`,
      bufferText: `${formatDuration(area.secure_buffer_s)}, ${learned(area.buffer_source, area.buffer_samples, "offers")}`,
    })),
  };
}
