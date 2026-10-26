import type { DispatchMetrics } from "@/lib/admin/dispatch-metrics";
import { Fields, Section } from "../../../_components/Section";

/** "How dispatch is doing (last 7 days)": compact, plain-language, from admin_dispatch_metrics(). */
export function DispatchMetricsPanel({ metrics }: { metrics: DispatchMetrics }) {
  return (
    <Section title="How dispatch is doing (last 7 days)">
      <div className="flex flex-col gap-4">
        {metrics.offersMade === 0 && metrics.ordersAssigned === 0 ? (
          <p className="text-sm text-ink-muted">No riders have been asked in the last 7 days yet.</p>
        ) : (
          <Fields
            items={[
              { label: `Riders asked (${metrics.offersMade})`, value: `Accepted ${metrics.acceptedText} · Declined ${metrics.declinedText} · No answer ${metrics.noAnswerText}` },
              { label: `From the store accepting to a rider assigned (${metrics.ordersAssigned} orders)`, value: `Typically ${metrics.assignTimeText}` },
              { label: `Rider had to wait for the food (${metrics.pickupSamples} pickups)`, value: metrics.riderWaitText },
              { label: "Food had to wait for the rider", value: metrics.foodWaitText },
              { label: "Needing attention right now", value: String(metrics.needsAttentionNow) },
            ]}
          />
        )}

        {metrics.areas.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-ink">What the system has learned, by area</h3>
            <ul className="flex flex-col gap-1.5 text-sm">
              {metrics.areas.map((area) => (
                <li key={area.id} className="text-ink">
                  <span className="font-medium">{area.name}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · Rider speed: {area.speedText} · Time allowed to find a rider: {area.bufferText}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}
