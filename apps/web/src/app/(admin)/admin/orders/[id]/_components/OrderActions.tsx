import { refundOrderEscrowAction, resetDeliveryCodeAttemptsAction } from "@/app/actions/admin";
import { requestGatewayRefundAction } from "@/app/actions/admin-finance";
import type { AssignableRider, OrderDetail } from "@/lib/admin/orders";
import { REFUND_NOT_SENT, REFUND_STATUS_UNKNOWN } from "@/lib/admin/refund-messages";
import { Select } from "@kiakia/ui";
import { AdminActionForm } from "../../../../_components/AdminActionForm";
import { ConfirmedAction } from "../../../../_components/ConfirmedAction";
import { Field } from "../../../../_components/Field";
import { Section } from "../../../../_components/Section";
import { RiderDispatch } from "./RiderDispatch";

/**
 * Gateway outcomes that are not failures of the ledger refund (which stands):
 * the Monnify side is unconfirmed or was not sent. Rendered in a warning tone.
 */
const GATEWAY_WARNINGS = [REFUND_STATUS_UNKNOWN, REFUND_NOT_SENT] as const;

/** Which actions are offered is derived from the loaded state; the RPCs re-check it. */
export function OrderActions({ detail, assignableRiders }: { detail: OrderDetail; assignableRiders: readonly AssignableRider[] }) {
  const { order, escrow, payment, canReassignRider } = detail;

  const canRefund = escrow.state === "held";
  const canResetCode = order.status === "arrived";
  const canRetryGatewayRefund =
    escrow.state === "refunded" && escrow.refundDestination === "gateway" && payment !== null && payment.refundReference === null;

  if (!canRefund && !canResetCode && !canRetryGatewayRefund && !canReassignRider) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {canReassignRider && <RiderDispatch orderId={order.id} hasRider={order.rider_id !== null} riders={assignableRiders} />}

      {canRefund && (
        <Section title="Refund escrow">
          <p className="mb-3 text-sm text-ink-muted">
            Reverses the captured payment while it is still held in escrow. A wallet refund is instant; a gateway refund
            also asks Monnify to send the money back to the customer&apos;s card or bank.
          </p>
          <AdminActionForm
            action={refundOrderEscrowAction}
            submitLabel="Refund order"
            variant="danger"
            reason={{ required: true }}
            confirmLabel="I confirm this order should be refunded in full."
            warningErrors={GATEWAY_WARNINGS}
          >
            <input type="hidden" name="orderId" value={order.id} />
            <Field label="Refund to" htmlFor="refund-destination">
              <Select id="refund-destination" name="destination" defaultValue="wallet">
                <option value="wallet">Customer wallet (instant)</option>
                <option value="gateway">Original payment method (Monnify)</option>
              </Select>
            </Field>
          </AdminActionForm>
        </Section>
      )}

      {canRetryGatewayRefund && (
        <Section title="Retry gateway refund">
          <p className="mb-3 text-sm text-ink-muted">
            The ledger refund went to the gateway, but no refund request has been recorded with Monnify.
          </p>
          <AdminActionForm
            action={requestGatewayRefundAction}
            submitLabel="Retry gateway refund"
            reason={{}}
            confirmLabel="I confirm the customer has not already been refunded outside KiaKia."
            warningErrors={GATEWAY_WARNINGS}
          >
            <input type="hidden" name="orderId" value={order.id} />
          </AdminActionForm>
        </Section>
      )}

      {canResetCode && (
        <Section title="Delivery code">
          <p className="mb-3 text-sm text-ink-muted">
            Clears the failed-attempt lockout so the rider can try the customer&apos;s code again. Use it after confirming
            with the customer.
          </p>
          <ConfirmedAction
            action={resetDeliveryCodeAttemptsAction.bind(null, order.id)}
            submitLabel="Reset delivery code attempts"
            reasonLabel="Reason"
            confirmLabel="I have confirmed this with the customer."
          />
        </Section>
      )}
    </div>
  );
}
