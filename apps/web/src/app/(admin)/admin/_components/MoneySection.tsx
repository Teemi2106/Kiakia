import { MONEY_RANGES, type MoneyRange, type MoneySummary } from "@/lib/admin/finance";
import { Badge, Card, CardBody, cn } from "@kiakia/ui";
import Link from "next/link";
import { money } from "../../_components/format";
import { LinkTabs } from "../../_components/LinkTabs";
import { Section } from "../../_components/Section";

const RANGE_LABELS: Record<MoneyRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

/** Used in the section title and in "paid in ...". */
const RANGE_PHRASES: Record<MoneyRange, string> = {
  today: "today",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  all: "all time",
};

/**
 * The Overview's Money section. Everything comes from one admin_money_summary()
 * call (ledger-derived). The first group follows the time range in the URL;
 * the second is "right now" and never changes with it.
 */
export function MoneySection({ summary, range }: { summary: MoneySummary; range: MoneyRange }) {
  const phrase = RANGE_PHRASES[range];
  const quiet = summary.processedKobo === 0 && summary.refundedKobo === 0 && summary.platformEarningsKobo === 0;
  const { reconciliation } = summary;

  return (
    <Section
      title="Money"
      aside={
        <Link
          href="/admin/finance"
          className="inline-flex items-center gap-2 text-sm hover:underline"
          title={
            reconciliation.reconciles
              ? "Every naira received is accounted for. Open Finance for the full check."
              : `Money received and money accounted for differ by ${money(Math.abs(reconciliation.differenceKobo))}. Open Finance to see why.`
          }
        >
          <Badge tone={reconciliation.reconciles ? "positive" : "danger"}>
            {reconciliation.reconciles ? "Books balance" : "Doesn't add up: check Finance"}
          </Badge>
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <LinkTabs
          label="Money time range"
          value={range}
          items={MONEY_RANGES.map((value) => ({ value, label: RANGE_LABELS[value], href: `/admin?range=${value}` }))}
        />

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">What happened, {phrase}</p>
          {quiet && (
            <p className="rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              No money moved {phrase}. These are real zeros, not an error. Try a longer time range.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MoneyCard
              label="Total processed"
              value={money(summary.processedKobo)}
              explain="All the money customers paid for orders, including orders still on the way or refunded later."
              detail={`${money(summary.processedCardKobo)} by card or transfer, ${money(summary.processedWalletKobo)} from wallets`}
            />
            <MoneyCard
              label="KiaKia earnings"
              value={money(summary.platformEarningsKobo)}
              explain="KiaKia's own share of delivered orders: commission and service fees."
              detail={`From ${summary.deliveredOrders} delivered ${summary.deliveredOrders === 1 ? "order" : "orders"} worth ${money(summary.deliveredGmvKobo)}`}
            />
            <MoneyCard
              label="Refunded to customers"
              value={money(summary.refundedKobo)}
              explain="Money given back to customers for cancelled or failed orders."
              detail={`${money(summary.refundedGatewayKobo)} to their card, ${money(summary.refundedWalletKobo)} to their wallet`}
            />
            <MoneyCard
              label="Paid to vendors"
              value={money(summary.paidToVendorsInWindowKobo)}
              explain="Bank transfers you have recorded as paid to vendors."
              detail={`Vendors earned ${money(summary.vendorEarnedKobo)}. ${money(summary.paidToVendorsKobo)} paid all time`}
              href="/admin/payouts?tab=history"
            />
            <MoneyCard
              label="Paid to riders"
              value={money(summary.paidToRidersInWindowKobo)}
              explain="Bank transfers you have recorded as paid to riders."
              detail={`Riders earned ${money(summary.riderEarnedKobo)}. ${money(summary.paidToRidersKobo)} paid all time`}
              href="/admin/payouts?tab=history"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Right now (not affected by the time range)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyCard
              label="Held until delivery"
              value={money(summary.heldInEscrowKobo)}
              explain="Customers' money for orders not yet delivered. Nobody is paid from it until delivery."
            />
            <MoneyCard
              label="Owed to vendors"
              value={money(summary.owedToVendorsKobo)}
              explain="Earned by vendors and not yet paid out. Tap to pay."
              href="/admin/payouts"
              attention={summary.owedToVendorsKobo > 0}
            />
            <MoneyCard
              label="Owed to riders"
              value={money(summary.owedToRidersKobo)}
              explain="Earned by riders and not yet paid out. Tap to pay."
              href="/admin/payouts"
              attention={summary.owedToRidersKobo > 0}
            />
            <MoneyCard
              label="Customer wallet balances"
              value={money(summary.customerWalletKobo)}
              explain="Refunds customers are holding in their KiaKia wallets. They can spend it on orders."
              href="/admin/finance"
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

function MoneyCard({
  label,
  value,
  explain,
  detail,
  href,
  attention,
}: {
  label: string;
  value: string;
  explain: string;
  detail?: string;
  href?: string;
  attention?: boolean;
}) {
  const body = (
    <Card className={cn("h-full", href && "hover:bg-surface-sunken", attention && "border-brand-500")}>
      <CardBody>
        <p className="text-xs uppercase tracking-wide">{label}</p>
        <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
        <p className="mt-1 text-xs text-ink-muted">{explain}</p>
        {detail && <p className="mt-1 text-xs">{detail}</p>}
      </CardBody>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
