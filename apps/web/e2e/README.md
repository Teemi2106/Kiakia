# End-to-end tests

Two independent suites live here.

| Suite | Config | Needs | Command |
| --- | --- | --- | --- |
| Golden paths (`customer-order`, `vendor-fulfillment`) | `playwright.config.ts` | a running app + a seeded project and the `E2E_CUSTOMER_*` / `E2E_VENDOR_*` env vars (see `fixtures.ts`) | `pnpm --filter web e2e` |
| **Full cycle** (`cycle/full-cycle.spec.ts`) | `playwright.cycle.config.ts` | Docker only. It builds its own throwaway stack. | see below |

The default config ignores `e2e/cycle/**`, so `pnpm --filter web e2e` never starts the cycle.

## Full cycle: one order, signup to payout

`e2e/cycle/full-cycle.spec.ts` is a single **serial** run (each step depends on the one before; the first
failure stops the run). Every step asserts against the real database, and where a UI exists it is driven
through the real UI.

| Step | What it proves |
| --- | --- |
| 0 | the app under test talks to the local stack, not a hosted project |
| 1a/1b | customer and vendor sign up through `/register` and `/vendor/register`; vendor applies for a store (pending) and lists a dish |
| 1c | a rider registers and uploads three KYC documents (the rider app's RPCs, via supabase-js) |
| 2a-2c | admin approves the vendor, the vendor signs in again and opens the kitchen, admin approves the rider's documents and the rider |
| 3a | cart: add is instant (cart writes are held back 3 s; the badge still updates inside 1.5 s), survives navigation and reload, only one open cart ever exists (vendor-switch confirm: dismiss keeps the cart, accept replaces it) |
| 3b | checkout creates a draft / pending-payment order and redirects to (mock) Monnify |
| 4a-4e | webhook: bad, missing or wrong-secret signature is a 401; a signed webhook that *claims* payment is ignored while Monnify says PENDING; a real payment marks the order paid, holds escrow and books a balanced ledger; replays do not double-credit; an under-payment is not placed, is credited to the wallet and shows under admin "Problems to review" |
| 5a-5c | vendor accepts, starts preparing and marks ready in the real UI; customer and vendor notifications are asserted |
| 5b/5c | two riders online, the nearer one (rider 2) is the ONLY one asked (one live offer; the other sees nothing and cannot accept); the vendor's order page says "Finding a rider: asking riders one at a time, nearest first." |
| 6a-6c | dispatch is sequential: the nearest rider declines (final) and the next is asked immediately; the next rider's offer lapses (15 s, set in 5b) and a new round asks them again; accept; tracking page shows the rider; picked up, on the way, arrived |
| 7a/7b | delivery code is readable only by the customer; wrong codes are rejected and 5 of them lock the rider out; admin resets the lockout in the UI; the right code releases escrow (vendor = subtotal minus commission, rider = `orders.rider_fee_kobo`, platform = residual); the whole order's ledger sums to zero; a retried verify does not release twice |
| 8a-8c | `/admin/payouts` lists the vendor and rider with the right naira amounts; payouts are recorded (partial, then remainder); a reused bank reference is rejected; an identical re-submit does not pay twice; balances reach zero; history and the audit log list every payout |
| 9a/9b | a vendor rejection unwinds escrow into the customer's wallet; an admin gateway refund unwinds escrow and sends a refund request to Monnify |

### Sequential dispatch: `cycle/yy-sequential-dispatch.spec.ts`

Follows `full-cycle.spec.ts` (alphabetical order, same store/customer/riders/superadmin, so run the whole cycle):

* the admin saves "Offer time (seconds)" in Settings > Rider matching (out-of-range value cannot be saved);
* an order being prepared is *scheduled*: no offers while two riders are online, `start_at` matches the stored basis,
  the vendor sees "Food expected ready at" / "Rider search starts around", admin lists it under "Search starts later";
  "Need more time?" +10 min moves both lines; "ready in 1 minute" starts the search while the order is still preparing,
  one rider (the nearest) is asked, accepts early, the food is ready, the delivery completes and the ledger releases;
* decline -> the next rider is asked immediately, `/admin/dispatch` shows "Waiting for <rider> to answer" with the new rider,
  the per-order history lists every rider asked with the outcome, a lapse starts a new round.

### What is real and what is stood in

Real: the Next.js app (production build), Supabase Auth, PostgREST, Storage, Realtime and Postgres with **all
migrations and `supabase/seed.sql` applied from scratch**, and the **`monnify-webhook` Edge Function** running in
the Supabase edge runtime with its real signature check and `capture_payment()` call.

Stood in:

* **Monnify's REST API** is `e2e/support/monnify-mock.mjs` (login, init-transaction, transaction lookup, refund).
  Both the Next.js server and the Edge Function point `MONNIFY_BASE_URL` at it. Webhooks are signed with
  `e2e/support/monnify-webhook.ts` (HMAC-SHA512 over the raw body) using a test secret that exists only on the
  local Edge Function.
* **The rider app** lives in another repository. Its RPCs (`register_rider`, `submit_rider_document`,
  `set_rider_online`, `update_rider_location`, `accept_dispatch_offer`, `transition_order`,
  `verify_delivery_and_release_escrow`, ...) are called with supabase-js as a signed-in rider.
* **The dispatch scheduler is real**: pg_cron's `dispatch-tick` (every 5 s, migration 0103) runs on this stack and
  advances lapsed offers and starts due searches by itself. The specs wait for it (`support/dispatch.ts`
  `advanceUntil`); only if it has not acted 20 s after the due time do they call `sweep_dispatch_offers()` once per poll as a
  stand-in and record a `cron-fallback` annotation. Offer rows are immutable, so nothing is back-dated: the offer time is
  shortened to 15 s with `admin_set_dispatch_setting` and the lapse is waited for. Orders a failed earlier run left in the
  kitchen would be offered to a new run's riders by that tick, so each spec first retires them (`retireStaleDispatchOrders`).
* **Side orders** for the failure paths (4e, 9a, 9b) are created over the API as the customer (cart ->
  `place_order`) plus the pending `payments` row the checkout writes; the UI path for an order is covered by the
  main order.
* The only bootstrap done with the service role is creating the superadmin (there is no signup path for a platform
  role by design), approving the second rider, and reading ground truth to assert on.
* Email confirmation is off in the local stack (`supabase/config.toml`, `[auth.email] enable_confirmations =
  false`), so signup returns a session. With confirmations on you would read the message from the stack's
  Inbucket/Mailpit (`E2E_INBUCKET_URL` is written to the env file).

### Run it

Requirements: Docker running, Node >= 20.9, pnpm, `pnpm install` done, Chromium installed for Playwright
(`pnpm --filter web exec playwright install chromium`). Free ports: 58320-58324 (Supabase), 3100 (app),
59080 (Monnify mock). The default stack dir is `<os tmp>/kiakia-e2e-stack`; override with `E2E_STACK_DIR`.

```bash
pnpm --filter web e2e:cycle:up     # copy supabase/ to a temp workdir, start an isolated stack, serve the Edge Function
pnpm --filter web e2e:cycle        # start the mock + `next build && next start`, run the spec
pnpm --filter web e2e:cycle:down   # supabase stop --no-backup on THAT stack only
```

The first `up` pulls the Supabase images (several minutes); later ones take ~1.5 minutes. `e2e:cycle` builds the
app (~1.5 minutes) before the spec starts, and the spec itself takes about five minutes.

The env file `e2e:cycle:up` writes (`cycle.env` in the stack dir) is read by `e2e:cycle`; its values are never
printed. Re-running `e2e:cycle` against the same stack is fine: every run uses a fresh run id for its users,
emails, phones and store name.

### Isolation and safety

* The stack gets its own project id (`kiakia-e2ecycle`) and its own ports (58xxx), so it cannot collide with a
  normal `supabase start` (project `kiakia`, ports 543xx). `stack.mjs` refuses the default project id and the
  usual local ports.
* Nothing is linked to a hosted project; `supabase link` / `db push` are never used. The `supabase/` directory is
  copied, so no `.temp` state is written into the repo.
* `apps/web/.env.local` is not read by the harness. The app is started with **explicit environment variables**
  (`playwright.cycle.config.ts`), and Next never overrides a variable that is already set, so the file cannot
  leak into any key set there. Every key that file defines is set (the two optional public ones, the Mapbox
  token and the VAPID key, to harmless dummies). Next still prints `Environments: .env.local` at startup; that is
  only it noticing the file.
* Hard guards: the config refuses any Supabase URL that is not loopback, and the spec also refuses the usual
  dev-stack ports (54321, 55321); step 0 logs in as a user that exists only in the throwaway database and checks the client
  bundle's inlined Supabase URL; browser requests to `*.supabase.co` are aborted.
* The app runs from its own dist dir (`NEXT_DIST_DIR=.next-e2e`, gitignored) on port 3100, so it neither collides
  with nor disturbs a developer's `next dev` on 3000.
* The e2e build sets `NEXT_E2E_SKIP_TYPECHECK=1` (Next's own type pass); `pnpm typecheck` is the type gate.

### Debugging

* `E2E_NEXT_MODE=dev pnpm --filter web e2e:cycle` uses `next dev` (slow: every route compiles on first visit).
* `E2E_REUSE_SERVERS=1` reuses an already running mock and app instead of starting them (start them yourself with
  the same env as `playwright.cycle.config.ts`).
* `pnpm --filter web exec playwright show-trace test-results/<dir>/trace.zip` after a failure.
* The Edge Function's log is `<stack dir>/functions.log`.

### Known app issue the run records

After a successful admin Server Action (approving a rider document, recording a payout) the form sometimes stays
disabled and `aria-busy` with no success message until the page is reloaded, even though the action ran. The spec
checks the database first, then records a `known-app-issue` annotation and a console line and reloads; it does not
hide it.
