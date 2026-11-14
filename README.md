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

## Google sign-in

The Google button on customer and vendor sign-in/sign-up pages uses Supabase
OAuth with PKCE and returns through `/auth/callback`. New Google accounts are
provisioned by the same database signup trigger as email accounts. Vendor
sign-up continues to `/onboarding`; existing vendor accounts return to their
dashboard.

To activate the provider, create a **Web application** OAuth client in Google
Cloud, set the authorized JavaScript origins to `https://kiakia.ng` and
`https://www.kiakia.ng`, and add the
callback URI displayed on Supabase's **Authentication → Providers → Google**
settings page as an authorized redirect URI in Google Cloud. Then enable Google
on that Supabase page and enter the Google client ID and client secret there.
In Supabase **Authentication → URL Configuration**, allow
`https://kiakia.ng/auth/callback**` and
`https://www.kiakia.ng/auth/callback**` as redirect URLs. The wildcard allows
the callback's `intent` and optional `next` query parameters. Set
`NEXT_PUBLIC_SITE_URL` in Vercel to the production hostname users visit
(currently `https://www.kiakia.ng`). For local development, also allow
`http://localhost:3000/auth/callback**` and use
`NEXT_PUBLIC_SITE_URL=http://localhost:3000` locally. Keep the Google client
secret in Supabase; it is not an app environment variable.

## Payments

§12 of the architecture doc specifies Paystack; this project uses
**Monnify** instead (project decision, not yet reflected in the doc text).
The provider-abstraction shape §12 describes is unchanged — `payments.provider`
is still a checked enum (`monnify` / `flutterwave`), so a future failover
provider stays a config change. The integration is built: payment
initialization in `app/actions/orders.ts`, the client in `lib/monnify.ts`,
and the webhook as the `monnify-webhook` Supabase Edge Function
(`supabase/functions/monnify-webhook/`) — a Route Handler in the Next.js app
originally, moved out so it stays reachable independent of this app's own
deploy/rollback state. It verifies the HMAC signature against the *raw*
body and then re-verifies the transaction against Monnify's own API before
capturing, never trusting the payload's amount or status. Deploy it with
`supabase functions deploy monnify-webhook`, and set its secrets first —
`supabase secrets set MONNIFY_API_KEY=... MONNIFY_API_SECRET=... MONNIFY_BASE_URL=...`
(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are injected automatically). As a
defense-in-depth backstop for a delayed/misconfigured webhook, the order
detail page (`orders/[id]/page.tsx`) also re-verifies and captures a
still-pending payment whenever the customer's browser lands back there.

## Transactional email (Resend)

Signup welcome emails, order received/accepted/on-the-way/delivered/cancelled
updates, and payment receipts are queued by database triggers in
`message_outbox`. The existing `message-worker` sends them through Resend and
retries temporary failures. These operational emails do not depend on
marketing email consent. The order and payment outbox rows use idempotency keys
so a repeated database event does not send another copy.

Admins can also compose group emails from `/admin/messages`. Use **Service
message** for important account or service updates; any admin can send these
to a selected customer, vendor or rider audience. Use **Promotion** for offers
and news; only superadmins can send these, and people without promotional
email consent are skipped. The page previews eligible recipients and skipped
counts, requires a final confirmation, and records delivery history and audit
events.

To enable delivery in a Supabase project:

1. Apply migrations, including `0119_transactional_email_events.sql`.
2. Deploy `supabase functions deploy message-worker`.
3. Set Edge Function secrets: `supabase secrets set RESEND_API_KEY=re_... MESSAGE_FROM_EMAIL="KiaKia <orders@your-verified-domain.com>" MESSAGE_WORKER_SECRET=<random-secret> SITE_URL=https://your-site.example`. Add `MESSAGE_REPLY_TO` if needed. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase.
4. Store the matching worker URL and secret in Vault using the SQL shown in the header of `supabase/migrations/0096_rider_offer_sms_and_scheduling.sql`. The existing `message-worker-tick` cron job drains the outbox; the database triggers also nudge it immediately.
5. If signup email verification is enabled, configure Supabase Auth's SMTP settings to use Resend too. The database welcome email is separate from Supabase Auth's verification email. Resend only delivers from a verified sending domain.
6. For hosted Supabase, set the **Confirm signup** email template separately in **Authentication â†’ Email Templates**. Set the subject to `Your KiaKia verification code` and copy the content from `supabase/templates/confirmation.html`. It uses `{{ .Token }}` for the six-digit code. `supabase db push` does not update hosted Auth email templates; `supabase/config.toml` configures local Supabase.

Never put `RESEND_API_KEY` or `MESSAGE_WORKER_SECRET` in the web app's public
environment variables or commit them to the repository.

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
