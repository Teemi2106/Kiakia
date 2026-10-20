import type { PayoutRecord } from "@/lib/admin/finance";
import type { ReactNode } from "react";
import { money } from "./format";
import { MarkAsPaid } from "./MarkAsPaid";
import { PayoutHistory } from "./PayoutHistory";
import { Fields, Section } from "./Section";

/**
 * The money part of a vendor or rider page: what is owed now, what has been
 * paid so far, where to pay it, the Mark as paid form and the payment history.
 */
export function OwnerMoney({
  ownerType,
  ownerId,
  ownerName,
  owedKobo,
  paidKobo,
  bank,
  canRecord,
  payouts,
}: {
  ownerType: "vendor" | "rider";
  ownerId: string;
  ownerName: string;
  owedKobo: number;
  paidKobo: number;
  /** Where the money goes: the rider's bank details, or a note that none are on file. */
  bank: ReactNode;
  canRecord: boolean;
  payouts: readonly PayoutRecord[];
}) {
  return (
    <>
      <Section title="Money owed and paid">
        <div className="flex flex-col gap-5">
          <Fields
            items={[
              { label: "Amount owed now", value: <strong className="text-lg">{money(owedKobo)}</strong> },
              { label: "Total paid so far", value: money(paidKobo) },
              { label: "Bank details", value: bank },
            ]}
          />
          <MarkAsPaid ownerType={ownerType} ownerId={ownerId} ownerName={ownerName} owedKobo={owedKobo} canRecord={canRecord} />
        </div>
      </Section>

      <Section title="Payment history">
        <PayoutHistory payouts={payouts} emptyTitle={`Nothing has been paid to ${ownerName} yet`} />
      </Section>
    </>
  );
}
