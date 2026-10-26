import { describe, expect, it } from "vitest";
import { formatDuration, formatRate, readDispatchMetrics } from "./dispatch-metrics";

const full = {
  since: "2026-10-14T16:00:00Z",
  offers: { made: 40, accepted: 18, declined: 12, expired: 8, cancelled: 1, superseded: 1, accept_rate: 0.45, decline_rate: 0.3, expiry_rate: 0.2 },
  assignment: { orders_assigned: 17, median_s: 95.4, p90_s: 300, median_offers_per_assigned_order: 2 },
  reliability: { needs_attention_now: 2, needs_attention_events: 3 },
  readiness: { samples: 12, rider_waited_share: 0.75, food_waited_share: 0.25, median_rider_wait_s: 180, p90_rider_wait_s: 400, median_food_wait_s: 90, p90_food_wait_s: 200 },
  areas: [
    { service_area_id: "a1", name: "Ibadan", speed_kmh: 21.46, speed_source: "history", speed_samples: 44, secure_buffer_s: 210, buffer_source: "history", buffer_samples: 61, refreshed_at: "2026-10-21T16:00:00Z" },
    { service_area_id: "a2", name: "Lagos", speed_kmh: 18, speed_source: "default", speed_samples: 3, secure_buffer_s: 150, buffer_source: "default", buffer_samples: 5, refreshed_at: "2026-10-21T16:00:00Z" },
  ],
};

describe("readDispatchMetrics", () => {
  it("states the rates, times and the rider-versus-food wait split in words", () => {
    expect(readDispatchMetrics(full)).toMatchObject({
      offersMade: 40,
      acceptedText: "45% (18)",
      declinedText: "30% (12)",
      noAnswerText: "20% (8)",
      ordersAssigned: 17,
      assignTimeText: "1.6 minutes",
      pickupSamples: 12,
      riderWaitText: "75% of pickups, typically 3 minutes",
      foodWaitText: "25% of pickups, typically 1.5 minutes",
      needsAttentionNow: 2,
    });
  });

  it("says 'learned from N deliveries' or 'using default' per area", () => {
    expect(readDispatchMetrics(full).areas).toEqual([
      { id: "a1", name: "Ibadan", speedText: "21.5 km/h, learned from 44 deliveries", bufferText: "3.5 minutes, learned from 61 offers" },
      { id: "a2", name: "Lagos", speedText: "18 km/h, using default", bufferText: "2.5 minutes, using default" },
    ]);
  });

  it("copes with no data at all (every ratio is null, counts are 0)", () => {
    const empty = readDispatchMetrics({
      offers: { made: 0, accepted: 0, accept_rate: null },
      assignment: { orders_assigned: 0, median_s: null },
      readiness: { samples: 0, rider_waited_share: null, median_rider_wait_s: null },
      reliability: { needs_attention_now: 0 },
      areas: [],
    });
    expect(empty).toMatchObject({ offersMade: 0, acceptedText: "No data yet", assignTimeText: "No data yet", riderWaitText: "No data yet", foodWaitText: "No data yet", areas: [] });
    expect(readDispatchMetrics({}).needsAttentionNow).toBe(0);
  });

  it("refuses a document of the wrong shape", () => {
    expect(() => readDispatchMetrics({ offers: "nope" })).toThrow(/unexpected shape/);
  });
});

describe("formatters", () => {
  it("formats rates and durations", () => {
    expect(formatRate(0.4286)).toBe("43%");
    expect(formatRate(null)).toBe("No data yet");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(3900)).toBe("65 minutes");
    expect(formatDuration(undefined)).toBe("No data yet");
  });
});
