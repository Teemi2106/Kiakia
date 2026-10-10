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
      <Section title={hasRider ? "Unassign and re-offer" : "Offer to riders now"}>
        <p className="mb-3 text-sm text-ink-muted">
          {hasRider
            ? "Removes the current rider and puts the order back up for dispatch. If the order is already assigned, it returns to ready for pickup. The 30-minute dispatch window restarts."
            : "Opens the order to nearby riders now. The 30-minute dispatch window restarts."}
        </p>
        <AdminActionForm
          action={reassignOrderRiderAction}
          submitLabel={hasRider ? "Unassign and re-offer" : "Offer to riders"}
          reason={{ required: true }}
          confirmLabel="I confirm this order should be re-offered to riders."
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="riderId" value="" />
        </AdminActionForm>
      </Section>

      <Section title={hasRider ? "Assign another rider" : "Assign a rider"}>
        <p className="mb-3 text-sm text-ink-muted">
          Assigns the selected rider directly, skipping the offer. The rider fee shown is frozen on the order.
        </p>
        {riders.length === 0 ? (
          <p className="text-sm text-ink-muted">No eligible riders online near this vendor.</p>
        ) : (
          <AdminActionForm
            action={reassignOrderRiderAction}
            submitLabel="Assign rider"
            reason={{ required: true }}
            confirmLabel="I confirm this rider should be assigned."
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
                      {rider.phone ?? "No phone"} · {(rider.pickupDistanceM / 1000).toFixed(1)} km from vendor · fee{" "}
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
