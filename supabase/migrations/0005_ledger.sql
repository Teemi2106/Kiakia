-- KiaKia — Phase 0 foundation migration 5/7.
-- Double-entry ledger (§9 "The ledger invariant", §6.2 of the shareholder
-- doc — "the most serious class of failure in the platform"). Escrow
-- hold/release and payout execution are Phase 4 (§21) and not built here;
-- this migration only lays the ledger itself, with the invariant enforced
-- by the database rather than trusted to application code.

create table accounts (
  id          uuid primary key default uuid_generate_v7(),
  owner_type  text not null check (owner_type in ('platform', 'vendor', 'rider')),
  owner_id    uuid, -- null for platform-wide accounts (e.g. platform:revenue, gateway)
  kind        text not null check (kind in ('escrow', 'available', 'pending_payout', 'revenue', 'gateway')),
  currency    text not null default 'NGN' check (currency = 'NGN'),
  created_at  timestamptz not null default now(),

  unique (owner_type, owner_id, kind)
);

comment on table accounts is
  'Account identity only — no balance column. Balances are never stored directly; they are always derived from ledger_entries (see the account_balances view below) so a balance can never drift from the transactions that produced it.';

create index accounts_owner_idx on accounts (owner_type, owner_id);

create table transactions (
  id           uuid primary key default uuid_generate_v7(),
  kind         text not null check (kind in ('payment_capture', 'escrow_release', 'payout', 'refund', 'adjustment')),
  reference    text not null unique,
  order_id     uuid references orders (id),
  description  text,
  created_at   timestamptz not null default now()
);

comment on table transactions is
  'reference is the idempotency anchor (§12): a duplicate webhook or retried payout must resolve to the same reference, never a second transaction.';

create table ledger_entries (
  id              uuid primary key default uuid_generate_v7(),
  transaction_id  uuid not null references transactions (id),
  account_id      uuid not null references accounts (id),
  direction       text not null check (direction in ('debit', 'credit')),
  amount_kobo     bigint not null check (amount_kobo > 0),
  entry_type      text not null,
  order_id        uuid references orders (id),
  created_at      timestamptz not null default now()
);

create index ledger_entries_transaction_id_idx on ledger_entries (transaction_id);
create index ledger_entries_account_id_idx on ledger_entries (account_id);

-- The ledger invariant: for every transaction, sum(debits) = sum(credits).
-- Deferred so a multi-row insert inside one transaction only gets checked
-- once all rows for that transaction_id are in place, at COMMIT.
create or replace function check_ledger_balance()
returns trigger
language plpgsql
as $$
declare
  debit_total bigint;
  credit_total bigint;
begin
  select
    coalesce(sum(amount_kobo) filter (where direction = 'debit'), 0),
    coalesce(sum(amount_kobo) filter (where direction = 'credit'), 0)
  into debit_total, credit_total
  from ledger_entries
  where transaction_id = new.transaction_id;

  if debit_total <> credit_total then
    raise exception
      'Ledger imbalance on transaction %: debits=% credits=% — this must page someone, see §17',
      new.transaction_id, debit_total, credit_total;
  end if;

  return new;
end;
$$;

create constraint trigger ledger_entries_balance_check
  after insert or update on ledger_entries
  deferrable initially deferred
  for each row execute function check_ledger_balance();

comment on trigger ledger_entries_balance_check on ledger_entries is
  'If this ever fires in production, that is the "ledger imbalance detected — critical" alert from §17. Re-verified nightly by a separate reconciliation job (Phase 4), not built here.';

-- Derived balance — always computed, never stored.
create view account_balances as
select
  account_id,
  coalesce(sum(case when direction = 'credit' then amount_kobo else -amount_kobo end), 0) as balance_kobo
from ledger_entries
group by account_id;

-- ---------------------------------------------------------------------------
-- payments — inbound Monnify transactions (§12; provider swapped from
-- Paystack to Monnify per project decision — the provider-abstraction
-- shape itself is unchanged, so a future failover provider is still a
-- config change, not a rewrite).
-- ---------------------------------------------------------------------------

create table payments (
  id               uuid primary key default uuid_generate_v7(),
  order_id         uuid not null references orders (id),
  provider         text not null default 'monnify' check (provider in ('monnify', 'flutterwave')),
  provider_ref     text not null unique,
  amount_kobo      bigint not null check (amount_kobo > 0),
  channel          text check (channel in ('card', 'bank_transfer', 'ussd')),
  status           text not null default 'pending' check (status in ('pending', 'success', 'failed', 'refunded')),
  raw              jsonb not null default '{}'::jsonb,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now()
);

comment on table payments is
  'provider_ref uniqueness is what makes the webhook handler idempotent on a duplicate delivery (§6.3 / §12 point 5).';

create index payments_order_id_idx on payments (order_id);
