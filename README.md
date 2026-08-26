# KiaKia

Food & goods delivery marketplace — Customer, Vendor, and (later) Rider apps
on a shared Supabase backend. See [`kiakia-system-architecture.md`](kiakia-system-architecture.md)
for the full architecture and build plan; this README covers running what's
currently in the repo.

**Current status:** the customer and vendor web apps and the full Supabase
backend are built. Checkout (Monnify), the order state machine, rider
dispatch, delivery-code verification, escrow release with the three-way
vendor/rider/platform payout split, refunds/escrow unwind, and a minimal
admin surface all exist — see `supabase/migrations/` (through `0032`) for
the authoritative picture.

Two important caveats:

- **The rider app is a separate application, outside this repo.** This repo
  deliberately contains no rider UI. What it provides is the backend surface
  that app calls directly via the Supabase client SDK with a rider's own JWT:
  `register_rider`, `set_rider_online`, `update_rider_location`,
  `accept_dispatch_offer` / `decline_dispatch_offer`,
  `get_rider_offer_details`, `get_rider_earnings`, and
  `verify_delivery_and_release_escrow`.
- **Payout *execution* is still not built.** Escrow release credits vendor
  and rider `available` ledger accounts correctly, but nothing pays that
  money out to a bank account — there is no payout provider integration and
  no "withdraw" flow. Balances are real; withdrawal is not.

## Repo layout

```
apps/
  web/            Next.js 16 — customer + vendor route groups
packages/
  domain/         Pure business logic (money, order state machine, pricing) — no I/O, 100% unit tested
  db/             Supabase-generated Database types (currently hand-authored, see packages/db/src/generated.ts)
  ui/             Design tokens + shared components
  config/         Shared ESLint/TypeScript config
supabase/
  migrations/     Schema, RLS policies, transition_order() — the source of truth for the database
  seed.sql        Local dev seed data only
  tests/          pgTAP tests (RLS + function correctness)
```

## Prerequisites

- Node.js ≥ 20.9
- pnpm ≥ 10 (`corepack enable` will pick up the version pinned in `package.json`)
- A Supabase project, once you're past static/marketing routes (see below)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) + Docker, only if you want to run migrations/pgTAP locally

## Getting started

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in real Supabase values, or leave placeholders — see below
pnpm dev
```

Open http://localhost:3000.

**You do not need a live Supabase project to run `pnpm dev` or `pnpm build`.**
`apps/web/.env.local` just needs *correctly-shaped* values (a well-formed
URL, a non-empty string) — `lib/env.client.ts` / `lib/env.server.ts`
validate shape at startup, not liveness. The `(marketing)` route group
(`/`) has no Supabase dependency at all and is fully static. Anything past
`/login` needs a real project, because phone OTP needs a real SMS-capable
Supabase Auth backend.

## Database

Migrations in `supabase/migrations/` are the source of truth — never make
schema changes through the Supabase dashboard. To apply them locally:

```bash
supabase start          # requires Docker
supabase db reset       # applies all migrations + seed.sql
supabase test db        # runs the pgTAP suite in supabase/tests
```

To point at a real project instead:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Once a real project exists, regenerate `packages/db/src/generated.ts` from
it rather than hand-editing:

```bash
pnpm --filter @kiakia/db gen:types
```

## Commands

Run from the repo root (Turborepo fans these out to every workspace):

```bash
pnpm dev         # apps/web dev server
pnpm build       # build every app/package
pnpm lint        # ESLint everywhere
pnpm typecheck   # tsc --noEmit everywhere
pnpm test        # Vitest (packages/domain today)
pnpm ci          # everything CI runs, in one shot
```

## Payments

§12 of the architecture doc specifies Paystack; this project uses
**Monnify** instead (project decision, not yet reflected in the doc text).
The provider-abstraction shape §12 describes is unchanged — `payments.provider`
is still a checked enum (`monnify` / `flutterwave`), so a future failover
provider stays a config change. The integration is built: payment
initialization in `app/actions/orders.ts`, the client in `lib/monnify.ts`,
and the webhook at `app/api/webhooks/monnify/route.ts` — which verifies the
HMAC signature against the *raw* body and then re-verifies the transaction
against Monnify's own API before capturing, never trusting the payload's
amount or status.

## Maps

The customer live-tracking map (`/orders/[id]/tracking`) uses Mapbox GL.
Set `NEXT_PUBLIC_MAPBOX_TOKEN` in `apps/web/.env.local` — get one from
https://account.mapbox.com/access-tokens/.

The token is **optional**: with it unset the map degrades to a neutral
"map unavailable" panel and everything else on the tracking page (timeline,
rider card, delivery code) still works, so `pnpm build` succeeds without it.
Rider positions reach the browser over Supabase Realtime from the
`order_rider_locations` table, which stores plain lat/lng — the PostGIS
`geography` columns are never sent to the client as raw WKB.

## Security notes

- The Supabase **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`) and
  **Monnify's API secret** (`MONNIFY_API_SECRET`) must never be prefixed
  `NEXT_PUBLIC_` and are only ever imported from
  `apps/web/src/lib/supabase/admin.ts` / `apps/web/src/lib/env.server.ts`
  (guarded by the `server-only` package). CI greps for violations of this
  on every push.
- Every table has RLS enabled; writes are revoked from `authenticated` on
  every table that touches money, order state, or rider assignment — those
  go through `transition_order()` or a future SECURITY DEFINER RPC, never
  a direct client write. See `supabase/migrations/0007_rls.sql`.
- Content-Security-Policy is generated per-request with a nonce in
  `apps/web/src/proxy.ts`, not a static header — see the comment there for
  why.
