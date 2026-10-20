import { reassignOrderRiderAction } from "@/app/actions/admin";
import type { AssignableRider } from "@/lib/admin/orders";
import { AdminActionForm } from "../../../../_components/AdminActionForm";
import { formatDateTime, money } from "../../../../_components/format";
import { Section } from "../../../../_components/Section";

interface RiderDispatchProps {
  orderId: string;
  hasRider: boolean;
  riders: readonly AssignableRider[];
}

export function RiderDispatch({ orderId, hasRider, riders }: RiderDispatchProps) {
  return (
    <>
      <Section title={hasRider ? "Take the rider off this order" : "Offer to nearby riders now"}>
        <p className="mb-3 text-sm text-ink-muted">
          {hasRider
            ? "Removes the current rider and offers the order to other nearby riders. They have 30 minutes to accept. It does not move money, and the removed rider is not offered it again."
            : "Offers the order to nearby riders now. They have 30 minutes to accept. It does not move money."}
        </p>
        <AdminActionForm
          action={reassignOrderRiderAction}
          submitLabel={hasRider ? "Remove rider and offer to others" : "Offer to riders"}
          reason={{ required: true }}
          confirmLabel="I confirm this order should be offered to other riders."
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="riderId" value="" />
        </AdminActionForm>
      </Section>

      <Section title={hasRider ? "Assign a different rider" : "Assign a rider yourself"}>
        <p className="mb-3 text-sm text-ink-muted">
          Picks the rider yourself instead of waiting for someone to accept. The fee shown is what that rider will earn for this delivery.
        </p>
        {riders.length === 0 ? (
          <p className="text-sm text-ink-muted">No rider is available near this store right now. Riders must be approved, online and not busy with another order.</p>
        ) : (
          <AdminActionForm
            action={reassignOrderRiderAction}
            submitLabel="Assign this rider"
            reason={{ required: true }}
            confirmLabel="I confirm this rider should do this delivery."
          >
            <input type="hidden" name="orderId" value={orderId} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">Rider</legend>
              {riders.map((rider, index) => (
                <label
                  key={rider.riderId}
                  className="flex cursor-pointer items-start gap-3 rounded-control border border-border px-3 py-2 text-sm"
                >
                  <input type="radio" name="riderId" value={rider.riderId} required={index === 0} className="mt-1 size-4" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-ink">{rider.fullName ?? rider.riderId}</span>
                    <span className="text-ink-muted">
                      {rider.phone ?? "No phone"} · {(rider.pickupDistanceM / 1000).toFixed(1)} km from the store · earns{" "}
                      {money(rider.riderFeeKobo)} · last seen {formatDateTime(rider.lastPingAt)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          </AdminActionForm>
        )}
      </Section>
    </>
  );
}
