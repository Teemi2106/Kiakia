import type { LedgerHealth } from "@/lib/admin/finance";
import { Badge } from "@kiakia/ui";
import type { ReactNode } from "react";
import { formatDateTime, humanize, money } from "../../../_components/format";
import { Section } from "../../../_components/Section";

export function LedgerHealthPanel({ health }: { health: LedgerHealth }) {
  const unbalanced = health.unbalanced_transactions;
  const checks = [
    {
      label: "Every transaction balances",
      ok: unbalanced.count === 0,
      detail: unbalanced.count === 0 ? "No unbalanced transactions." : `${unbalanced.count} unbalanced transaction(s).`,
    },
    {
      label: "Total debits equal total credits",
      ok: health.totals.difference_kobo === 0,
      detail: `Debits ${money(health.totals.debit_kobo)}, credits ${money(health.totals.credit_kobo)}, difference ${money(health.totals.difference_kobo)}.`,
    },
    {
      label: "Escrow matches held orders",
      ok: health.escrow.drift_kobo === 0,
      detail: `Held ${money(health.escrow.actual_kobo)}, expected ${money(health.escrow.expected_kobo)}, drift ${money(health.escrow.drift_kobo)}.`,
    },
    {
      label: "No negative balances",
      ok: health.negative_accounts.length === 0,
      detail:
        health.negative_accounts.length === 0
          ? "No account is below zero."
          : `${health.negative_accounts.length} account(s) below zero.`,
    },
  ];
  const healthy = checks.every((check) => check.ok);

  return (
    <Section
      title="Ledger health"
      aside={<Badge tone={healthy ? "positive" : "danger"}>{healthy ? "All checks passing" : "Needs attention"}</Badge>}
    >
      <ul className="flex flex-col divide-y divide-border">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div>
              <p className="font-medium text-ink">{check.label}</p>
              <p className="text-ink-muted">{check.detail}</p>
            </div>
            <Badge tone={check.ok ? "positive" : "danger"}>{check.ok ? "OK" : "Alert"}</Badge>
          </li>
        ))}
      </ul>

      {unbalanced.sample.length > 0 && (
        <Detail title="Unbalanced transactions (sample)">
          {unbalanced.sample.map((transaction) => (
            <li key={transaction.transaction_id}>
              <span className="font-mono text-xs">{transaction.reference}</span>: debit {money(transaction.debit_kobo)}, credit{" "}
              {money(transaction.credit_kobo)}
            </li>
          ))}
        </Detail>
      )}

      {health.negative_accounts.length > 0 && (
        <Detail title="Accounts below zero">
          {health.negative_accounts.map((account) => (
            <li key={account.account_id}>
              {humanize(account.owner_type)} {account.kind}
              {account.owner_id && <span className="font-mono text-xs"> {account.owner_id}</span>}: {money(account.balance_kobo)}
            </li>
          ))}
        </Detail>
      )}

      <p className="mt-3 text-xs text-ink-muted">Checked {formatDateTime(health.checked_at)}</p>
    </Section>
  );
}

function Detail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3 rounded-control bg-danger-surface p-3 text-sm text-danger">
      <p className="font-medium">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">{children}</ul>
    </div>
  );
}
