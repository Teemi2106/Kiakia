import { recordPayoutAction } from "@/app/actions/admin-finance";
import { Input } from "@kiakia/ui";
import { AdminActionForm } from "../../../_components/AdminActionForm";
import { Field } from "../../../_components/Field";

/** Books a bank transfer that has already been made; it does not move any money. */
export function PayoutForm({ ownerType, ownerId }: { ownerType: "vendor" | "rider"; ownerId: string }) {
  const amountId = `payout-amount-${ownerId}`;
  const referenceId = `payout-reference-${ownerId}`;

  return (
    <AdminActionForm
      action={recordPayoutAction}
      submitLabel="Record payout"
      reason={{}}
      confirmLabel="I have already sent this transfer; record it against the balance."
    >
      <input type="hidden" name="ownerType" value={ownerType} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (naira)" htmlFor={amountId}>
          <Input id={amountId} name="amountNaira" inputMode="decimal" required placeholder="0.00" autoComplete="off" />
        </Field>
        <Field label="Bank reference" htmlFor={referenceId}>
          <Input id={referenceId} name="externalReference" required minLength={3} maxLength={64} autoComplete="off" />
        </Field>
      </div>
    </AdminActionForm>
  );
}
