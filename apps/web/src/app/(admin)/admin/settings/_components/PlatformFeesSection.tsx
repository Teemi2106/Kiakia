import { auditActionLabel } from "../../../_components/labels";
import { formatDateTime, formatPercent, money } from "../../../_components/format";
import { Fields, Section } from "../../../_components/Section";
import type { FeeChange, PlatformFeeValue } from "@/lib/admin/platform-fees";
import { PLATFORM_FEES, platformFeeExample } from "@/lib/admin/platform-fee-info";
import Link from "next/link";
import { PlatformFeeForm } from "./PlatformFeeForm";

const FEE_TITLES: Record<string, string> = Object.fromEntries(PLATFORM_FEES.map((fee) => [fee.key, fee.title]));

function changeSummary(change: FeeChange): string {
  if (!change.change) return auditActionLabel(change.action);
  const title = FEE_TITLES[change.change.key] ?? "Platform fee";
  return `${title}: ${formatPercent(change.change.from)} to ${formatPercent(change.change.to)}`;
}

export function PlatformFeesSection({
  fees,
  changes,
  canEdit,
}: {
  fees: readonly PlatformFeeValue[];
  changes: readonly FeeChange[];
  canEdit: boolean;
}) {
  return (
    <Section title="Platform fees">
      <div className="flex flex-col gap-6">
        <p className="text-sm text-ink-muted">
          These are the fees that apply across all of KiaKia. A change applies to new orders only; orders already placed keep the fees they were placed with. Changing a fee changes how much money
          customers pay and how much KiaKia and vendors earn.
        </p>

        {PLATFORM_FEES.map((info) => {
          const current = fees.find((fee) => fee.key === info.key);
          return (
            <div key={info.key} className="flex flex-col gap-3 rounded-control border border-line p-4">
              <h3 className="font-medium text-ink">{info.title}</h3>
              <p className="text-sm text-ink-muted">
                {info.what} {info.whoPays}
              </p>
              {current ? (
                <>
                  <Fields
                    items={[
                      { label: "Current rate", value: formatPercent(current.valueBps) },
                      { label: "Example", value: platformFeeExample(info.key, current.valueBps, money) },
                      { label: "Last changed", value: `${formatDateTime(current.updatedAt)}${current.updatedByName ? ` by ${current.updatedByName}` : ""}` },
                      { label: "A change applies to", value: info.appliesTo },
                    ]}
                  />
                  {canEdit ? (
                    <PlatformFeeForm fee={info} currentBps={current.valueBps} />
                  ) : (
                    <p className="text-sm text-ink-muted">Only finance admins and superadmins can change fees. Ask one of them.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-danger">This fee could not be loaded. Please contact the technical team.</p>
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-2 text-sm">
          <h3 className="font-medium text-ink">Other fees, set elsewhere</h3>
          <ul className="list-disc pl-5 text-ink-muted">
            <li>
              Delivery fee customers pay, and what riders earn per delivery: set for each delivery area further down this page (<a className="underline" href="#delivery-areas">go to delivery areas</a>).
            </li>
            <li>
              Commission for one particular store: open the store under <Link className="underline" href="/admin/vendors">Vendors</Link> and use its commission control. Commission is worked out when an
              order is delivered, so changing a store&apos;s commission also applies to its paid orders that are not yet delivered.
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <h3 className="font-medium text-ink">Recent fee changes</h3>
          {changes.length === 0 ? (
            <p className="text-ink-muted">No fee has been changed yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {changes.map((change) => (
                <li key={change.id} className="text-ink">
                  <span>{changeSummary(change)}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · {formatDateTime(change.at)}
                    {change.actorName ? ` · ${change.actorName}` : ""}
                    {change.reason ? ` · "${change.reason}"` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link className="text-ink-muted underline" href="/admin/audit">
            See the full activity log
          </Link>
        </div>
      </div>
    </Section>
  );
}
