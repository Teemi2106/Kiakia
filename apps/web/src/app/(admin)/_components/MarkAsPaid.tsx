import { recordPayoutAction } from "@/app/actions/admin-finance";
import { Input } from "@kiakia/ui";
import { AdminActionForm } from "./AdminActionForm";
import { Field } from "./Field";
import { money, nairaInputValue } from "./format";

/**
 * Who may record a payout. Not a gate (recordPayoutAction re-checks finance
 * access itself); it only keeps an admin without that access from meeting a
 * dead end.
 */
function NoPayoutAccess({ ownerName, owedKobo }: { ownerName: string; owedKobo: number }) {
  return (
    <p role="note" className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink">
      {money(owedKobo)} is owed to {ownerName}. Your account cannot mark payouts as paid. Ask a finance admin or a superadmin to do it.
    </p>
  );
}

/**
 * The one "I paid them" form, used on the Payouts page and on every vendor and
 * rider page. It books a bank transfer that was already made by hand: KiaKia
 * sends no money. The amount starts at everything that is owed.
 */
export function MarkAsPaid({
  ownerType,
  ownerId,
  ownerName,
  owedKobo,
  canRecord,
}: {
  ownerType: "vendor" | "rider";
  ownerId: string;
  ownerName: string;
  owedKobo: number;
  /** canManageFinance() for the signed-in admin. */
  canRecord: boolean;
}) {
  if (owedKobo <= 0) {
    return <p className="text-sm text-ink-muted">Nothing is owed to {ownerName} right now.</p>;
  }
  if (!canRecord) return <NoPayoutAccess ownerName={ownerName} owedKobo={owedKobo} />;

  const amountId = `paid-amount-${ownerId}`;
  const referenceId = `paid-reference-${ownerId}`;

  return (
    <AdminActionForm
      action={recordPayoutAction}
      submitLabel="Mark as paid"
      reason={{ label: "Note" }}
      confirmLabel={`I have already sent this money to ${ownerName} from our bank. Record it as paid.`}
    >
      <input type="hidden" name="ownerType" value={ownerType} />
      <input type="hidden" name="ownerId" value={ownerId} />
      <p className="text-sm text-ink-muted">
        This only records a bank transfer you have already made. KiaKia does not send any money. It lowers what is owed to{" "}
        {ownerName} and cannot be undone here.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount you paid (naira)" htmlFor={amountId}>
          <Input
            id={amountId}
            name="amountNaira"
            inputMode="decimal"
            required
            autoComplete="off"
            defaultValue={nairaInputValue(owedKobo)}
          />
        </Field>
        <Field label="Bank transfer reference" htmlFor={referenceId}>
          <Input id={referenceId} name="externalReference" required minLength={3} maxLength={64} autoComplete="off" />
          <span className="text-xs text-ink-muted">
            The transaction or session ID from your bank. It stops the same payment being recorded twice.
          </span>
        </Field>
      </div>
    </AdminActionForm>
  );
}
