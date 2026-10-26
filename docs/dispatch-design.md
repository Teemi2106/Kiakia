# Rider dispatch: sequential offers, H3 discovery, predictive timing

Status: design accepted, written before implementation (migrations 0099+).
Scope: replaces the simultaneous-offer rounds of 0083/0097/0098 with ONE dispatch
engine. Every dispatch entry point (ready trigger, the periodic tick, early
dispatch, admin re-dispatch, vendor "look further away", admin re-offer, a
rider's decline) goes through the same function.

All facts below were checked against the LATEST create-or-replace bodies
(0098 for the dispatch paths, accept, admin reassign, `_transition_order_core`;
0097 for `_dispatch_offer_batch`; 0096 for SMS and cron; 0083 for
`_quote_rider_fee` / `_rider_assign_blocker`; 0082 for decline, location and
online RPCs; 0065 for the push trigger) and against the live local schema.

## 1. What exists today (the starting point)

- `dispatch_offers(id, order_id, rider_id, status, offered_at, responded_at, expires_at)`,
  `UNIQUE (order_id, rider_id)`: one row per rider per order, re-opened by upsert
  (expired -> offered). Statuses: offered, accepted, expired, declined, revoked.
- `_dispatch_offer_round()` inserts offers for the nearest `dispatch_max_riders`
  (10) eligible riders AT ONCE (PostGIS `<->` KNN). First accept wins:
  `accept_dispatch_offer()` row-locks the order and requires `rider_id is null`.
- TTL: `_dispatch_offer_ttl()` = 60 s (0078). Expiry and the next round are
  driven by pg_cron `sweep_dispatch_offers` every 15 s; early dispatch by
  `dispatch_orders_nearing_prep_completion` every minute, starting at
  `accepted_at + avg_prep_mins - 8 min` (hard-coded lead).
- Early accept: an order still accepted/preparing can be claimed; status stays,
  `rider_id` is set; the ready trigger cascades to `rider_assigned`.
- One active order per rider (0083, enforced in accept under the rider row lock).
- Fee funding rule: rider fee = area base + per-km x ceil((rider->vendor +
  vendor->customer) km); skipped when it exceeds `_max_rider_fee_kobo()`.
- Push: AFTER INSERT trigger -> pg_net -> `dispatch-push` Edge Function (Expo).
  SMS fallback: `enqueue_rider_offer_sms()` every 15 s, one SMS per offer after
  12 s, via `message_outbox` + `message-worker`.
- 30 minute give-up auto-cancels a ready order nobody took (0067/0076).
- The rider app (separate repo `kiakia-rider`) reads `dispatch_offers` by
  `rider_id` + `status = 'offered'` (realtime + polling), shows a countdown from
  `expires_at - offered_at`, calls `accept_dispatch_offer(p_order_id)` /
  `decline_dispatch_offer(p_order_id)` / `get_rider_offer_details(p_order_id)`,
  and maps errors by message substring (`already assigned or not ready for
  pickup`, `offer has expired`, `no active offer for this rider`, `is too far
  from this rider`, `must be online with a location update`). Push data shape
  `{type: 'dispatch_offer', orderId}`.
- Hosted/locally available extensions (image `supabase/postgres:17.6.1.147`):
  postgis 3.3.7, pg_cron 1.6.4, pg_net 0.20.4, pgrouting, pg_tle. NO `h3`
  extension and no plv8. The local image is the hosted image, so hosted has no
  h3 either.
- Routing: Mapbox is used only in the browser (`NEXT_PUBLIC_MAPBOX_TOKEN`,
  Directions for drawing routes). There is no server-side routing/Matrix call
  and no server token.

## 2. Conflicts between the specification and the current system, resolved

| # | Conflict | Decision |
|---|----------|----------|
| C1 | Simultaneous rounds to 10 riders vs one offer at a time | Sequential. At most ONE live offer per order, enforced by a partial unique index. `_dispatch_offer_round` / `_dispatch_offer_batch` keep their names as thin wrappers over the new engine so nothing that calls them breaks. |
| C2 | TTL 60 s (0078) vs configurable 45 s | New setting `dispatch_offer_timeout_seconds`, default 45, range 15-120. `_dispatch_offer_ttl()` reads it. |
| C3 | `dispatch_max_riders` = riders per simultaneous round | Same key, new meaning: riders asked ONE AT A TIME in one search round (cycle) before the round restarts. Default 10. Label "Riders asked one at a time per round". |
| C4 | Offer rows re-opened by upsert (`UNIQUE(order_id, rider_id)`) vs unique offer id, attempt and generation per offer | One row per offer, never re-opened. Drop the pair unique; add `cycle_no`, `attempt_no` with `UNIQUE (order_id, cycle_no, attempt_no)` (idempotency key: a duplicate job cannot issue the same offer twice). The 0076 "re-opened" push trigger is dropped (nothing re-opens). |
| C5 | Offer states pending/accepted/declined/expired/cancelled/superseded vs existing set incl. `revoked` | Keep the existing names readers know: `offered` (= pending), `accepted`, `declined`, `expired`, `revoked` (an operator took an ACCEPTED order off the rider, 0083, unchanged). Add `superseded` (the order was claimed by someone else or the offer was replaced by an operator re-dispatch) and `cancelled` (the offer was invalidated: rider went offline/ineligible, order cancelled, vendor self-delivery, order left dispatch). `close_reason` text gives the detail. A BEFORE UPDATE trigger enforces the transition table; terminal states never change. Vendor self-delivery now writes `cancelled` (was `revoked`): deliberate, tests updated. |
| C6 | "exclude riders who declined in the current cycle" vs today's "declined never re-offered" | Keep the stricter existing rule: a rider who declined or was revoked is never offered that order again. A rider whose offer expired, was cancelled or superseded is not asked again in the same cycle; a new cycle may ask them again (intentional retry policy). |
| C7 | SMS per offer, push per offer | Unchanged in shape: still one SMS per offer, now to the single rider who holds the live offer (12 s delay, needs >= 10 s left, hourly cap 6). Push moves to the outbox (D9). |
| C8 | Vendor "No rider nearby" thresholds | Same rule, now computed from the engine's outcome: the search has expanded to its full allowed range, found zero available riders, the order has waited `dispatch_notify_vendor_after_seconds`, and no live offer exists. Once per order (unchanged). |
| C9 | Fee funding rule | Applied per candidate at discovery (unfundable riders are skipped, counted in the funnel as today) and re-checked inside accept. |
| C10 | Early dispatch lead `avg_prep_mins - 8` | Replaced by the predictive start time (D8). The early-accept mechanics are unchanged. |
| C11 | 30 minute give-up | Kept unchanged (it is an existing order workflow with an automatic refund). Before it, the order enters an explicit `needs_attention` state that alerts operations (D11), while dispatch keeps retrying. |
| C12 | Existing pgTAP suites and the e2e cycle assume simultaneous offers | Updated deliberately, assertion by assertion, to the sequential contract (e.g. "10 riders get offers" becomes "the nearest gets the offer; after decline the next one does"). No assertion is deleted without a replacement that tests the new behaviour. |
| C13 | H3 vs no h3 extension on hosted | D6: H3 implemented in plpgsql, verified against h3-js. |
| C14 | "Rank by road travel time where routing data is available" vs no server routing | D7: calibrated travel-time model in one SQL function (the seam for a future Matrix provider). Distance is an input, not the sole measure. Reported as a limitation. |
| C15 | Distinct readiness/arrival timestamps vs existing lifecycle | No new order statuses. New timestamps live in `order_dispatch` (D3); `orders` keeps its status machine. |

## 3. Decisions

### D1. One engine
`_dispatch_advance(p_order_id uuid, p_trigger text) returns jsonb`: the only code
that closes a stale offer and creates the next one. Callers: the ready trigger,
`dispatch_tick()` (the periodic worker), decline, admin re-dispatch / re-offer,
vendor expand. It requires the caller to hold the order row lock (`FOR UPDATE`).
Steps:
1. Re-validate the order: rider delivery, `rider_id is null`, status in
   (accepted, preparing, ready_for_pickup), paid, dispatch window open
   (`ready_for_pickup`, or `now() >= order_dispatch.start_at`).
   Otherwise close any live offer (`cancelled`/`superseded`) and stop.
2. If a live offer exists: keep it if unexpired and its rider is still eligible
   (online, fresh ping, active profile, no other active order); else close it
   (`expired` or `cancelled`, reason recorded).
3. Pick the next candidate (D6/D7) and insert ONE offer
   (`attempt_no = order_dispatch.attempt_no + 1`).
4. No candidate: expand the ring (D6) and retry within the same call; when fully
   expanded: if this cycle asked anyone, start a new cycle; else record the
   funnel (`dispatch_attempts`), notify the vendor (C8), raise `needs_attention`
   when due (D11), and schedule a retry.
5. Set `order_dispatch.next_check_at` (offer expiry, predicted start, or retry
   time with backoff) and write `dispatch_events`.

### D2. Invariants enforced by the database
- `orders` row lock (`FOR UPDATE`) is the serialisation point for every
  assignment path (accept, admin assign/unassign, advance, self-delivery,
  cancellation). Lock order everywhere: orders -> riders -> order_dispatch ->
  dispatch_offers.
- `UNIQUE (order_id) WHERE status = 'offered'`: at most one live offer per order.
- `UNIQUE (order_id) WHERE status = 'accepted'`: at most one accepted offer per order.
- `UNIQUE (order_id, cycle_no, attempt_no)`: a duplicate worker/job cannot issue the same offer twice.
- Transition trigger on `dispatch_offers`: allowed `offered -> accepted|declined|expired|superseded|cancelled`, `accepted -> revoked`; nothing else; immutable `order_id, rider_id, offered_at, expires_at, cycle_no, attempt_no`; `responded_at` stamped with `now()`.
- Accept requires, inside the transaction: order eligible and unassigned; the
  caller's own live offer (`auth.uid()`, never a parameter) on that order;
  `expires_at > now()`; rider KYC-approved, active, online, ping fresh, no other
  active order (rider row locked); fee fundable. Losers receive a deterministic
  error/outcome and change nothing.
- `orders.rider_id` and the accepted offer cannot diverge: both are written in
  the same statement group under the order lock; a consistency check is part of
  the test-harness invariants.

### D3. `order_dispatch` (1:1 with orders, created at vendor accept)
Holds dispatch state so that frequent engine writes do not rewrite `orders`
(which wakes every realtime subscriber on the order). Columns (indicative):
`order_id pk`, `state` (`scheduled | searching | offered | assigned |
needs_attention | stopped`), `cycle_no`, `attempt_no` (the generation),
`ring`, `next_check_at`, `expected_ready_at`, `start_at` (predicted dispatch
start), `start_basis jsonb` (travel estimate, buffer, inputs), `dispatch_started_at`,
`assigned_at`, `assigned_eta_at`, `current_eta_at`, `rider_arrived_vendor_at`,
`needs_attention_since`, `attention_reason`, `error_count`, `last_error`.
`orders.first_dispatched_at` / `dispatch_cycle_started_at` keep being written
for existing readers. Service-role only; read through RPCs.

### D4. Worker and timeout (no held requests, no sleeping workers)
- `expires_at = now() + dispatch_offer_timeout_seconds` (server clock).
- `order_dispatch.next_check_at = expires_at` (or predicted start / retry time).
- pg_cron job `dispatch-tick` every 5 seconds runs `dispatch_tick()`: claims due
  rows (`next_check_at <= now()`) joined to their order with `FOR UPDATE SKIP
  LOCKED` (two workers never advance the same order), bounded batch, each order
  processed in its own subtransaction (preferably a procedure committing per
  order, to keep lock hold times short). A stale/delayed job is harmless:
  every decision re-reads the committed offer, its expiry, the order state and
  the generation under the lock.
- Failures: `error_count`+1, `next_check_at = now() + least(5 s * 2^n, 300 s)`,
  after 5 consecutive failures `needs_attention` + alert event.
- Recovery: anything left in an intermediate state (live offer past expiry,
  order dispatchable with no `order_dispatch` row or a null `next_check_at`) is
  picked up by the tick's catch-all predicate; the migration backfills rows for
  in-flight orders.
- Decline advances inline (same transaction): no 45 s wait.
- Accept after expiry is refused by the accept itself even if the tick has not
  yet run. Worst-case delay before the next rider is asked after an
  unanswered offer: ~5 s.
- `sweep_dispatch_offers()` and `dispatch_orders_nearing_prep_completion()` keep
  their names/signatures (callable by service role) as wrappers over the tick;
  `_ensure_scheduled_jobs()` schedules `dispatch-tick` and unschedules the two
  old jobs.

### D5. Rider-facing RPCs (backward compatible)
- `accept_dispatch_offer(p_order_id) returns orders`, `decline_dispatch_offer(p_order_id) returns dispatch_offers`,
  `get_rider_offer_details(p_order_id)`, `set_rider_online`, `update_rider_location`,
  `register_rider`, `verify_delivery_and_release_escrow`, `register_rider_push_token`,
  `rider_notifications`: same names, arguments and return shapes; existing error
  substrings preserved.
- Idempotency: accept by the rider who already holds the order returns the order
  row (was an error); repeated decline returns the closed offer row.
- New: `get_dispatch_offer(p_offer_id) returns jsonb` (authoritative state of the
  caller's own offer: status, seconds_left from server time, still_actionable,
  permitted order details) for opening a push; `respond_to_dispatch_offer(p_offer_id, p_action)`
  returning a deterministic outcome (`accepted | already_yours | declined |
  expired | taken | withdrawn | not_found`) without raising for normal races.
  The legacy RPCs are implemented on the same core.
- Rate limit on offer responses (per rider, e.g. 30 per minute), SQLSTATE
  P0429 `rate_limited:` like 0098.

### D6. H3 candidate discovery
- Implementation: a plpgsql port of H3 v4 `latLngToCell`, `cellToParent`,
  `gridDisk` (with pentagon-safe fallback) and validity helpers, in its own
  migration, with the reference lookup tables (Apache-2.0, attributed).
  Verified against `h3-js` on thousands of generated vectors (global + Nigeria,
  resolutions 0-15 for cells, k 0-10 for disks); 100% match required.
- Storage: `riders.h3_cell bigint` at resolution 9, maintained by a BEFORE
  INSERT/UPDATE trigger only when `current_location` actually changes
  (`IS DISTINCT FROM`), so pings that do not move a rider do no extra work and
  the rider app is unchanged. Original coordinates stay in `current_location`
  for distance, fee and ETA. Invalid/missing coordinates -> null cell (rider is
  not discoverable by H3; still bounded by the precise filters).
- Search: vendor cell at the configured resolution `r` (7-9, default 8); disk
  `gridDisk(vendor_cell, k)`; each disk cell maps to the contiguous index range
  of its resolution-9 descendants, so one btree index on `riders.h3_cell`
  serves every resolution (range scans, no per-resolution columns).
- Expansion: `k` starts at `dispatch_h3_initial_ring` (default 1) and grows by
  one while the rings hold no untried eligible candidate, up to
  `dispatch_h3_max_ring` (default 8). Then a final `beyond_rings` stage uses the
  existing PostGIS KNN within the radius cap (or uncapped when
  `dispatch_radius_m = 0`), so no rider the live system would find today is lost.
- Precise filters after discovery: `st_dwithin` against the radius in use
  (base, or the store's own radius once widened, 0098), ping freshness,
  online, KYC, active profile, no other active order, fee fundable, not
  excluded (C6). H3 is discovery only; it never replaces these checks or the
  travel-time ranking.
- Benchmark: synthetic 5k / 20k / 50k riders, H3 discovery vs the GiST KNN
  query, reported honestly (expected: negligible at today's ~1 rider; the value
  is bounded work per dispatch at scale).

### D7. Travel time (ranking and prediction)
`_estimate_travel_seconds(from geography, to geography, service_area_id)`:
straight-line metres x `dispatch_road_factor_pct`/100 / speed + fixed overhead.
Speed = per-service-area median observed speed (pickup distance / (arrived at
vendor - assigned)) over the last 30 days when at least
`dispatch_min_history_samples` observations exist, clamped to 8-40 km/h;
otherwise `dispatch_default_speed_kmh` (default 18). Candidates are ranked by
this ETA (ties: distance). It is the single seam where a road-routing provider
(e.g. a Mapbox Matrix call from a worker, cached) can be added later; not done
now: no server token exists, the call would cost money per dispatch and tests
may not call external APIs.

Note (0108): the SQL scan ranks by `(distance, uid)`, which equals ranking by ETA only
because `_estimate_travel_seconds` is monotonic in distance for a fixed vendor/area. If a
routing provider is ever added at this seam, `_dispatch_scan` must rank by ETA instead.

### D8. Predictive dispatch timing
- At vendor accept: `expected_ready_at = accepted_at + avg_prep_mins` (vendor's
  estimate); the vendor can revise it (`vendor_update_prep_estimate(order, minutes)`).
- `start_at = expected_ready_at - travel_estimate - secure_buffer`, never before
  `accepted_at`, where
  - `travel_estimate` = ETA of the best currently eligible candidates (median
    of the top 3, or the top one if fewer), recomputed on each tick while the
    order is `scheduled`; with no candidates, `dispatch_default_travel_seconds`.
  - `secure_buffer` = expected time to secure a rider from history (last 14
    days, same service area): `(1/acceptance_rate - 1) x mean_time_of_a_failed_offer
    + mean_time_to_accept`, used when at least `dispatch_min_history_samples`
    offers exist; otherwise `dispatch_secure_buffer_seconds` (default 150 =
    about three sequential 45 s offers plus slack). Clamped to [45 s, 15 min].
    Never a single 45 s timeout.
- `ready_for_pickup` starts dispatch immediately whatever `start_at` says
  (never wait for a prediction once food is ready).
- Recalculated when the prep estimate changes, on each tick while scheduled
  (rider availability), and the basis is stored in `start_basis` (observable).
- Prep delayed after a rider accepted: the rider is told the new ready time
  (rider_notifications + push). Prep finished early: the rider is told the food
  is ready. Overrun with no vendor update: `expected_ready_at` slides, recorded
  as an event, no rider spam.
- Rider ETA after assignment: recomputed from location pings (throttled, only
  for riders holding a pre-pickup order); a material increase is recorded and
  shown to admin/vendor; never auto-reassigned.
- Rider arrived at restaurant: first ping within `dispatch_vendor_arrival_radius_m`
  (default 100 m) of the vendor before pickup stamps `rider_arrived_vendor_at`.
  Metrics record arrival minus ready (rider idle or food waiting) to feed D7/D8.
- No customer-facing promise changes.

Timestamps map onto the lifecycle without new statuses: vendor accepted
(`orders.accepted_at`), preparation started (`orders` preparing transition,
event), expected ready (`order_dispatch.expected_ready_at`), dispatch initiated
(`dispatch_started_at`), rider assigned (`order_dispatch.assigned_at`; `orders.assigned_at` keeps its meaning),
rider approaching (assigned, `current_eta_at`), food ready (`orders.ready_at`),
rider at restaurant (`rider_arrived_vendor_at`), collected (`orders.picked_up_at`),
delivered (`orders.delivered_at`).

### D9. Notifications: transactional outbox
- Offer push goes through `message_outbox` (new channel `push`, kind
  `rider_offer`, dedupe `offer:<id>:push`, `expires_at` = offer expiry): written
  in the same transaction as the offer, so committed state and notification
  cannot diverge; `message-worker` sends it to Expo with the existing
  claim/retry/backoff/max-attempts machinery (Expo code moved to
  `functions/_shared`). Payload adds `offerId` to the existing
  `{type: 'dispatch_offer', orderId}`.
- When a live offer the rider was told about is superseded/cancelled, a
  "no longer available" push is queued; a pending offer push for a closed offer
  is suppressed (expired).
- The offer row itself (realtime + polling in the rider app) stays the
  authoritative channel; pushes are delivery hints. Duplicate / late /
  out-of-order pushes are harmless because the app re-reads state
  (`get_dispatch_offer`).
- `dispatch-push` stays deployed for rollback but is no longer called.
- No customer name/phone/address before accept (0072 rules unchanged).

### D10. Settings (`platform_settings`, admin-editable, audited)
| key | default | range | admin label |
|---|---|---|---|
| dispatch_offer_timeout_seconds | 45 | 15-120 | Offer time (seconds) |
| dispatch_max_riders | 10 | 1-50 | Riders asked one at a time per round |
| dispatch_radius_m | 0 | 0, 1000-50000 | First search distance (0 = no limit) |
| dispatch_widen_after_seconds | 60 | 0-1800 | Search further after (seconds) |
| dispatch_location_max_age_seconds | 300 | 60-300 | Rider location must be newer than |
| dispatch_notify_vendor_after_seconds | 45 | 0-1800 | Tell the store no rider is near after |
| dispatch_h3_resolution | 8 | 7-9 | Search area size (map grid level) |
| dispatch_h3_initial_ring | 1 | 0-10 | First search rings |
| dispatch_h3_max_ring | 8 | 1-30 | Furthest search rings (>= first) |
| dispatch_secure_buffer_seconds | 150 | 45-900 | Time allowed to find a rider |
| dispatch_default_travel_seconds | 600 | 60-3600 | Rider travel time when unknown |
| dispatch_default_speed_kmh | 18 | 5-60 | Rider average speed |
| dispatch_road_factor_pct | 135 | 100-250 | Road distance vs straight line (%) |
| dispatch_min_history_samples | 20 | 5-1000 | Deliveries needed before learning |
| dispatch_vendor_arrival_radius_m | 100 | 30-500 | Rider counts as at the store within |

### D11. Observability and operations
- `dispatch_events` (append-only): `at, order_id, cycle_no, attempt_no, offer_id,
  rider_id, event, data jsonb`; correlation = order_id + cycle_no + attempt_no.
  Events: scheduled, start_recomputed, cycle_started, ring_expanded,
  offer_created, offer_accepted, offer_declined, offer_expired,
  offer_cancelled, offer_superseded, accept_conflict, stale_accept_rejected,
  no_candidates, needs_attention, tick_error, prep_estimate_changed,
  ready_early, prep_overrun, eta_increased, rider_at_vendor, push_failed.
  No personal data beyond ids. 90-day retention via cron.
- `needs_attention` when: full expansion found nobody for
  `dispatch_notify_vendor_after_seconds`, or two full cycles produced no
  accept, or 5 consecutive tick errors. Shown on /admin/dispatch and the admin
  overview tile.
- `admin_dispatch_metrics(p_since)`: offers, accept/decline/expiry rates,
  vendor-accept-to-assignment time, candidates evaluated, ring expansion
  frequency, conflicts / stale accepts, tick delay and failures, orders
  needing attention, ready-vs-arrival gap.
- `admin_dispatch_status()` gains state, live offer (rider, seconds left),
  start time, expected ready, ETA and new reasons:
  `scheduled, waiting_for_rider_reply, no_online_riders, none_in_range,
  fee_exceeds_order_budget, all_declined_or_expired, needs_attention`.
  `admin_dispatch_order_history(p_order_id)`: every offer (rider, attempt,
  cycle, ring, ETA, outcome, offered/responded times) and key events.
- `admin_redispatch_order` / `admin_reassign_order_rider` use the same lock
  order, constraints and engine; a forced assignment inserts a new `accepted`
  offer row and supersedes the live one.

### D12. Assignment policy (unchanged rules)
One active order per rider (0083). Offline, stale-ping, unapproved, suspended,
busy riders are never offered and are invalidated if they become so while
holding a live offer (checked by the tick and on accept). An assigned order is
never automatically reassigned by a timeout, tick or duplicate event; only an
admin can take a rider off.

## 4. Migration and rollout
1. 0099 H3 library (pure functions + tests).
2. 0100 schema + constraints: close extra live offers as `superseded` BEFORE
   creating the partial unique indexes; drop the pair unique; offer columns,
   transition trigger, `order_dispatch` + backfill, `dispatch_events`,
   `riders.h3_cell` + trigger + backfill, settings keys.
3. 0101 engine: candidate discovery (H3 + precise filters + ETA ranking),
   `_dispatch_advance`, wrappers for the old entry points, ready trigger.
4. 0102 rider/admin/vendor RPCs: accept/decline (idempotent, rate-limited),
   `get_dispatch_offer`, `respond_to_dispatch_offer`, admin status/history/
   redispatch/reassign, vendor view/expand/self-delivery updates, settings RPC.
5. 0103 worker + outbox + cron: `dispatch_tick`, backoff/needs_attention,
   push via `message_outbox`, SMS adjustments, `_ensure_scheduled_jobs`.
6. 0104 predictive timing, prep/ETA/arrival handling, metrics.
Hosted deployment (owner, after review): follow the runbook in section 6 (Edge Functions FIRST, then the
migrations 0099-0109, then the Vault secrets check and `select _ensure_scheduled_jobs();` as postgres, then
regenerate types). The rider app keeps working unchanged; using `get_dispatch_offer` / `offerId` is an optional
rider-app follow-up.

## 5. Assumptions and open product questions
- Declined riders are never re-offered the same order (existing rule kept).
- `avg_prep_mins` is the vendor's preparation estimate; the vendor may revise
  per order. No customer ETA is changed.
- Travel time is a calibrated estimate, not road routing (D7).
- Open: should a server-side routing provider be bought (Mapbox Matrix cost per
  dispatch)? Should declined riders get a second chance after a long wait?

## 6. Deploy runbook (hosted), rollback, pre-deploy checklist

### Pre-deploy checklist (owner)
1. **Backup**: take a fresh backup / note the PITR timestamp. 0100 rewrites offer statuses and drops a unique constraint; there is no down migration.
2. **`supabase migration list` against the hosted project must show it at exactly 0097 or 0098** (0098 is untracked in git in this
   tree: if hosted is at 0097, 0098 simply applies first). Any other state (a number above 0098, a gap) means the hosted schema has
   drifted from what 0099-0109 were written and tested against: stop and reconcile first.
3. **Quiet window.** Apply when few orders are in flight. Reason: the 0100 backfill adopts every in-flight rider-delivery order as
   state `searching` with `next_check_at = now()` and NO `start_at`, so as soon as the tick exists (0103 calls `_ensure_scheduled_jobs()`
   itself) every accepted/preparing order with no rider is due immediately and is offered to a rider at once, ignoring the predictive
   start. 0109 adds `_dispatch_reschedule_unstarted()`, run once at the end of the migration, which recomputes `start_at` for exactly
   those orders (state `searching`, no offer ever made, dispatch not started) and returns them to `scheduled`. So the exposure is no
   longer "until each order is ready" but only the seconds-to-minutes between 0103 and 0109 inside the same `db push`; an order the
   tick offered in that window simply keeps its (early) offer. This is why the window is still recommended, not required. (Chosen
   over editing 0100: 0100-0108 are already applied to local and e2e databases and must not change.) ready_for_pickup orders are
   unaffected by design (dispatch starts at once).
4. Confirm the Vault secrets exist (names only): `select name from vault.secrets where name in ('message_worker_function_url','message_worker_secret');`
   must return both rows. Without them pushes stay queued; `admin_dispatch_health()` reports it.
5. Confirm pg_cron is enabled and accepts `5 seconds` (1.5+; the hosted image ships 1.6).

### Order of operations (this order matters)
1. **Deploy the Edge Functions first**: `supabase functions deploy message-worker` and `supabase functions deploy dispatch-push` (both
   bundle `_shared/expo.ts`). The new worker is backward compatible with the old schema (it only treats channel `push` differently).
   **Do this BEFORE applying 0103.** 0103 queues every offer push in `message_outbox` with a null `to_address` (tokens are read at send
   time). The OLD `message-worker` suppresses any row without `to_address` as `no_address`, a terminal status, so offer pushes queued
   before the new worker is live are permanently lost (the rider is only reached by the SMS fallback). The earlier text of this
   document said "apply 0103; deploy message-worker" which had this backwards.
2. **Apply the migrations**, `supabase db push` (0099 through 0109 in one run). Lock behaviour: 0099-0108 were not
   lock-profiled on a production-sized database (0100 alters `dispatch_offers` constraints/columns and backfills in one
   transaction, so expect brief exclusive locks on that table and on `order_dispatch`/`riders`; tables are small today, so run it in the
   quiet window); 0109 adds one column with a constant default (metadata only), a NOT VALID + VALIDATE check constraint (writers keep
   working), and CREATE OR REPLACE for the rest.
3. Confirm the Vault secrets (checklist item 4), then `select _ensure_scheduled_jobs();` as postgres (idempotent; 0103 already ran it
   once). It schedules `dispatch-tick` (5 s), the two purges, and unschedules the two old dispatch jobs.
4. Call `admin_dispatch_health()` (service role): `healthy` must be true within about 30 s, `problems` empty.
5. Regenerate `packages/db/src/generated.ts` (it is hand-maintained today).

### Rollback: forward-fix only
There is no safe automatic rollback. Reasons: 0100 closes surplus live offers as `superseded`, drops `UNIQUE (order_id, rider_id)`, rewrites the
status set and adds columns that live offers now depend on; 0101-0108 replace function bodies whose old versions still exist only in
migrations 0083/0097/0098 and would not understand the new rows. Restoring the old behaviour means restoring the backup, which loses
every order and payment written since. So: **fix forward with a new migration (0110+)**. Stop-gaps that need no migration, in order of
preference: fix the cause and let the tick catch up (it is idempotent, every decision re-reads committed state); pause the tick with
`select cron.alter_job(jobid, active := false) from cron.job where jobname = 'dispatch-tick'` (no new offers and no 30-minute give-up
while paused; assign by hand with `admin_reassign_order_rider` or let vendors deliver themselves); push rollback only for the
notification path as described in the Sprint 1e entry (re-create `dispatch_offers_notify_rider`, which needs the old Vault secrets).

### 0109 operational notes
- `admin_dispatch_health()` is the dead-tick alarm: it reports a missing/paused `dispatch-tick` job, a last success older than 30 s,
  orders overdue by more than 60 s and missing worker secrets in plain words. It is read-only and does not raise when pg_cron or vault
  are missing (they are reached through dynamic SQL behind `to_regclass`). It needs a UI/alert hook; nothing polls it yet.
- A new event `dispatch_busy` (and `start_calc_failed`) appears in `dispatch_events`; `_dispatch_advance` can now return outcome
  `busy` (callers that only test for `offered`/`no_candidates` are unaffected; `busy` is never counted as "no riders nearby", needs_attention
  or the 30-minute give-up).
- `sweep_dispatch_offers()` and `dispatch_orders_nearing_prep_completion()` now process at most 10 orders per call (one transaction
  holds every lock). They are for tests and manual use. Never schedule them; `dispatch_tick()` commits after every order (checked in
  `pg_proc`: a procedure whose loop does `perform _dispatch_tick_order(...); commit;`).

## 7. Current test results (re-run 2026-10-26, migrations 0001-0109 on admintest, 0001-0109 replayed on the isolated e2e stack)

**pgTAP**: every `supabase/tests/*.sql` run with `psql -f` inside the container in its own rolled-back transaction, no `ERROR` line in any file.
CI runs the same set with an explicit file list (`supabase test db $(ls supabase/tests/*.sql)`), so the non-pgTAP files in `h3/` and
`concurrency/` are never picked up.

| file | ok | not ok |
|---|---|---|
| accept_dispatch_offer | 8 | 0 |
| admin_authorization_and_audit_log | 124 | 0 |
| admin_directory_and_payables | 28 | 0 |
| admin_dispatch_override | 103 | 1 (known) |
| admin_exports | 75 | 0 |
| admin_money_summary | 36 | 0 |
| admin_operations | 164 | 7 (known) |
| admin_read_scalability | 37 | 0 |
| admin_security_fixes | 95 | 0 |
| capture_payment | 16 | 0 |
| customer_bootstrap | 23 | 0 |
| customer_events | 74 | 0 |
| customer_wallet | 23 | 0 |
| dispatch_engine | 131 | 0 |
| dispatch_metrics | 48 | 0 |
| dispatch_predictive | 119 | 0 |
| dispatch_review_fixes | 111 | 0 |
| dispatch_rider_lock | 14 | 0 |
| dispatch_rpcs | 180 | 0 |
| dispatch_settings | 157 | 0 |
| dispatch_worker | 104 | 0 |
| h3_core | 233 | 0 |
| messaging | 219 | 0 |
| place_order | 7 | 0 |
| platform_fees | 46 | 0 |
| qa_dispatch_privacy_regressions | 8 | 0 |
| refund_and_escrow_unwind | 17 | 0 |
| register_vendor | 5 | 0 |
| require_escrow_release_before_delivered | 6 | 0 |
| rider_kyc_and_notifications | 19 | 0 |
| rls_carts_addresses_menu | 10 | 0 |
| rls_orders | 4 | 0 |
| scheduled_jobs_and_write_latency | 20 | 0 |
| suspended_caller_guard | 56 | 0 |
| suspension_guard_gaps | 17 | 0 |
| transition_order | 9 | 0 |
| vendor_location_and_rider_reads | 16 | 0 |
| vendor_notifications | 12 | 0 |
| vendor_self_delivery | 65 | 0 |
| verify_delivery_and_release_escrow | 16 | 0 |

Totals: 2455 ok / 8 not ok over 40 files (39 existing files plus the new dispatch_review_fixes, 111 ok / 0 not ok).

Known pre-existing failures (8, all stale local audit rows in the shared local database, unrelated to dispatch changes, unchanged by
0109): `admin_operations` #1, #3, #19, #44, #54, #165, #171 (7) and `admin_dispatch_override` #26 (1). Every other file is green.

**Concurrency harness** (`supabase/tests/concurrency`, isolated e2e stack, db :58322, full scale): 21/21 scenarios PASS, 704 iterations, 0 failed checks, 0 invariant failures (16 hard invariants after every iteration), 140.8 s total. Per scenario (iterations, time): 1 (60, 5.2s), 1.1 (30, 3.0s), 1.2 (40, 3.1s), 2 (40, 3.4s), 3 (24, 48.1s), 4 (40, 4.1s), 4.1 (6, 16.9s), 5 (40, 3.6s), 6 (60, 4.7s), 7 (40, 4.1s), 8 (12, 4.9s), 8.1 (40, 2.8s), 9 (50, 4.5s), 9.1 (20, 1.4s), 10 (48, 5.2s), 11 (48, 5.3s), 12 (48, 4.1s), 13 (10, 4.4s), 14 (24, 2.8s), 15 (12, 5.4s), 16 (12, 3.6s). Honest run history of this session: run 1 (0109 first applied) 20/21: scenario 8 FAILED because 0109 lowered the sweep wrapper batch to 10, so two sweeps could not finish 16 due orders (180/192 orders had exactly one new offer); the scenario now drains with further sweeps (test change only, no backend change). Run 2: 20/21, scenario 1 FAILED in 7 of 60 iterations (all n = 10 riders: the engine offered the SECOND-nearest rider with candidates_evaluated 1, i.e. the nearest rider was not in the scan result at that moment) during a visibly stalled run (scenario 1 took 55 s instead of 5 s); the cause was NOT identified and it did not reproduce in 6 further isolated runs of scenario 1 nor in the next full run (run 3, the numbers above). Treat it as an open observation: if it ever recurs, capture the rider rows (is_online, last_ping_at, h3_cell, locks) of the failing iteration.

**Edge Function unit tests**: `node --experimental-strip-types --test "supabase/functions/_shared/*.test.ts"`: 28 tests, 28 pass, 0 fail (expo 12, messaging 16).
`supabase/functions/monnify-webhook/monnify.test.ts` is a Deno test and is not run by node.

## Progress log

The pgTAP and harness counts quoted in the sprint entries below are SNAPSHOTS taken at the time and several do not match the
files on disk (for example dispatch_engine is 131 tests, not 134 or 147, and dispatch_rider_lock is 14, not 18). The only current,
re-run numbers are in section 7 ("Current test results"); do not quote the per-sprint tables.
- 2026-10-24 Sprint 0: design accepted by the owner. Open questions decided:
  declined riders are never re-offered the same order; no paid routing provider,
  keep the calibrated travel-time model (D7) with its seam.
- 2026-10-25 Sprint 1a (H3 library): earlier attempts were cut off by a usage
  limit and a stall. Left in the tree: `supabase/tests/h3/` (h3-js 4.5.0 dev
  tooling, generate-vectors.mjs) and `supabase/tests/h3_core.sql` (generated,
  not yet verified). No 0099 migration file yet. Resuming from those artifacts.
- 2026-10-25 Sprint 1a step 1 (H3 core): `supabase/migrations/0099_h3_core.sql`
  applied locally (plpgsql port of H3 v4.5.0: `h3_latlng_to_cell`, `h3_get_resolution`,
  `h3_is_valid_cell`, `h3_is_pentagon`, `h3_cell_to_parent`,
  `h3_cell_to_descendant_range`; IMMUTABLE STRICT PARALLEL SAFE, service_role only;
  neighbour/transition tables for gridDisk already present, gridDisk itself is
  step 2). Generated by `supabase/tests/h3/build-migration.mjs` from
  `migration.template.sql` + `tables.json` (extracted from the C sources by
  `gen-tables.mjs`). Verified against h3-js 4.5.0 with `verify-core.mjs`:
  24,543 latLngToCell vectors (global, Ibadan box, poles, antimeridian, base-cell
  centres incl. pentagons, cell centres, near-vertex, res 0-15) 0 mismatches;
  5,000 knife-edge vectors (points within ~1 ulp of a cell vertex) 89 differ from
  h3-js but all 89 land in a cell sharing that vertex (0 outside the tie set),
  an inherent libm last-bit effect; 4,180 cellToParent, 6,006 validity/pentagon/
  resolution, 2,134 descendant ranges (lo/hi vs h3-js) all 0 mismatches; 8,262
  sampled res-9 descendants all inside the range, 8,115 neighbour descendants all
  outside. Cost about 50 us per `h3_latlng_to_cell` call at res 9.
- 2026-10-25 Sprint 1a step 2 (gridDisk): `h3_grid_disk(p_origin bigint, p_k integer)
  returns bigint[]` added to `0099_h3_core.sql` (template + regenerated; 0099 is
  still local-only, so no new migration number was used) and installed locally with
  create-or-replace, no replay. IMMUTABLE STRICT PARALLEL SAFE, service_role only.
  NULL for an invalid origin, k < 0, or k > 50 (documented cap). Port of
  `h3NeighborRotations` (`_h3_neighbor_rotations`), the fast ring spiral
  (`gridDiskUnsafe`) and, once a pentagon or pentagon-distortion error is met
  anywhere, a ring-by-ring BFS over the neighbours (`gridDiskDistancesSafe`).
  Verified against h3-js gridDisk as sets with `supabase/tests/h3/verify-disk.mjs`:
  10,784 vectors, 0 mismatches (Ibadan res 7/8/9 k 0-10: 1,320; Ibadan k 11-30: 20;
  global: 600; polar: 300; all 12 pentagons at 10 resolutions k 0-10: 1,320;
  pentagon neighbours k 1/2/3/6: 7,200; pentagon k 15/30: 24). `supabase/tests/h3_core.sql`
  replaced by a generated 209-test pgTAP file (`gen-pgtap.mjs`, 136 KB, 244 lines),
  all ok. Cost: about 0.2 ms (k=1), 1.7 ms (k=4), 6.0 ms (k=8) per call; discovery
  prep (disk k=8 at res 8 plus descendant range at res 9 for all 217 cells) about
  7.2 ms.
- 2026-10-25 Sprint 1b (0100 schema): `supabase/migrations/0100_dispatch_schema.sql`
  applied locally (schema and constraints only). What 0101 must know:
  - `h3_grid_disk_distances(p_origin bigint, p_k integer) returns table(cell, k)` was
    added to 0099 (template + regenerated + installed with create-or-replace). It
    shares `_h3_grid_disk_core` with `h3_grid_disk`; the engine computes ONE disk per
    advance and knows each cell's ring. Verified against h3-js `gridDiskDistances`
    on the same 10,784 vectors as the disk check: 0 mismatches; `h3_core.sql` is
    now 233 pgTAP tests, all ok.
  - `dispatch_offers`: new `cycle_no, attempt_no` (NOT NULL), `ring, radius_m,
    distance_m, eta_seconds, close_reason`; statuses +superseded +cancelled; unique
    indexes `dispatch_offers_one_live_per_order`, `dispatch_offers_one_accepted_per_order`,
    constraint `dispatch_offers_order_cycle_attempt_key`; pair unique dropped;
    `dispatch_offers_order_id_idx` dropped (prefix of the triple unique); new
    `dispatch_offers_rider_live_idx`. 0076 re-open trigger dropped, the AFTER INSERT
    notify trigger untouched. Guard trigger `dispatch_offers_guard` (transitions,
    immutables, forced responded_at; a row whose status does not change cannot be
    changed at all, so set `close_reason`, `ring` etc. in the same UPDATE as the
    transition). attempt_no is per ORDER and increases across cycles.
  - Shim `dispatch_offers_default_numbers` (BEFORE INSERT) fills cycle_no/attempt_no
    when the writer omits them. The 0101 engine sets both explicitly; drop the shim
    when no writer relies on it.
  - Temporary in-place patches (text replacement with an assertion, bodies still
    the 0098 ones otherwise): `_dispatch_offer_round` expires its own lapsed offer,
    returns (0, null, null, 'base') while a live offer exists, locks the order, and
    inserts ONE row (the nearest), no upsert, `p_batch_size`/`dispatch_max_riders`
    ignored in this path; `accept_dispatch_offer` accepts only the caller's live
    offer and closes others as superseded/order_assigned; `admin_reassign_order_rider`
    supersedes live offers then plain-inserts an accepted row;
    `vendor_start_self_delivery` writes cancelled/vendor_self_delivery. 0101 replaces
    all of them. Note some 0083/0098 function bodies were stored with CRLF line
    endings; the patch helper normalises them.
  - `order_dispatch` created and backfilled (in-flight rider-delivery orders; no
    trigger creates rows for new orders yet, that is the engine's job at vendor
    accept; `set_updated_at` trigger present). `dispatch_events` (no FKs on
    purpose), `_dispatch_log(order, event, data, offer, rider)` (reads cycle/attempt
    from order_dispatch, 0 if no row), `purge_dispatch_events()` (service_role,
    90 days, not yet scheduled).
  - `riders.h3_cell` (res 9) + trigger `riders_set_h3_cell` (only when
    `current_location` changes) + partial btree `riders_h3_cell_idx`.
  - Settings: D10 keys added. New units `kmh` and `pct` (unit check recreated).
    `dispatch_h3_initial_ring <= dispatch_h3_max_ring` spans two rows and is NOT
    enforceable by the CHECK: `admin_set_dispatch_setting` (0102) must enforce it, and
    must also learn the new keys/units (it was not touched). `_dispatch_offer_ttl()`
    is now STABLE SECURITY DEFINER and reads `dispatch_offer_timeout_seconds` (45).
  - Existing pgTAP suites that fail or abort on the sequential contract are listed in
    the sprint report for the test sprint (dispatch_settings, accept_dispatch_offer,
    admin_dispatch_override, qa_dispatch_privacy_regressions, vendor_self_delivery #11).

- **Sprint 1c (0101 engine)** - `supabase/migrations/0101_dispatch_engine.sql`, test
  `supabase/tests/dispatch_engine.sql` (121 ok / 0 not ok on admintest).
  - New functions (all internal, execute revoked from everyone):
    `_estimate_travel_seconds(geography, geography, uuid) -> int` (D7 seam: metres x
    road factor / speed + 60 s; 0104 calibrates), `_dispatch_start_at(orders,
    timestamptz) -> timestamptz` (D8 seam: expected ready - default travel - buffer,
    never before accepted_at; 0104 refines), `_dispatch_rider_available(uuid)`
    (online, approved, fresh ping, active profile, no active order),
    `_dispatch_rider_excluded(order, rider, cycle)` (declined/revoked/accepted/live
    on this order, already asked this cycle, or a live unexpired offer on ANOTHER
    order), `_dispatch_candidates(order, ring, radius_m, cycle_no, limit)` (ring not
    null = H3 disk via one `h3_grid_disk_distances` call, ring null = PostGIS KNN
    `beyond_rings`; fee-funding filter; ranked by ETA, distance, uid),
    `_dispatch_close_live_offer(order, status, reason) -> int`,
    `_dispatch_advance(order, trigger text, force_widen bool) -> jsonb` with outcome
    offered | waiting | no_candidates | not_dispatchable.
  - Evolution: `order_dispatch.cycle_no` 0 -> 1 on the first offer; a new cycle starts
    (cycle +1, ring reset to `dispatch_h3_initial_ring`) when the ready trigger fires
    after earlier early-dispatch offers, or when the current cycle has candidates
    exhausted AND at least one rider was asked in it (once per call). Cycle 3+ sets
    needs_attention (`two_cycles_without_accept`). `attempt_no` is per order,
    +1 per offer, and continues from max(existing offers) so admin-inserted rows are
    safe. `ring` starts at the stored ring and grows one at a time to
    `dispatch_h3_max_ring` within a call (logged `ring_expanded`); the offer stores the
    rider's own H3 grid distance; the stored ring follows the last offer. Beyond the
    last ring the KNN fallback runs (offer ring null).
  - Triggers on orders: `orders_dispatch_sync_status` (AFTER UPDATE OF status, when
    accepted/terminal: creates order_dispatch scheduled with start_at, or cancels the
    live offer and stops) and `orders_dispatch_sync_rider` (AFTER UPDATE OF rider_id:
    assigned / back to searching). Both sort before `orders_dispatch_to_riders`.
    `dispatch_order_to_nearby_riders` (ready) now calls the engine.
  - Wrappers (names/shapes unchanged): `_dispatch_offer_round` (batch size ignored,
    max one offer), `_dispatch_offer_batch` (1/0), `_redispatch_core` (jsonb shape
    kept; trigger still 'redispatch'), `sweep_dispatch_offers`,
    `dispatch_orders_nearing_prep_completion`. Sweep error handling backs off via
    `order_dispatch.error_count/next_check_at`; 30-minute give-up kept.
  - Test fixes (test file only): the zero-rider helper call, the start_at arithmetic
    (20 min - 750 s = 7.5 min), a same-statement snapshot in the supersede assert, and
    parking other scheduled orders before the early-dispatch scan. No engine bug found.
  - Existing suites (admintest): h3_core 233/0, vendor_location_and_rider_reads 16/0,
    scheduled_jobs_and_write_latency 20/0, rider_kyc_and_notifications 19/0,
    transition_order 9/0, place_order 7/0, verify_delivery_and_release_escrow 16/0,
    require_escrow_release_before_delivered 6/0, rls_orders 4/0, vendor_notifications
    12/0. Sequential-contract failures for the test sprint: dispatch_settings 108/24
    (batch/simultaneous expectations, settings-key list grew, riders holding a live
    offer elsewhere are excluded), accept_dispatch_offer / admin_dispatch_override /
    qa_dispatch_privacy_regressions abort on `dispatch_offers_one_live_per_order` or the
    immutable-columns trigger (fixtures insert several live offers per order),
    vendor_self_delivery 62/2 (#11 revoked is now cancelled; #35 the lone fixture rider
    holds the early-dispatch offer on order 05 so the 35-minute-old control order 06
    has no candidate and is given up). Pre-existing: admin_operations 164/7 (stale
    audit rows), admin_dispatch_override's 1 audit failure (masked by the abort).
  - EXPLAIN: the res-9 range join uses `riders_h3_cell_idx` (Index Scan, cond on h3_cell
    between lo and hi) even without disabling seqscan; 13 riders locally.
  - Notes for 0102: accept/decline/admin/vendor RPCs should call `_dispatch_advance`
    with real triggers ('decline', 'admin_redispatch', 'vendor_expand'; `_redispatch_core`
    cannot say which today because its signature is fixed); accept must lock
    orders -> riders -> order_dispatch -> dispatch_offers; decline should close the
    offer with `_dispatch_close_live_offer` then advance; fixtures in the old suites
    need one live offer per order. `admin_set_dispatch_setting` must learn the new keys
    and the initial_ring <= max_ring rule. Note the engine does not lock riders.
  - Notes for 0103: the 15 s sweep already calls the engine; replace it with a tick
    that picks due `order_dispatch.next_check_at` rows (the engine sets next_check_at
    to offer expiry / +15 s / start_at / +60 s unpaid), folds in
    `dispatch_orders_nearing_prep_completion`, writes the outbox for offer pushes, and
    schedules `purge_dispatch_events`. The vendor "no rider nearby" notice is inserted
    directly by the engine (on conflict do nothing) - move to the outbox if D9 requires.

- **Sprint 1d (0102 RPCs)** - `supabase/migrations/0102_dispatch_rpcs.sql`, test
  `supabase/tests/dispatch_rpcs.sql` (180 ok / 0 not ok on admintest).
  - Core: `_dispatch_respond(offer_id, rider, action) -> jsonb` (internal). The rider always
    comes from `auth.uid()` in the caller. Locks orders -> riders -> order_dispatch ->
    dispatch_offers. Legacy `accept_dispatch_offer` / `decline_dispatch_offer`,
    `respond_to_dispatch_offer(p_offer_id, p_action)` and `get_dispatch_offer(p_offer_id)` all
    sit on it. `get_rider_offer_details` is unchanged (it authorises with EXISTS over the
    caller's offers, so several rows per (order, rider) are fine).
  - Outcome table (jsonb `outcome`, plus `reason`, `offer_id`, `order_id`, `status`,
    `close_reason`, `offered_at`, `expires_at`, `seconds_left`, `server_time`):

    | outcome | meaning | legacy accept | legacy decline |
    |---|---|---|---|
    | accepted | assigned now (ready: rider_assigned + order_events; early: rider_id+fee, status kept) | returns orders row | n/a |
    | already_yours | rider already holds the order (replay) | returns orders row (NEW, was an error) | raises "no active offer" |
    | taken | order assigned to someone else or no longer eligible (checked before the offer state) | raises "order already assigned or not ready for pickup" | raises "no active offer" |
    | expired | offer past expiry: closed `expired/timeout` and the engine advanced (`next` = engine outcome); or already closed as expired | raises "offer has expired" | raises "no active offer" |
    | withdrawn | offer superseded/cancelled/revoked (reason `vendor_delivery` for self delivery) | raises "no active offer" (vendor message for vendor_delivery) | raises "no active offer" |
    | declined | declined by this rider (a first decline also advances the engine in the same transaction; `next` = engine outcome) | raises "no active offer" | returns the closed offer row (a repeat returns the same row) |
    | not_found | not this rider's offer (no order_id, no leak) | n/a (legacy finds the rider's own offer by order) | raises "no active offer" |
    | ineligible + reason | kyc, inactive, busy, location, unfundable: nothing changes, the live offer stays | "rider is not kyc-approved" / "calling account is not active" / "rider already has an active order" / "must be online with a location update ..." / "is too far from this rider ..." | n/a |

    Events: `accept_conflict` (order held by another rider), `stale_accept_rejected` (expired,
    not ready, ineligible), `offer_accepted`, `offer_declined`.
  - Expired accept on the legacy RPC: it RAISES, which rolls back the expire + advance the
    core did (the tick expires and advances within seconds). `respond_to_dispatch_offer`
    keeps the expire + advance and returns `expired`. The same rollback drops the
    accept_conflict / stale events of a legacy loser (the new RPC keeps them).
  - Rate limit: table `rider_offer_responses(rider_id, at)` (no FK, RLS on, no client
    grants), exact rolling window: 30 calls per rider in the last minute, counted across
    accept + decline + respond; the 31st raises SQLSTATE P0429 `rate_limited: ...`. A per-rider
    `pg_advisory_xact_lock` serialises concurrent calls; rows older than 5 minutes are deleted
    by that rider's next call. BEST EFFORT (documented in 0109, comment on `_dispatch_rate_check`): only calls that RETURN are
    counted (a raise rolls the insert back), so legacy losers that raise, and any call failing validation, are not counted; the new
    respond RPC never raises for races and is fully counted. Counting failures would need an autonomous transaction (dblink), which
    was deliberately not introduced: the limit bounds a rider's successful/idempotent traffic, not a flood of failing calls. 0103: purge leftover rows of idle riders (e.g. older than 1 hour).
  - `get_dispatch_offer`: `{outcome 'found', offer_id, order_id, status, close_reason,
    offered_at, expires_at, seconds_left, actionable, holds_order, cycle_no, attempt_no, ring,
    distance_m, eta_seconds, order_status, order}`; `order` = the get_rider_offer_details
    fields, present only while the offer is live or the rider holds the order; customer
    name/phone only for the holder. Not this rider's: `{outcome 'not_found', status null,
    order_id null, actionable false, order null}`.
  - Admin: `admin_reassign_order_rider` locks order -> rider -> order_dispatch; assign
    supersedes the live offer (`admin_assigned`) and inserts ONE new `accepted` offer (current
    cycle, attempt max+1, `expires_at = now()`); the previous accepted offer becomes `revoked`
    / `admin_reassigned`; unassign revokes and re-offers through `_dispatch_advance(order,
    'admin_reoffer')`, pulling `start_at` forward to now for not-yet-ready orders. The initial
    pickup ETA (`assigned_eta_at`, `current_eta_at`) is stamped on every assignment (rider
    accept and admin assign) by `_dispatch_stamp_assigned_eta`; 0104 keeps it fresh.
    `_redispatch_core(order, widen, trigger)` is the real function now; the 2-arg form is a
    wrapper (trigger 'redispatch'). `admin_redispatch_order` uses 'admin_redispatch' (it also
    pulls a scheduled `start_at` to now), `vendor_expand_rider_search` uses 'vendor_expand'.
    The return JSON of both keeps `offers_created, riders_in_range, radius_m, tier` and ADDS
    `outcome, offer_id, live_offer` (a live offer is kept: offers_created 0, live_offer true).
    `vendor_start_self_delivery` suppresses the queued SMS, closes the live offer through
    `_dispatch_close_live_offer(.., 'cancelled', 'vendor_self_delivery')` and sets the
    dispatch state `stopped`. `vendor_expand_rider_search` refuses a not-yet-ready order
    before its `start_at` (check_violation "has not started yet") so no expansion is wasted.
  - `admin_set_dispatch_setting` knows every D10 key with its bound (plain-language
    messages) and enforces `dispatch_h3_initial_ring <= dispatch_h3_max_ring` on either change
    (both rows locked in key order). The shim `dispatch_offers_default_numbers` is KEPT: no
    production writer relies on it any more, but the existing pgTAP fixtures still insert
    offers without cycle/attempt numbers (drop it together with the fixture rewrite).
  - JSON changes for the frontend step:
    - `admin_dispatch_status().stuck_orders[].reason`: `offers_pending` ->
      `waiting_for_rider_reply`; `awaiting_dispatch` is gone; the set is `scheduled |
      waiting_for_rider_reply | no_online_riders | none_in_range | fee_exceeds_order_budget |
      all_declined_or_expired | needs_attention` (needs_attention is also the fallback when
      fundable riders exist but nobody was ever asked after 60 s). Population: ready orders,
      plus accepted/preparing orders whose dispatch has started (state searching / offered /
      needs_attention), waiting over 60 s; "waiting since" for early orders is the order's `start_at`.
    - New per-order keys: `dispatch_state`, `live_offer {offer_id, rider_id, rider_name,
      attempt_no, seconds_left, eta_seconds} | null`, `cycle_no`, `attempts_made`, `start_at`,
      `expected_ready_at`, `needs_attention` (bool), `attention_reason`. Old keys kept
      (`offers_made`; `offers_open` is now 0 or 1).
    - New top-level keys: `upcoming[]` (max 50: `order_id, code, vendor_id, vendor_name,
      status, accepted_at, expected_ready_at, start_at, starts_in_seconds, dispatch_state`),
      `needs_attention_count`. `settings` adds `offer_timeout_seconds, h3_resolution,
      h3_initial_ring, h3_max_ring, secure_buffer_seconds, default_travel_seconds,
      default_speed_kmh, road_factor_pct, min_history_samples, vendor_arrival_radius_m`.
    - New `admin_dispatch_order_history(p_order_id) -> {order, dispatch (the order_dispatch
      row), offers[] ordered by attempt (offer_id, rider_id, rider_name, cycle_no, attempt_no,
      ring, radius_m, distance_m, eta_seconds, status, close_reason, offered_at, expires_at,
      responded_at, seconds_to_respond), events[] (latest 200, oldest first)}`; service_role
      only, same gate as `admin_dispatch_status`.
    - `vendor_dispatch_state` / `_vendor_dispatch_view`: old keys unchanged (`state` is still
      `offers_pending | no_rider_nearby | rider_assigned | self_delivery | not_applicable`);
      ADDED `dispatch_state, expected_ready_at, start_at, searching_since, attempts_made,
      assigned_eta_at`. `no_rider_nearby` and `can_expand` now require that dispatch has
      started; the waiting clock of a not-ready order is `start_at` (same as the engine).
    - The `dispatch_offers.status` TS union grows (`superseded | cancelled`):
      apps/web `src/lib/admin/orders.ts` (OrderDispatchOfferView) is the one typecheck error.
  - `packages/db/src/generated.ts` is a hand-authored placeholder (not generator output), so it
    was patched by hand for 0099-0102: units kmh/pct, `riders.h3_cell`, new `dispatch_offers`
    columns and statuses, tables `order_dispatch`, `dispatch_events`, `rider_offer_responses`,
    the settings key union, and the functions `respond_to_dispatch_offer`, `get_dispatch_offer`,
    `admin_dispatch_order_history`, `purge_dispatch_events`, `h3_*`.
  - Existing suites on admintest after 0102: dispatch_engine 121/0, h3_core 233/0,
    vendor_location_and_rider_reads 16/0, scheduled_jobs_and_write_latency 20/0,
    rider_kyc_and_notifications 19/0, transition_order 9/0, place_order 7/0,
    verify_delivery_and_release_escrow 16/0, require_escrow_release_before_delivered 6/0,
    rls_orders 4/0, vendor_notifications 12/0, admin_operations 164/7 (pre-existing).
    Expected-contract suites (not rewritten): dispatch_settings 105/27 (was 108/24: also the
    renamed reason, the settings block, the vendor-view exact JSON and the redispatch result),
    vendor_self_delivery 62/2 (as before); accept_dispatch_offer, admin_dispatch_override and
    qa_dispatch_privacy_regressions abort on their fixtures (several live offers per order /
    immutable columns); messaging aborts on the same fixture rule (dispatch_offers_one_live_per_order).
  - Notes for 0103: the tick should call `_dispatch_advance(order, 'tick')` for due
    `order_dispatch.next_check_at`; schedule `purge_dispatch_events` and a purge of
    `rider_offer_responses` older than an hour; the decline and expired-accept paths already set
    `next_check_at = now()` if the inline advance fails, so the tick retries. Outbox
    suppression of a closed offer's pending push should hang off the status change (vendor
    self delivery already suppresses the SMS explicitly).

- **Sprint 1e (0103 worker/outbox/cron)** - `supabase/migrations/0103_dispatch_worker_outbox.sql`, test
  `supabase/tests/dispatch_worker.sql` (104 ok / 0 not ok on admintest), Edge Function work in
  `supabase/functions/_shared/expo.ts` + `message-worker`.
  - Worker: `dispatch_tick(p_batch int default 200)` is a PROCEDURE that COMMITs after every order. Verified on the
    local pg_cron with a probe: a SECURITY DEFINER procedure fails with "invalid transaction termination" even as a
    single `call` (so does one with a SET clause), and a multi-statement command (`set local role ...; call ...`) runs in
    one implicit transaction block; a SECURITY INVOKER procedure called as the single statement `call dispatch_tick();`
    commits per order. So the procedure is invoker, holds no privileges, and only calls checked SECURITY DEFINER
    functions: `_dispatch_tick_claim(limit)` (due work) and `_dispatch_tick_order(order, trigger, due)` (one order). The
    caller check (`_dispatch_worker_caller_ok`) accepts the service role or the owner session (`session_user = 'postgres'`,
    which is how pg_cron runs). Claim: `next_check_at` due or null on a non-assigned/stopped state row, a live offer past
    expiry, or a paid dispatchable rider order with no state row; oldest first, batch 200. Per order: `FOR UPDATE SKIP
    LOCKED` (an order held by another session is skipped, never waited for), `_dispatch_advance(order, 'tick')`, the
    30-minute give-up (same transition and reason), `tick_lag` event only when more than 10 s late. Errors: error_count+1,
    `next_check_at = now() + least(5 s * 2^n, 300 s)` (5, 10, 20, 40, 80 ... 300), `tick_error` event, the 5th consecutive
    error sets state `needs_attention` / reason `worker_errors` + a `needs_attention` event (once); the next success resets
    error_count and clears a `worker_errors` alert. The failed advance is rolled back in a subtransaction and an
    order_dispatch row is upserted so even a no-row order backs off.
  - A procedure cannot run inside an enclosing transaction (PostgREST, pgTAP), so `_dispatch_tick_run(limit, trigger)` is
    the same loop in per-order subtransactions without COMMIT. `sweep_dispatch_offers()` (offers_expired, offers_created,
    orders_cancelled) and `dispatch_orders_nearing_prep_completion()` (offers_created) keep names, signatures and shapes and
    are wrappers over it / `_dispatch_tick_order`; execute is now service_role only (anon was granted before). The pgTAP
    tests exercise `_dispatch_tick_run`; the procedure itself was run by pg_cron (dispatch-tick, status succeeded) and by
    hand against committed fixtures (cleaned up afterwards): with order 1 locked by another session the tick skipped it and
    offered orders 2 and 3 (each committed), then offered order 1 on the next call; repeated calls created nothing new.
  - Claim ordering uses the due time, falling back to `orders.created_at` / the state row's `created_at` for rows with no
    due time (a first version sorted those first and starved a lapsed offer; caught by dispatch_engine #119).
  - Outbox: `message_outbox` gains `data jsonb`, channel `push`, suppress reason `no_push_token`, and a check that a push is
    always transactional (so consent logic never applies). `message_mark_suppressed` accepts `no_push_token`;
    `scrub_message_outbox` also clears `data`. `enqueue_rider_offer_sms()` is the 0096 body with one change: its hourly cap
    now counts only SMS rows (push rows are `rider_offer` too and would have eaten the cap).
  - Offer push: trigger `dispatch_offers_queue_push` (AFTER INSERT, status offered) replaces `dispatch_offers_notify_rider`.
    Row: kind `rider_offer`, channel `push`, category `transactional`, recipient = rider, `to_address` null (tokens are
    read from `rider_push_tokens` at send time), subject `New delivery`, body `Pickup from <vendor>. Tap to see it.`
    (the text dispatch-push sent), `data = {type: 'dispatch_offer', orderId, offerId}`, `expires_at` = offer expiry,
    dedupe `offer:<id>:push`; then `invoke_message_worker()` (pg_net is transactional: sent only if the offer commits; a
    no-op without the Vault secrets). An enqueue failure logs a warning and a `push_failed` event, never rolls back the
    offer. Trigger `dispatch_offers_closed` (AFTER UPDATE OF status, old offered): suppresses a still-queued push/SMS for
    the offer (`suppressed` / `expired`), and for superseded/cancelled when the push was already claimed or sent queues
    `offer:<id>:withdrawn` (subject `Offer withdrawn`, `{type: 'dispatch_offer_withdrawn', orderId, offerId}`, lapses in 2
    minutes). `notify_rider_of_new_offer()` and the `dispatch-push` function remain (rollback).
  - Edge Functions: Expo helpers moved to `supabase/functions/_shared/expo.ts` (dispatch-push imports them; behaviour
    unchanged, `sendExpoPushMessages` still throws the same messages); `message-worker` sends channel `push` through Expo:
    no tokens or all tokens dead = `message_mark_suppressed(..., 'no_push_token')` (non-failing), DeviceNotRegistered tokens
    are deleted, ticket errors and HTTP 5xx/429/408/network are retried through `message_mark_failed` (up to
    `max_send_attempts`), MessageTooBig / InvalidCredentials / other 4xx are permanent; Expo `ttl` = seconds to the offer's
    expiry. Only ids and short codes are logged or stored. Tests: `node --test supabase/functions/_shared/` files (the
    repo's existing way to run the messaging tests; Deno is not installed): 28 pass (12 expo + 16 messaging);
    `dispatch-push/expo.test.ts` was folded into `_shared/expo.test.ts`. `message-worker/index.ts` and
    `dispatch-push/index.ts` type-check with tsc against a Deno stub (no errors). The worker's own wiring (`processPush`)
    lives in the Deno entrypoint and is not unit-tested; the logic it calls is.
  - Cron (`_ensure_scheduled_jobs`, rewritten from the live 0096 body): `dispatch-tick` 5 seconds `call dispatch_tick();`;
    `purge-dispatch-events` `37 3 * * *`; `purge-rider-offer-responses` `11 * * * *` (rows older than 1 hour); the two old
    dispatch jobs are unscheduled (guarded); every other job is exactly as before. `scheduled_jobs_and_write_latency.sql`
    was updated deliberately (job set, 5 s schedule, the CALL command; still 20 tests).
  - Suites on admintest after 0103: dispatch_worker 104/0, dispatch_engine 121/0, dispatch_rpcs 180/0, h3_core 233/0,
    vendor_location_and_rider_reads 16/0, scheduled_jobs_and_write_latency 20/0, rider_kyc_and_notifications 19/0,
    transition_order 9/0, place_order 7/0, verify_delivery_and_release_escrow 16/0,
    require_escrow_release_before_delivered 6/0, rls_orders 4/0, vendor_notifications 12/0, admin_operations 164/7
    (pre-existing). Unchanged expected-contract state: dispatch_settings 105/27, vendor_self_delivery 62/2;
    accept_dispatch_offer, admin_dispatch_override, qa_dispatch_privacy_regressions and messaging still abort on their
    fixtures (several live offers per order); messaging gets through 190 ok before `dispatch_offers_one_live_per_order`.
  - Hosted deployment (CORRECTED in 0109, see section 6: deploy `message-worker` AND `dispatch-push` BEFORE applying 0103,
    not after; the old worker permanently suppresses the offer pushes, which are queued with a null `to_address`). Original text,
    order aside: deploy `message-worker` AND `dispatch-push` (both bundle
    `_shared/expo.ts`); confirm the Vault secrets `message_worker_function_url` / `message_worker_secret` (and the function
    secret `MESSAGE_WORKER_SECRET`), without which pushes stay queued; then `select _ensure_scheduled_jobs();` as postgres
    (adds dispatch-tick and the purges, unschedules the two old jobs). pg_cron must accept `5 seconds` (1.5+; the hosted
    image ships 1.6). Rollback of the push path: recreate trigger `dispatch_offers_notify_rider` ... `execute function
    notify_rider_of_new_offer()` and drop `dispatch_offers_queue_push`; the dispatch-push Vault secrets
    (`dispatch_push_function_url`, `dispatch_push_service_role_key`) must still exist. Rollback of the schedule: re-add
    the two old cron jobs and `cron.unschedule('dispatch-tick')`.
  - Notes for 0104: `purge_dispatch_events` has a vacuous caller check (`current_user <> 'postgres'` is always false inside
    a SECURITY DEFINER body); its service_role-only execute grant is what actually protects it. The rider app may
    optionally use `offerId` / `dispatch_offer_withdrawn` from the push data.

- **Sprint 2A (0104 predictive timing)** - `supabase/migrations/0104_dispatch_predictive_timing.sql`, test
  `supabase/tests/dispatch_predictive.sql` (119 ok / 0 not ok on admintest). Metrics (part B) come in a later step.
  - Formula as implemented. `start_at = max(expected_ready_at - travel_s - buffer_s, accepted_at)`.
    `travel_s` = median ETA of the top 3 currently eligible candidates (`_dispatch_candidates`, the engine's own rules:
    rings from `dispatch_h3_initial_ring` to `dispatch_h3_max_ring` with `dispatch_radius_m`, then the KNN fallback;
    the rider's ETA to the vendor), else `dispatch_default_travel_seconds` (600). `buffer_s` = history when the area has
    >= `dispatch_min_history_samples` answered offers (accepted/declined/expired, last 14 days):
    `(answered/accepted - 1) x mean seconds of a declined/expired offer + mean seconds to accept`, accepted = 0 gives 900;
    else `dispatch_secure_buffer_seconds` (150); clamped [45, 900]. Example (known geometry): 20 min prep, rider 481 s
    away, default buffer: `start_at = accepted + 1200 - 481 - 150 = +569 s`.
  - Functions: `_dispatch_start_calc(orders, ready) -> (start_at, basis)` (new), `_dispatch_start_at(orders, timestamptz)`
    (same signature, wrapper), `_dispatch_recompute_start(order, force)`, `_dispatch_tick_timing(order)`,
    `_dispatch_area_stats_refresh(area, force)`, `_dispatch_notify_rider(...)`, `_dispatch_ready_early(orders)`,
    `_dispatch_rider_ping(rider, lat, lng)`; all internal (execute revoked from everyone). `_dispatch_sync_status` replaced
    (stores the basis); `_dispatch_tick_order`, `dispatch_order_to_nearby_riders` and `update_rider_location` were patched
    in place by single-line anchors (asserted to match once), signatures unchanged.
  - `start_basis` JSON: `{travel_s, travel_source: candidates|default, buffer_s, buffer_source: history|default,
    candidates_used, expected_ready_at, computed_at}`.
  - Caching (D7): table `dispatch_area_stats(service_area_id pk, speed_kmh, speed_source, speed_samples, secure_buffer_s,
    buffer_source, buffer_samples, refreshed_at)`, RLS on, `service_role` select only. `_estimate_travel_seconds` keeps its
    signature and formula (metres x road factor / speed + 60 s) and only READS the row (one primary-key lookup; history speed
    only when `speed_source = 'history'`); it never aggregates. `_dispatch_tick_order` calls the refresh for the order's area
    before advancing; a row younger than 10 minutes is skipped by a staleness check, and a transaction advisory lock keeps two
    ticks from refreshing the same area. Speed = median of `pickup distance / (rider_arrived_vendor_at - assigned_at)` over
    30 days (distance = `orders.rider_pickup_distance_m`, else the accepted offer's `distance_m`; duration must be > 0),
    clamped 8-40 km/h, used at >= min samples. Observed speed is straight-line metres per total second, so the road factor
    and 60 s overhead on top make the ETA slightly conservative. Areas with no ticked order have no row (defaults apply).
    New indexes: `order_dispatch_arrived_idx`, `dispatch_offers_offered_at_idx`, `orders_rider_prepickup_idx`.
  - Recompute cadence: while `scheduled` the tick recomputes `start_at`/`start_basis` at most every 60 s (basis
    `computed_at`), `next_check_at = least(start_at, now() + 60 s)`; `start_recomputed {old, new, travel_s, buffer_s,
    candidates_used}` is logged only when start_at moves by more than 30 s. A due start (`start_at <= now()`) is never pushed
    back by the tick (only a vendor update can). `ready_for_pickup` still starts at once (dispatch_engine and
    dispatch_predictive assert it with start_at an hour away).
  - `vendor_update_prep_estimate(p_order_id uuid, p_ready_in_minutes integer) -> jsonb`, authenticated only:
    `{order_id, expected_ready_at, start_at, rider_notified}`. Vendor staff of the order (`_vendor_order_guard`), status
    accepted/preparing, rider delivery, 1-180 minutes (check_violation 23514), max 10 changes per order (P0429),
    other accounts 42501. Sets `expected_ready_at = now() + minutes`, recomputes `start_at` if still `scheduled`, logs
    `prep_estimate_changed {old, new, ready_in_minutes}`. A rider holding the order and a change of >= 3 minutes gets a
    `rider_notifications` row ('Food will be ready later' / 'Food will be ready sooner', 'Order <code>: food should be ready
    at about HH:MM.' in Africa/Lagos) and a transactional push (`message_outbox` kind `system`, channel `push`, data
    `{type: 'order_prep_update', orderId}`, dedupe `order:<id>:prep:<n>`, n = number of changes so far), then
    `invoke_message_worker()`.
  - Ready early: a rider-holding order that becomes `ready_for_pickup` >= 2 minutes before `expected_ready_at` gets
    'Food is ready now' (row + push `{type: 'order_ready', orderId}`, dedupe `order:<id>:ready`) and a `ready_early
    {expected_ready_at, early_seconds}` event; hooked into the 0064 branch of `dispatch_order_to_nearby_riders` (cascade to
    rider_assigned unchanged, failures only warn). Overrun: the tick slides `expected_ready_at` to `now() + 5 min` when it is
    more than 5 minutes past, for accepted/preparing orders in state scheduled/searching/offered/needs_attention, logs
    `prep_overrun {old, new}`, tells nobody.
  - `update_rider_location`: after its unchanged body it calls `_dispatch_rider_ping`, which does one lookup (partial index
    on `orders(rider_id)` for pre-pickup statuses joined to `order_dispatch`) and returns at once for a rider without such an
    order; failures only warn. With an order: the first ping within `dispatch_vendor_arrival_radius_m` of the vendor stamps
    `rider_arrived_vendor_at` and logs `rider_at_vendor {wait_seconds}` (arrival - `orders.ready_at`, null when not ready yet,
    negative when the rider was early); `current_eta_at`/`eta_updated_at` refresh at most once per 30 s;
    `eta_increased {step, assigned_eta_at, current_eta_at, increase_seconds, ready_at}` is logged when the new ETA is more
    than 5 minutes past `assigned_eta_at` and after the food is ready (or expected), once per 5-minute step. Nothing is ever
    reassigned. Timing, `update_rider_location` (3000 calls, ms/call): before 0.69-0.83 with and without an order; after
    0.88-0.95 (about +0.1 ms: the extra call and index probe); a ping that refreshes the ETA costs a few ms but happens once
    per 30 s per rider.
  - Notes for the metrics step: events to aggregate are `start_recomputed`, `prep_estimate_changed`, `prep_overrun`,
    `ready_early`, `eta_increased`, `rider_at_vendor` (wait_seconds = arrival - ready_at: positive = the food waited for
    the rider, negative = the rider waited for the food); `order_dispatch.start_basis` holds the travel/buffer basis per
    order; `dispatch_area_stats` has the learned speed and buffer per area with their sample counts. Existing tests changed
    deliberately for D8: dispatch_engine #85/#98/#99 (travel is now the eligible riders' ETA, next look in 60 s) and
    dispatch_rpcs order 02 (accepted 18 min ago so the rider is due). Other suites unchanged (dispatch_engine 121/0,
    dispatch_rpcs 180/0, dispatch_worker 104/0, h3_core 233/0, the rest as in 0103; admin_operations 164/7 pre-existing;
    dispatch_settings 105/27 and vendor_self_delivery 62/2 unchanged expected-contract state).
    `packages/db/src/generated.ts` was updated by hand (`dispatch_area_stats`, `vendor_update_prep_estimate`).

- **Sprint 2B (0105 metrics)** - `supabase/migrations/0105_dispatch_metrics.sql`, test `supabase/tests/dispatch_metrics.sql` (48/0).
  - `admin_dispatch_metrics(p_since timestamptz default now() - interval '7 days') returns jsonb`, service_role only (same gate
    as `admin_dispatch_status`; execute revoked from public/anon/authenticated, so a plain user gets 42501). STABLE SECURITY DEFINER.
  - JSON (rates 0-1, 3 decimals; seconds 1 decimal; every ratio/percentile is `null` with no samples, counts are 0):
    ```
    { "since": ts,
      "offers": { "made","accepted","declined","expired","cancelled","superseded": int,
                  "accept_rate","decline_rate","expiry_rate": number|null },   // revoked offers count in made only
      "assignment": { "orders_assigned": int, "median_s","p90_s": number|null,  // orders.accepted_at -> order_dispatch.assigned_at
                      "median_offers_per_assigned_order": number|null },
      "search": { "ring_expansions": int, "orders_with_expansion": int, "beyond_rings_offers": int,  // offers with null ring
                  "median_ring": number|null },
      "reliability": { "needs_attention_now": int,   // current order_dispatch rows, not windowed
                       "needs_attention_events","accept_conflicts","stale_accepts","tick_lag_events","tick_errors","push_failed": int },
      "readiness": { "samples": int,   // orders with ready_at in window and rider_arrived_vendor_at set
                     "rider_waited_share","food_waited_share": number|null,   // arrived < ready_at / arrived >= ready_at
                     "median_rider_wait_s","p90_rider_wait_s": number|null,   // ready_at - arrived, rider waited
                     "median_food_wait_s","p90_food_wait_s": number|null },   // arrived - ready_at, food waited (0 counts as food)
      "areas": [ { "service_area_id","name","speed_kmh","speed_source","speed_samples",
                   "secure_buffer_s","buffer_source","buffer_samples","refreshed_at" } ] }   // ordered by name
    ```
  - Windows: offers by `offered_at`, events by `at`, assignment by `assigned_at`, readiness by `ready_at`. Uses
    `dispatch_offers_offered_at_idx` and `dispatch_events_at_idx` (both Index Scan); no new index needed.
  - Volume (rolled-back txn, 100k offers + 100k events spread over ~35 days): default 7-day window (20k offers, ~20k events)
    23 ms; 30-day window over all 100k+100k 73 ms.
  - `purge_dispatch_events` caller check fixed (plain `service_role` check; pg_cron's `set local role service_role` still passes).
  - `packages/db/src/generated.ts` updated by hand (`admin_dispatch_metrics`).

- **Sprint 3A (old suites updated)** - the pgTAP suites written for simultaneous offers were rewritten, assertion by assertion, to the sequential contract (C12). Test files only, plus `supabase/migrations/0106_drop_offer_number_shim.sql`. Run on admintest (0105 -> 0106).
  - Rules applied to every fixture: one live offer per order; explicit `cycle_no` / `attempt_no` on every direct `dispatch_offers` insert; orders the engine must offer are `payment_status = 'paid'`; early (preparing) orders get the `order_dispatch` row the accept trigger would have made; offer columns (`expires_at`, `offered_at`) are immutable, so an already-lapsed offer is inserted as such (delete + re-insert) instead of updated. "N riders offered at once" became "the nearest eligible gets the offer, and the next one after each lapse/decline", walked with a helper that expires the live offer and calls `_dispatch_advance`.
  - `accept_dispatch_offer.sql` (8/0, was aborting): rider_a and rider_c no longer share order 41; rider_c's genuine offer (KYC check) moved to its own order 43 (same assertion, same message); rider_a / rider_b offers carry cycle 1, attempts 1 / 2. No assertion removed.
  - `admin_dispatch_override.sql` (103 ok / 1 known, was aborting; plan 96 -> 104): fixture offers are sequential (04: rl expired attempt 1, rk live attempt 2; 18 added so rg's "busy" accept has its own order); orders are paid; early orders 02/06/07 and parked orders 09/18 have `order_dispatch` rows. Changed assertions: new-offer push trigger `dispatch_offers_notify_rider` -> `dispatch_offers_queue_push` (0103); "other eligible riders were offered (2 live)" -> exactly ONE live offer, held by rj/rm/ro (rk/rl hold live offers elsewhere, ra revoked); "no ineligible rider offered" kept and made non-vacuous by walking the whole cycle (rj, rm, ro each asked once, one live offer at all times, never rb/rg/rf/rc/rd/re/rh/rk/rl); nudge "creates offers" -> one live offer to the nearest (ra); "a revoked rider does not take a slot in the batch" -> after a timeout exactly one more offer, to a different rider than ra and than the one who lapsed; "neither batch nor sweep re-offers the removed rider" (single pair row) -> ra still has exactly ONE row, revoked, even though the sweep starts a new cycle; early re-offer -> one live offer to ra, plus a count; assign "every other live offer is expired / rk expired" -> no live offer left, rk `superseded`, rl's earlier attempt stays `expired`. The rg-busy offer moved to order 18. The ONE known failure is unchanged and not touched: #26 "no refusal wrote an audit row" (have 2, want 0, stale local audit rows).
  - `qa_dispatch_privacy_regressions.sql` (8/0, was aborting; plan 5 -> 8): `UPDATE dispatch_offers SET expires_at` replaced by `pg_temp.lapse_live` (delete the live offer, insert the same rider/cycle/attempt already expired). "expired rider is re-offered (same row re-opened)" -> the lapsed row is `expired`, a NEW row in a later cycle is live for the same rider, and the repeated sweep made only one live offer; the "too far" accept now runs against the new cycle's live offer instead of re-opening the old row; added a precondition (the ready trigger made exactly one live offer, to the fresh rider).
  - `dispatch_settings.sql` (157/0, was 105/27): settings list split into the five original keys (unchanged) and the full 15-key list; "a round offers 10" -> one offer (ra), the walk asks `ra,rb,rd,rc,cap1..cap6` in that order, no 60 km rider, the 11th ask is cycle 2 with ra again; max riders 3 -> `ra,rb,rd` then cycle 2 restarts with ra (never the 4th nearest); radius 5 km -> one offer to ra; widened "3 untried riders" -> `1/20000/widened` held by rb, then rd, rc, never rfar/cap1, and the declined ra is never asked again (one row, still declined, even after the cycle restarts); 10 km store -> `1/10000`, asked exactly ra,rb,rd (rc never); 50 km cap -> radius 50000 and 16 distinct riders asked one at a time, rfar never; widen delay 0 -> `1/base`, only ra ever asked; freshness 120 s / 300 s -> the stale rider is skipped / asked while walking; sweep and early dispatch -> the offer carries radius_m 20000 (widened) and goes to the nearest free rider; status `offers_pending` -> `waiting_for_rider_reply` (fixture order 25) plus the new `live_offer` block; settings block: the five originals via `@>` plus the exact 15-key JSON; redispatch exact JSON `offers_created: 3` -> `1`, `outcome offered`, `live_offer false`, `offer_id` = the live offer, `holder = rd`; second call 0 and `live_offer true`; audit carries the result (order 32 first, since only ra is inside its base radius); "never resets a declined rider" -> still declined, no second ra row, a different rider asked; vendor view exact JSON -> the original keys via `@>` plus `dispatch_state needs_attention`, `attempts_made 0` and the new keys; expand exact JSON `3` -> `1` offer. New helpers: `asked`, `holder`, `walk`, `park_all` (end of each section parks live offers and stops dispatch rows of ready orders so riders are free and global sweeps do not hijack them; early orders keep their state with `next_check_at` a day out).
  - `vendor_self_delivery.sql` (65/0, was 62/2; two assertions added): #11 `revoked` -> `cancelled` plus `close_reason = vendor_self_delivery` (C5); #35 fixed with a second online rider (`sd_rider2`) so the rider-delivered control order 06 still has someone to ask while 05 holds the first rider's early offer, i.e. it checks again that vendor actions leave a rider order alone, not that the 30-minute give-up fires.
  - `messaging.sql` (219/0, plan 218 -> 219, was aborting after 190): offers for r2/r5/r6/r3 (and the accepted r4, and the kill-switch r2 offer 048) moved to their own orders 33-38; all rows have cycle/attempt; `UPDATE offered_at` (immutable) -> delete + re-insert the same offer made 15 s ago. The SMS counts now filter `channel = 'sms'` because every live offer also queues a push row (0103); one assertion added that 6 push rows exist (the accepted offer queues none). Every SMS / outbox assertion is otherwise untouched.
  - Fixtures of three more suites relied on the shim and were given explicit numbers (no assertion changed): `rider_kyc_and_notifications.sql` (the already-lapsed offer now inserted with `offered_at` 6 minutes ago), `scheduled_jobs_and_write_latency.sql`, `vendor_location_and_rider_reads.sql`.
  - Shim decision: DROPPED in `0106_drop_offer_number_shim.sql` (trigger `dispatch_offers_default_numbers` and function `_dispatch_offers_default_numbers()`). Basis: after the rewrite no test inserts `dispatch_offers` without `cycle_no`/`attempt_no` (grep of `supabase/tests`), and the live bodies of the only two production writers (`_dispatch_advance`, `admin_reassign_order_rider`, checked in `pg_proc`) set both; no other writer (seed, app, edge function) inserts offers. `cycle_no`/`attempt_no` were already NOT NULL without defaults (0100), so an insert that omits either now fails with a not-null violation (verified: `null value in column "cycle_no" ... violates not-null constraint`). Applied locally with `supabase migration up`; not applied to hosted.
  - Backend bug found: none. Observation (not a bug in reachable states): `admin_dashboard_metrics().stuck_orders.ready_without_rider` counts a rider-delivery early order whose `order_dispatch.state = 'stopped'` while `admin_dispatch_status().stuck_orders` omits it (it only lists states searching/offered/needs_attention); production only sets `stopped` for orders that leave dispatch, so the two stay equal in practice. The test parks early orders without changing their state to avoid depending on it.
  - Full suite on admintest after 0106 (`psql -f` per file, ok / not ok): (per-file counts removed in 0109: they contradicted each other and the files on disk; see section 7 for the re-run, dated results)

- **Sprint 3B (concurrency harness)** - `supabase/tests/concurrency/` (standalone package like `supabase/tests/h3/`, `pg` only, README with the run recipe). 21 scenarios / 704 iterations, real separate connections, committed fixtures, 15 hard invariants checked after every iteration. Run on the isolated e2e stack only.
  - Fresh replay: `pnpm --filter web e2e:cycle:up` (project `kiakia-e2ecycle`, db :58322) replayed ALL 106 migrations 0001-0106 plus seed.sql from scratch with no error (1 m 40 s). 0099-0106 therefore apply cleanly on a fresh database. One tooling fix was needed first: `apps/web/e2e/support/stack.mjs` copied `supabase/` including `supabase/tests/h3/node_modules` (pnpm symlinks) and failed with EPERM on Windows; the copy filter now skips `node_modules`.
  - Technique: riders impersonated as PostgREST does (`set local role authenticated` + `request.jwt.claims`), workers as `postgres` / `service_role`; a gate session holds an advisory lock, every job queues on its shared form inside its own transaction (verified parked in `pg_stat_activity`), the gate commits and they all run together (every 4th iteration free-fire, per-job random `pg_sleep` jitter). Deterministic interleavings (row lock held while another session queues) where order matters. Crashes with `pg_terminate_backend`, client timeouts with a destroyed socket / `pg_cancel_backend`. pg_cron jobs of the throwaway stack are unscheduled so the scenarios are the only participants. No external call: Vault has no `message_worker_*` secrets (`net.http_request_queue` = 0 after the run).
  - Hard invariants per iteration: <= 1 live offer / <= 1 accepted offer per order; `orders.rider_id` = accepted offer's rider (or both null); no accepted offer answered after its expiry; no rider with two active orders (whole DB); attempt numbers unique, contiguous, cycle never backwards; `order_dispatch` attempt/cycle/state consistent; no live offer on an assigned/closed order; status/rider agree; one rider-driven `rider_assigned` event and one early-accept event per order; one `offer_accepted` event per accepted offer; no closed offer with a queued push; each live offer has exactly one push row.
  - Results (final run, 2 m 55 s total; two earlier full runs were equally green apart from test-expectation fixes noted below):

    | # | scenario | iterations | result / evidence |
    |---|---|---|---|
    | 1 | 2/10/3-early riders accept at once | 60 | PASS: 60 wins (always the holder), 240 refusals ("no active offer" / not_found) |
    | 1.1 | one rider holding live offers on two orders accepts both | 30 | PASS: exactly one assignment, loser "already has an active order" |
    | 1.2 | admin assigns B while A accepts | 40 | PASS: B final every time; A accepted-then-replaced 13x, refused 27x; one accepted offer |
    | 2 | same rider, 5 parallel accepts | 40 | PASS: 200/200 replies ok, 1 assignment, `rider_assigned`/early event and `offer_accepted` event once |
    | 3 | client gives up mid-call, retries | 24 | PASS: destroyed socket 12x: first committed, retry `already_yours`; cancelled query 12x: nothing left, retry `accepted` |
    | 4 | accept after expiry (lapsed insert) vs ticks/next rider | 40 | PASS: expired holder never won (40/40 `expired`), advanced to r2 38x, r2 legitimately won 2x |
    | 4.1 | real 15 s timeout waited out | 6 | PASS: late accept `expired`, nobody assigned, next rider offered |
    | 5 | accept after another rider assigned | 40 | PASS: winner unchanged; stale/never-asked riders refused (r3 won only 1x, after r1 declined first) |
    | 6 | tick / sweep / tick_run vs accept | 60 | PASS: assignment survived 60/60, still exactly 1 offer row |
    | 7 | stale timeout job after newer offer | 40 | PASS: attempt 2 unchanged (id, status, expiry) after 7 stale actors |
    | 8 | 2-3 workers on 16 due orders (+4 locked by a third session) | 12 (192 orders) | PASS: 192/192 exactly one new offer; reported totals match (e.g. 8+8, 9+7); both workers got work; 16 locked orders skipped, not waited for |
    | 8.1 | two workers, two orders, one shared nearest rider | 40 | PASS on hard rules; FINDING 1 (below): same rider got two live offers 27/40 |
    | 9 | 8 duplicate jobs (tick/advance/sweep) on one order | 50 | PASS: exactly one offer, one `offer_created`, one push per offer |
    | 9.1 | DB backstop: 8 concurrent identical / second-live inserts | 20 | PASS: 1 winner, 7x SQLSTATE 23505 each time |
    | 10 | rider offline / busy elsewhere vs accept | 48 | PASS: offline-first 24x refused (`ineligible/location`), dead offer cancelled `rider_unavailable` and next rider offered; accept-first assigned; accept vs admin-assign: exactly one |
    | 11 | platform cancel vs accept | 48 | PASS: cancel first 33x (no rider), assigned-then-cancelled 15x; live offer closed, rider freed |
    | 12 | 3 declines + 2 ticks + sweep | 48 | PASS: exactly one new live offer, declined rider never re-asked, one `offer_declined` |
    | 13 | everyone declines / times out | 10 | PASS: cycle 2 re-asks only the timed-out rider, cycle 3 raises `two_cycles_without_accept`, A and C asked exactly once, ticks make no further offers, state `needs_attention` |
    | 14 | rings / H3 cell boundary | 24 | PASS: offer.ring == independent SQL ring for rings 0,1,2,3,5,8; ring_expanded 1 -> k; rings 9,10 -> PostGIS fallback (ring null); rider across the boundary found as ring 1 after the ring-0 rider declines |
    | 15 | crash safety / outbox | 12 | PASS: killed mid-transaction: no offer, no outbox row, no state row, no events, lock released; committed: offer + push row (kind `rider_offer`, `data.offerId`, expires_at = offer expiry) and `message_claim_batch` returns it (rolled back, nothing sent), a second worker does not get it; killed accept leaves nothing, retry commits assignment + event + state together and the push becomes `suppressed/expired` |
    | 16 | notification dedupe / late / out of order | 12 | PASS: 8 concurrent enqueues -> 1 row (and 7x 23505 without ON CONFLICT); 4 concurrent `enqueue_rider_offer_sms` -> 1 SMS row; late push suppressed and not claimable; `get_dispatch_offer` declined/superseded, not actionable; other rider's id -> not_found; one `withdrawn` push under duplicate admin assigns |

  - Proof the harness can fail (mutations applied to the throwaway DB only, restored and verified by md5 / index / trigger state afterwards): (M1) `_dispatch_respond` without the expiry check -> #4 FAIL, expired offer accepted + invariant "no expired offer ever won"; (M2) `_dispatch_advance` without its order lock and without `dispatch_offers_one_live_per_order` -> #9 FAIL (deadlocks 40P01 and duplicate jobs); (M3) trigger `dispatch_offers_closed` disabled -> #15 and #16 FAIL (accepted offer's push left `queued`); (M4) `_dispatch_respond` without the rider row lock -> #10 FAIL ("rider holds two active orders", assignment to the offline rider). No migration was edited.
  - Test-expectation fixes made while building (no backend change): an admin reassignment legitimately adds a second `rider_assigned` event; a cancelled order that kept its rider legitimately has `order_dispatch.state` stopped or assigned; `order_dispatch.cycle_no` may exceed the last offer's cycle (a fresh cycle with no candidates); an expired holder's accept answers `taken` when the next rider has already won; H3 rings follow the res-8 PARENT of the res-9 cell (H3 is not perfectly nested, so a direct res-8 lookup differs at borders).
  - FINDING 1 (backend, low-medium; for the backend developer): concurrent engine runs on DIFFERENT orders can offer the SAME rider at once, because `_dispatch_candidates` / `_dispatch_rider_excluded` read committed offers and the engine takes no rider lock (noted in Sprint 1c, now measured). Repro (scenario 8.1): two paid ready_for_pickup orders of one vendor, one online approved rider A nearest to both, no live offers; two sessions at the same instant run `select _dispatch_tick_order(<order1>, 'tick', now())` and `select _dispatch_tick_order(<order2>, 'tick', now())` (each its own transaction). Result in 27 of 40 barrier/free-fire runs: both orders hold a live offer for A. Safety is intact (A can accept only one: every double accept gave exactly one success, the other "rider already has an active order"), but it breaks the D1 rule "a rider is asked about one order at a time", and the loser order keeps a dead offer to A until it expires (up to `dispatch_offer_timeout_seconds`; `next_check_at` = that expiry) because nothing wakes the order when A accepts elsewhere. Suggested fix: after choosing the candidate, lock the rider row (`select ... from riders where user_id = v_best.rider_id for update`, order orders -> riders per D2) and re-check `_dispatch_rider_excluded` before the insert; optionally set `next_check_at = now()` of the other order when a rider is assigned.
  - OBSERVATION 2 (cosmetic): `_dispatch_advance` on an order that was cancelled while holding a rider flips `order_dispatch.state` from `stopped` to `assigned` (the `rider_id is not null` branch is checked before the closed-status branch). Only reachable by a direct call (the tick claim skips `stopped` rows); no effect on offers or the assignment. Seen 15x in scenario 11.
  - Not covered / limits: the Edge Function `message-worker` itself (Deno not installed; only the claim path in SQL), real pg_cron timing (cron unscheduled on purpose; the worker procedure was driven by explicit calls), pg_net delivery (no Vault secrets), PostgREST connection pooling, and the rider app. Iterations are bounded (704) and interleavings are sampled, not exhaustively enumerated.

- **Sprint 3C (0107 rider lock verified)** - verification only, no code changed.
  - `0107_dispatch_rider_lock.sql`: `_dispatch_advance` locks the candidate's `riders` row `FOR UPDATE SKIP LOCKED` and re-checks `_dispatch_rider_excluded` / `_dispatch_rider_available` under the lock (up to 5 candidates per ring stage; if all were only locked/taken it retries in 15 s instead of burning the cycle); closed orders are checked before the rider branch (`stopped`, not `assigned`). New `_dispatch_wake_rider_offers` plus triggers (`_dispatch_sync_rider` extended, new `riders_dispatch_offline_wake`) set `order_dispatch.next_check_at = now()` on the rider's other live-offer orders when the rider is assigned or goes offline. Lock order orders -> riders -> order_dispatch (other orders in order_id order); the tick never waits for a rider lock.
  - Review: `_dispatch_advance` exists only in 0101 (0102-0106 never redefine it); the diff 0101 -> 0107 contains only the intended changes (rider lock, 3 -> 5 candidates, closed-order precedence, v_found/v_seen). `_dispatch_sync_rider` differs from 0101 only by the wake call. `pg_get_functiondef` on admintest equals the file body. 0107 does not touch `_dispatch_tick_order` or `_dispatch_sync_status` (0104 patch intact). No lost change.
  - Full pgTAP suite on admintest (`psql -f` per file, ok / not ok, rolled back): (per-file counts removed in 0109: they contradicted each other and the files on disk; see section 7 for the re-run, dated results)
  - Fresh replay: `e2e:cycle:down` then `e2e:cycle:up` replayed 0001-0107 + seed with no error.
  - Harness (full run, `node run.mjs --db-url ...58322`): 21/21 scenarios PASS, 0 invariant failures, total 211.3 s. Per scenario (iterations): 1 (60), 1.1 (30), 1.2 (40), 2 (40), 3 (24), 4 (40), 4.1 (6), 5 (40), 6 (60), 7 (40), 8 (12), 8.1 (40), 9 (50), 9.1 (20), 10 (48), 11 (48), 12 (48), 13 (10), 14 (24), 15 (12), 16 (12) = 704 iterations, all PASS. Scenario 8.1 now: 40/40 with distinct riders (was 27/40 with a shared rider). The invariant "no rider holds more than one live unexpired offer" is a hard check in `lib/invariants.mjs`, evaluated after every iteration (16 checks per set).
  - Findings: FINDING 1 is fixed by 0107 (verified by 8.1 plus pgTAP). OBSERVATION 2 (closed order flipping to `assigned`) is fixed too (pgTAP #12-#14). No new findings. Not covered: concurrent rider-lock deadlock beyond what scenarios 1-16 exercise (none observed).
  - Teardown: `e2e:cycle:down` run; `docker ps | grep e2ecycle` returns nothing.

- **Benchmark (H3 vs GiST)** - measurement only, no code changed. Script: `supabase/tests/h3/bench-discovery.sql` (one transaction, ends in ROLLBACK; fixed the results query so non-numeric outcome notes no longer abort it, added `adv` = number of orders given the slow full `_dispatch_advance` runs, and set c3 to rings 0-1 because `dispatch_h3_max_ring` has a floor of 1). Run on admintest only: `psql -v ON_ERROR_STOP=1 -v n=<riders> -v orders=100 -v adv=10 -f - < supabase/tests/h3/bench-discovery.sql` for n = 5000 / 20000 / 50000. Synthetic Ibadan riders (70% online, 85% KYC approved, 5% suspended), 100 vendors each with one ready+paid order (a/b rows: 1 warm-up pass, 1 measured pass; c rows: 10 orders, 1 pass). Afterwards riders 2 / auth.users 14 / vendors 8 = unchanged (no leftovers). All three sizes completed (the 50k run took about 35 min). Note `orders=100`, not the 200 originally planned, to fit the time budget.
  - Median / p95 ms per call:

    | method | 5k | 20k | 50k |
    |---|---|---|---|
    | a1 GiST KNN inline, nearest 10 (0098 filters) | 3.6 / 5.4 | 1.9 / 2.4 | 1.6 / 2.1 |
    | a2 GiST KNN inline, nearest 1 | 1.4 / 2.2 | 1.3 / 1.9 | 1.1 / 1.4 |
    | a3 `_dispatch_candidates` beyond_rings (KNN branch), limit 10 | 341 / 472 (*) | 3.3 / 7.8 | 2.3 / 3.7 |
    | a4 same, limit 1 | 350 / 457 (*) | 1.5 / 2.5 | 1.3 / 2.0 |
    | b0 H3 disk only k=1 / 4 / 8 (7 / 61 / 217 cells, no rider join) | 0.5 / 2.3 / 11.1 | 0.4 / 2.2 / 8.1 | 0.4 / 2.0 / 6.0 |
    | b1 disk + range join, raw, no filters, k=1 | 1.1 / 1.5 | 0.7 / 1.2 | 0.7 / 1.1 |
    | b1 same, k=4 | 2.4 / 3.2 | 2.7 / 4.1 | 4.3 / 7.3 |
    | b1 same, k=8 | 8.1 / 11.1 | 10.4 / 17.9 | 13.6 / 21.5 |
    | b2 `_dispatch_candidates` ring 1, limit 5 | 462 / 566 | 724 / 1030 | 1362 / 1570 |
    | b2 ring 4, limit 5 | 201 / 287 | 755 / 1032 | 1443 / 2090 |
    | b2 ring 8, limit 5 | 243 / 319 | 729 / 851 | 2455 / 3277 |
    | c1 `_dispatch_advance`, H3 path | 340 / 426 | 1085 / 1139 | 3861 / 3990 |
    | c2 `_dispatch_advance`, H3 empty then KNN fallback | 4239 / 4740 | 9306 / 10580 | 32601 / 35322 |
    | c3 `_dispatch_advance`, rings 0-1 empty then KNN | 1495 / 1636 | 2226 / 2350 | 7533 / 8483 |

    (*) a3/a4 at 5k are an outlier: the same function at 20k/50k is 1-3 ms, so at 5k the planner picked a seq-scan plan for the KNN branch; it shows how fragile the helper-in-WHERE shape is, not a property of KNN. Setup costs: h3_cell backfill UPDATE 0.55 s / 1.9 s / 4.5 s for 5k / 20k / 50k riders (about 90 us/row, one-off); per-ping trigger cost, 5000 moving pings total 0.20 s without the trigger vs 0.48-0.62 s with it at all three sizes (about 60-80 us extra per ping).
  - Key plan nodes. GiST KNN: `Index Scan using riders_current_location_gix ... Order By: current_location <-> vendor`, early exit after about 12 index tuples, 1.5-5 ms at every size, size independent. Engine-shaped H3 pool query (disk-range join with `is_online and _dispatch_rider_available(user_id)`): `Nested Loop, Join Filter: r.h3_cell between rg.lo and rg.hi` over `CTE Scan ranges` (61 rows, ~2 ms) and `Materialize -> Seq Scan on riders r, Filter: is_online AND _dispatch_rider_available(user_id)`, rows scanned = every online rider (2818 / 11219 / 28077 at 5k / 20k / 50k), 143 / 450 / 1416 ms inside that scan, and 172k / 683k / ~1.7M rows removed by the join filter. `riders_h3_cell_idx` is not used at all in that shape.
  - Conclusion. (1) The raw H3 discovery is cheap: the disk is NOT the cost (k=4 about 2 ms, k=8 6-11 ms of plpgsql/SQL-function disk generation; the raw range join adds 1-8 ms at k=4/8 even with 7000 candidates at 50k). (2) But as written in `_dispatch_candidates` the H3 branch is far slower than GiST KNN at every size and degrades linearly with rider count (about 0.2-0.5 s at 5k, 0.7 s at 20k, 1.4-2.5 s at 50k per call; `_dispatch_advance` 0.3 s / 1.1 s / 3.9 s): the planner puts the ranges as the outer side of a nested loop and seq-scans `riders` once with the per-row plpgsql helpers (`_dispatch_rider_available`, about 28 us/row) as the filter, so the H3 index is never probed and every online rider pays for the helper. The H3 path therefore does not pay off at any tested scale (5k-50k riders over one city); the GiST KNN plan (1-4 ms) wins at every size, and the cost of the empty-ring then KNN fallback (c2) is the sum of 8 rings x that seq scan plus KNN (4 / 9 / 33 s). The ring design only starts to pay off when it can drive an index probe: the only theoretical advantage over KNN is a bounded candidate set with the same filters, which KNN also gets for free from its early exit unless the available fraction is tiny. (3) So the cost that dominates is the per-row helper functions behind a bad join shape, not the plpgsql disk.
  - Recommended fix (not implemented, needs a migration and a re-run of this script): restructure the rings branch so the index is probed per range and the helpers run only on survivors, e.g. `from ranges rg cross join lateral (select r.* from riders r where r.h3_cell between rg.lo and rg.hi and r.is_online and r.current_location is not null limit N) r` in a MATERIALIZED CTE (nested-loop index probe on `riders_h3_cell_idx`), then apply the fee filter, `_dispatch_rider_available` and `_dispatch_rider_excluded` in the outer query on that small set; or inline the availability predicates as plain SQL (the 0098 shape above already does this and runs in 2 ms). Also consider dropping the H3 rings if, after the fix, they are not at least as fast as KNN.
  - Caching each vendor's disk ranges (described only, NOT implemented): a table `vendor_h3_ranges(vendor_id, resolution, k, lo bigint, hi bigint, primary key (vendor_id, resolution, k, lo))` filled lazily on first dispatch for a vendor (or by a trigger), invalidated by `delete where vendor_id = ...` from a trigger on `vendors` when `location` changes, and wholesale when `dispatch_h3_resolution` changes (truncate in `admin_set_dispatch_setting`). It would save only the disk step: about 0.4 / 2 / 6-11 ms for k = 1 / 4 / 8, against 200-2500 ms spent in the rider scan, so it is a small, non-decisive win; do the join-shape fix first, and only then reconsider caching if k=8 disks show up in the profile.
  - Not covered: concurrency (single session), real road ETA, vendors concentrated in one dense cell, a fraction of busy riders higher than the 70% online / small number on active orders used here, and `orders=200` as originally planned.

- **0108 (candidate query performance)** - fixes the defect found by the benchmark above. `supabase/migrations/0108_dispatch_candidates_perf.sql`, no schema/index change (all needed indexes existed). Functions only:
  - New `_dispatch_scan(order, from_ring, max_ring, radius, cycle, limit)`: the rings branch now probes `riders_h3_cell_idx` once per disk range (`LATERAL ... where h3_cell between lo and hi ... offset 0`, the `offset 0` fence stops the planner flattening it back into a seq-scan join), with the cheap column predicates (online, kyc, ping freshness, radius, fee) and the distance evaluated first and sorted nearest-first in a MATERIALIZED CTE; the profile join and the three anti-joins (busy order on `orders_rider_id_idx`; this-order exclusions and live-offer-elsewhere on `dispatch_offers`) are plain SQL evaluated lazily in that order and stop after `limit` rows. No plpgsql helper runs per scanned rider. The scan walks rings outwards and returns the candidates of the first ring >= from_ring that has a survivor (tagged `scan_ring`); the H3 disk is generated lazily (small disk first, the full max-ring disk once only if that was empty). `from_ring` null is the KNN branch (`order by current_location <-> vendor`, same predicates).
  - Ranking: ETA is monotonic in distance, so `(eta, distance, uid)` order equals `(distance, uid)` order; the scan ranks by distance in SQL and calls `_estimate_travel_seconds` only for the (<= limit) returned rows. Same candidate set, same order, same ring tags as 0101.
  - `_dispatch_candidates` keeps its signature (thin wrapper over the scan). `_dispatch_advance` is the 0107 body with the ring loop calling `_dispatch_scan` once per step (empty rings are skipped inside the call; `v_ring` ends at the ring used, or the max ring when nothing was found, so `offer.ring` and `ring_expanded` are unchanged); the 0107 rider lock and the under-lock re-check with `_dispatch_rider_available` / `_dispatch_rider_excluded` are untouched. `_dispatch_start_calc` (0104) uses one scan instead of a ring loop.
  - Drift guard: `supabase/tests/dispatch_engine.sql` ("0108 parity") builds a mixed fixture (offline, unapproved, stale ping, suspended, busy, live offer elsewhere, lapsed offer elsewhere, declined here, asked this cycle, asked an older cycle, no location, finished order) and asserts the scan's KNN and ring results equal exactly the set the two helpers accept, plus ordering and that the scan is internal-only.
  - Results, `bench-discovery.sql` with `orders=50 adv=10`, median / p95 ms, before -> after (admintest, single session, Ibadan synthetic data as above):

    | method | 5k before | 5k after | 50k before | 50k after |
    |---|---|---|---|---|
    | `_dispatch_candidates` ring 1 | 153.7 / 189 | 1.1 / 1.5 | 1745 / 2278 | 2.0 / 3.3 |
    | ring 4 | 181.6 / 221 | 4.5 / 6.0 | 1883 / 2132 | 9.9 / 17.1 |
    | ring 8 | 266.1 / 393 | 11.3 / 15.2 | 2302 / 2927 | 28.1 / 55.2 |
    | `_dispatch_candidates` beyond_rings limit 10 (KNN) | 346.9 / 484 | 4.7 / 7.6 | 2.7 / 4.8 | 3.6 / 5.5 |
    | `_dispatch_advance`, H3 path (c1) | 364.6 / 555 | 4.9 / 14.1 | 3649 / 4006 | 7.0 / 18.2 |
    | `_dispatch_advance`, rings empty -> KNN (c2) | 3834 / 5596 | 29.2 / 38.7 | 32852 / 35190 | 46.0 / 62.3 |
    | `_dispatch_advance`, rings 0-1 empty -> KNN (c3) | 1433 / 1611 | 12.6 / 16.2 | 7352 / 7540 | 9.5 / 10.6 |
    | KNN inline baseline (a1, nearest 10) | 1.1 / 1.7 | 2.3 / 3.6 (noise) | 1.3 / 2.3 | 1.9 / 3.0 |

    (The 50k before-run of the a3 row was already fast, 2.7 ms: the KNN branch was never the problem, the rings branch was.) Remaining cost of c2 at 50k (46 ms): about 7 ms plpgsql disk generation for k=8, about 11 ms probing the 217 empty ranges ring by ring, the rest is `_dispatch_advance` bookkeeping; vendor-disk range caching (described above, still not implemented) would save the first part only.
  - Plan at 50k riders (ring <= 2 shape): `Nested Loop` over the unnested ranges -> `Memoize` -> `Bitmap Heap Scan on riders` with `Bitmap Index Scan on riders_h3_cell_idx (h3_cell >= lo and h3_cell <= hi)`, one index probe per range, then `Index Scan using orders_rider_id_idx` and `profiles_pkey` on the few top-ranked rows only. No Seq Scan on riders.
  - Caveat found while measuring: the benchmark's c2 scenario (`update riders set h3_cell = null`, no ANALYZE) is a degenerate stats state; without the `offset 0` fence the planner picked a Seq Scan join there (0.7 s per ring), with it the plan is stable (18 ms scan) with and without a fresh ANALYZE.
  - Suites on admintest after 0108 (ok/not ok): (per-file counts removed in 0109: they contradicted each other and the files on disk; see section 7 for the re-run, dated results)
    - Follow-up (ranking): `_dispatch_scan` rings path now wraps the lazy top-N (`limit v_limit` over the materialized CTE, `offset 0` fence kept) in `select ... order by d, uid`, so the returned order no longer depends on CTE scan order (KNN path already had it). Ranking by distance equals ranking by ETA only while `_estimate_travel_seconds` is monotonic in distance for a fixed vendor/area; a routing provider (D7 seam) would require ranking by ETA.
    - Re-run on admintest: (per-file counts removed in 0109: they contradicted each other and the files on disk; see section 7 for the re-run, dated results)
    - Two failed dispatch-tick cron runs (18:38, 18:46 UTC, "server closed the connection"): not a crash (postmaster up since 16:43, container never restarted, no OOM); the cron worker backend was terminated during long-running benchmark sessions.

- **Post-0108 regression run** (admintest at 0108, rolled-back pgTAP; fresh replay on e2e stack).
  - pgTAP, every `supabase/tests/*.sql` (39 files, h3/ and concurrency/ excluded), 0 `ERROR` lines anywhere. 38 files fully green. Only failures are the known pre-existing stale-audit ones: `admin_operations` #1,#3,#19,#44,#54,#165,#171 (164 ok / 7 not ok of 171) and `admin_dispatch_override` #26 (103 ok / 1 not ok of 104). No new failures.

    (per-file counts removed in 0109: they contradicted each other and the files on disk; see section 7 for the re-run, dated results)
  - Fresh replay (`e2e:cycle:up`, ~1m47s): 108 "Applying migration" lines (0001-0108), seed.sql and test_helpers_shim.sql applied, no errors.
  - Concurrency harness on 58322: 21/21 scenarios passed in 231.3s, 0 invariant failures.

    | scenario | iters | result | time |
    |---|---|---|---|
    | 1 | 60 | PASS | 20.8s |
    | 1.1 | 30 | PASS | 11.1s |
    | 1.2 | 40 | PASS | 9.4s |
    | 2 | 40 | PASS | 8.2s |
    | 3 | 24 | PASS | 54.4s |
    | 4 | 40 | PASS | 8.0s |
    | 4.1 | 6 | PASS | 17.4s |
    | 5 | 40 | PASS | 8.9s |
    | 6 | 60 | PASS | 10.2s |
    | 7 | 40 | PASS | 9.8s |
    | 8 | 12 | PASS | 7.3s |
    | 8.1 | 40 | PASS | 4.4s |
    | 9 | 50 | PASS | 6.9s |
    | 9.1 | 20 | PASS | 2.2s |
    | 10 | 48 | PASS | 8.3s |
    | 11 | 48 | PASS | 8.2s |
    | 12 | 48 | PASS | 11.5s |
    | 13 | 10 | PASS | 7.1s |
    | 14 | 24 | PASS | 5.4s |
    | 15 | 12 | PASS | 6.6s |
    | 16 | 12 | PASS | 4.1s |
  - Stack torn down with `e2e:cycle:down`; no kiakia-e2ecycle containers remain.

- **Sprint 4A (admin/vendor UI)** - `apps/web` only; no `supabase/` or `generated.ts` change. Not run live (every screen is behind auth and the only dev server is the developer's, on the hosted DB); verified by typecheck, lint, vitest (including server-rendered markup of the vendor delivery section) and a production build.
  - Admin (reviewed the earlier agent's work and kept it): `lib/time.ts` (Lagos formatting, shared with the vendor side), `lib/admin/{dispatch-settings-info,dispatch-info,dispatch-history,dispatch-metrics,dispatch,orders}.ts`, `app/actions/admin-dispatch.ts`, `(admin)/_components/{DispatchHistory,WaitingReason,AdminActionForm,RedispatchButton}.tsx`, `admin/dispatch/{page.tsx,[orderId]/page.tsx,_components/*}`, `admin/orders/[id]/page.tsx`, `admin/page.tsx`, `admin/settings/_components/{RiderMatchingSection,DispatchSettingForm}.tsx`. Settings show all 15 D10 keys in plain words with bounds, the first-search <= furthest-search rule (client and database), a required reason, and the "one at a time, nearest first" line. /admin/dispatch shows the seven reasons, live offer (rider + seconds left), round, riders asked, expected ready, planned start, ETA, the upcoming list, per-order history, the 7-day metrics panel and "A rider is already being asked". Overview has the needs-attention tile; order detail has the dispatch history. Fixed here: `admin-dispatch.test.ts` still expected "Sent to N riders" (now "Asking N riders now"; added live-offer, new-key bounds and ring-order refusal cases).
  - Vendor (new): `lib/vendor/{dispatch-progress,prep-estimate,use-now}.ts` (+ tests), `lib/vendor/self-delivery.ts` (state now carries `engineState, expectedReadyAt, startAt, assignedEtaAt, asOfMs`; a P0429 without a retry time drops any `function_name: ` prefix), `lib/vendor/delivery-info.ts` (also reads the state of orders that already have a rider, so "Rider arriving in about N min" works), `app/actions/vendor-delivery.ts` (`updatePrepEstimateAction`: DAL gate, zod 1-180, own session client, P0429/23514/42501 mapped), `(vendor)/_components/{NoRiderBanner,DeliverySection,PrepEstimateControl}.tsx`, the orders list/detail pages (no longer select `rider_id`). Copy: "Finding a rider: asking riders one at a time, nearest first.", "Food expected ready at HH:MM", "Rider search starts around HH:MM", "Rider arriving in about N min". "Need more time?" (+5/+10/+15 from the current estimate, or "ready in N minutes") shows only for accepted/preparing rider-delivery orders. "Look further away" is hidden until the search has started (planned start time passed, or the order is ready); the two earlier e2e fixes hold (the banner stays mounted while any dispatch state exists and keeps its result line; the countdown logic is untouched).
  - Config: `apps/web/eslint.config.mjs` now ignores `.next-*/**` (it was linting the e2e/build-check output, about 15,000 findings); `.next-build-check/` added to `.gitignore`. Build recipe: `NEXT_DIST_DIR=.next-build-check pnpm --filter web build` (read by `next.config.ts`).
  - Customer: no code change; nothing in the customer app reads `dispatch_offers` or the offer statuses.
  - Backend gaps: (1) the vendor view has only `assigned_eta_at` (the first ETA), not `current_eta_at`, so "Rider arriving in about N min" does not follow the live ETA refresh; exposing `current_eta_at` in `_vendor_dispatch_view` would fix that. (2) `vendor_dispatch_state` has no vendor-facing "currently asking rider N" detail, so the vendor sees one generic searching line.
  - Verification (apps/web): `tsc --noEmit` clean; eslint 0 errors, 12 warnings (all pre-existing unused-import warnings in customer/onboarding/history files); vitest 56 files / 679 tests passed (was 51 / 623 with 2 failing at the start); `next build` (`NEXT_DIST_DIR=.next-build-check`) compiled, TypeScript finished, 48/48 static pages generated.

- **Sprint 4B (e2e cycle)** - `apps/web/e2e` only (no `supabase/` or app source change). Isolated stack `kiakia-e2ecycle` (ports 58320+), migrations 0001-0108 replayed from scratch; `e2e:cycle:down` run, no e2ecycle containers left.
  - Before (old specs on the new backend, same stack): 27 passed / 3 failed / 11 did not run (the failure of full-cycle 5c skipped 6a-9b). Failures: full-cycle 5c (expected both riders to hold an offer: one live offer, the nearest), zz test 2 (heading "How far from the store we look for riders" is now "First search distance"), admin-forms test 2 (link click did not navigate; passed on an immediate re-run, not a dispatch issue: a cold-start click before hydration while the app had just been built and started; recorded as flaky, see below).
  - After, whole suite, two runs each on a freshly replayed stack: **44 passed / 0 failed both times** (admin-forms 2, full-cycle 27, messages 9, yy-sequential-dispatch 3, zz-dispatch-visibility 3), 6.1 min and 5.0 min. The suite had 41 tests before (the earlier report counted 37 + 3; the old specs as found on this stack: admin-forms 2, full-cycle 27, messages 9, zz 3) and has 44 now: +3 are the new spec, no test was removed.
  - The tick is REAL on the e2e stack: pg_cron `dispatch-tick` (5 s) is scheduled and ran (cron.job active, runs succeeded). No spec depends on its second: `support/dispatch.ts` `advanceUntil` polls, and only after 20 s past the due time calls `sweep_dispatch_offers()` (a `cron-fallback` annotation is recorded when it did). Proved both ways: with the cron job unscheduled the decline test still passes (1.3 m: the 45 s offer time plus the 20 s grace, fallback path used; the decline itself advanced with no tick, because the next-rider assertion has a 5 s window and passed), with the cron on the lapses happen by themselves.
  - Spec changes (old -> new). Nothing was deleted without an equivalent:
    - full-cycle 5b: rider locations swapped so rider 2 is the NEAREST (rider 1 ~310 m, rider 2 ~160 m); added `retireStaleDispatchOrders` (see below), the offer time set to 15 s (service role `admin_set_dispatch_setting`, restored to 45 in afterAll), and assertions that a preparing order is `scheduled` (no offers although two riders are online, `start_at` in the future).
    - full-cycle 5c: "offers to BOTH riders, all `offered`" -> exactly ONE offer (rider 2, cycle 1, attempt 1, unexpired); RLS: rider 2 sees only its live offer, rider 1 sees nothing, cannot read the details and cannot accept; new vendor-UI assertion "Finding a rider: asking riders one at a time, nearest first." on the order page and no "Need more time?" once ready.
    - full-cycle 6a: "rider 2 declines, rider 1's offer is back-dated and `sweep_dispatch_offers()` re-offers it (expires_at update)" -> the nearest rider declines and the next one holds the live offer within 5 s with no tick (decline -> attempt 2); that offer is left to lapse for real (15 s, cron tick) and a NEW round asks the same rider again (attempt 3, cycle 2, the decliner is never re-asked); a declined rider still cannot accept. The back-dating is gone on purpose: `dispatch_offers.expires_at` is immutable (0100 guard).
    - full-cycle 6b: same accept/notify/tracking assertions, plus the offer rows end `declined, expired, accepted` with no live offer left.
    - zz-dispatch-visibility: radius card heading "How far from the store we look for riders" -> "First search distance"; beforeAll retires stale orders; test 1 additionally asserts nobody is asked (no offer rows, "Being asked now: Nobody right now"); test 2 asserts one offer (rider 1, attempt 1), the new banner line "Finding a rider: asking riders one at a time, nearest first." after "Look further away", and keeps the two UI regressions (the result line "Sent to 1 rider." still shown after the state moves on, also after a reload) and now also the countdown: after the rider declines and nobody else can be asked, the banner returns with a disabled "Look further away (try again in M:SS)" whose seconds tick down by themselves. Test 3 unchanged.
    - NEW `cycle/yy-sequential-dispatch.spec.ts` (3 tests): (c) Settings > Rider matching saves "Offer time (seconds)" (5 is refused with Save disabled, 15 saved, shown in "Recent rider matching changes"); (a)(d) a preparing order is `scheduled` with `start_at = max(expected ready - travel - buffer, accepted_at)` from the stored basis, the vendor sees "Food expected ready at" / "Rider search starts around", admin lists it under "Search starts later", "Need more time?" +10 min moves both lines without a reload, "ready in 1 minute" starts the search at the predicted time while the order is still `preparing`, ONE rider (the nearest) is asked, accepts early, ready makes it `rider_assigned`, delivery completes and the rider's escrow release equals `rider_fee_kobo`; (b)(c) decline -> next rider asked at once, `/admin/dispatch` and `admin_dispatch_status` show `waiting_for_rider_reply` with the new rider, the per-order history lists both riders with Declined / Waiting for an answer, a lapse adds "No answer in time" and a second round, the history ends in "Accepted", the second rider completes the delivery.
  - Stack hygiene found: the stack outlives a run and the cron keeps retrying orders a failed earlier run left waiting, which then take this run's riders (a rider holding a live offer elsewhere is skipped). `retireStaleDispatchOrders()` (service role, sets those orders `cancelled_by_platform`) runs in the beforeAll of every dispatch spec. Also `yy` finishes its deliveries so no rider is left holding an order.
  - README (`apps/web/e2e/README.md`) updated: sequential steps, the real scheduler, the new spec.
  - Not proved by a mutation: the new assertions were not run against the OLD simultaneous engine (it no longer exists on this stack); the evidence that they can fail is the "before" run (the old 5c assertion failed against the new engine) and that the single-offer / immediate-next-rider assertions are checked with the DB's own rows. The `cron-fallback` annotation is not visible in the list reporter.
  - Flaky: admin-forms test 2 failed once in the first (cold) run and in a second isolated run its `beforeAll` timed out at 120 s while the app was being rebuilt/started next to it; both passed when re-run against already-running servers, and passed in both final runs. Not a dispatch issue.
  - App bugs found: none. Test-id additions in app source: none.

- **0109 (review fixes)** - `supabase/migrations/0109_dispatch_review_fixes.sql`, test `supabase/tests/dispatch_review_fixes.sql` (111 ok / 0 not ok). From a security review and a production audit; the deploy runbook, rollback note and current test numbers are in sections 6 and 7.
  - Vendor Accept: `_dispatch_sync_status` wraps `_dispatch_start_calc` in begin/exception; on any failure `start_at` = expected ready - default travel - secure buffer (never before accepted_at), `start_basis.fallback = true`, event `start_calc_failed {sqlstate, error}`. Errors are caught; a slow estimate is not interruptible from inside a function (0108's scan is ms-scale).
  - Busy outcome: `_dispatch_advance` returns `busy` when the scan returned candidates but none could be asked (rider row locked, or the under-lock re-check failed). New column `order_dispatch.busy_count`; busy retries in 5 s, logs `dispatch_busy {busy_count, locked, rejected, ring, stage, limit}`, and does NOT write the funnel row, the vendor "no rider nearby" notice, needs_attention, or move ring/cycle. After 3 consecutive busy results (constant `v_busy_max`; 3 ticks = 15 s outlasts any transient row lock, so a third in a row means a persistent cause) the next pass examines 25 candidates per step instead of 5 (the old limit of 5 meant riders beyond an unavailable top five were never reachable), skipping every unavailable rider; if that still finds nobody the normal fall-through applies (next cycle / no-candidates path, so the 30-minute give-up stays reachable) and the counter resets. Offers reset it too.
  - Parity guard: besides the 0108 block in `dispatch_engine.sql`, `dispatch_review_fixes.sql` compares the scan (KNN and rings) with `_dispatch_rider_available` / `_dispatch_rider_excluded` over 20 riders in distinct states (busy in each of accepted/preparing/rider_assigned/picked_up/arrived/in_transit, deleted profile, rejected/pending kyc, revoked / declined-older-cycle / this-cycle offers, 295 s vs 310 s ping, live offer elsewhere, lapsed-but-still-offered, offline, no location).
  - Legacy wrappers (`sweep_dispatch_offers`, `dispatch_orders_nearing_prep_completion`): batch 100 -> 10, tests/manual only. `dispatch_tick` is the real worker and commits after every order (verified). The concurrency scenario 8 was adapted (drain sweeps) because two sweeps can no longer finish 16 orders.
  - Hygiene: `_dispatch_worker_caller_ok` search_path pinned; execute revoked from anon on `accept_dispatch_offer` / `decline_dispatch_offer` (the rider app calls them with the rider's authenticated session; both start with `auth.uid()`), and from public/anon/authenticated on the trigger function `dispatch_order_to_nearby_riders` (firing a trigger does not check EXECUTE). `get_rider_offer_details` still has an anon grant (it authorises through `auth.uid()`; not changed here).
  - Rate limit: kept, documented as best-effort (the smaller safe change; see Sprint 1d).
  - `admin_dispatch_health()` (service_role, read-only, STABLE SECURITY DEFINER): `{cron_available, tick_job_present, tick_last_run_at, tick_last_status, tick_overdue_seconds, oldest_overdue_next_check_seconds, orders_overdue, worker_secrets_present, queued_push_oldest_seconds, healthy, problems[]}`. `tick_overdue_seconds` is now minus the end of the last SUCCESSFUL `dispatch-tick` run (null when none in `cron.job_run_details`, which is pruned daily); `orders_overdue` / `oldest_overdue...` use the same predicate (live state, `next_check_at < now()`); healthy = job active and last success <= 30 s and oldest overdue <= 60 s and both Vault secrets present (names only, `vault.secrets`). Not part of `healthy`, only reported: `queued_push_oldest_seconds` (all channels, age of the oldest `queued` row). The cron-schema-absent branch is guarded by `to_regclass` + an exception handler but could not be exercised in pgTAP (renaming the `cron` schema needs ownership); `packages/db/src/generated.ts` was updated by hand (`admin_dispatch_health`, `order_dispatch.busy_count`, two event names).
  - One-off `_dispatch_reschedule_unstarted()` (internal, run once by the migration): re-plans orders the 0100 backfill left `searching` with no start (see section 6).
  - CI: `supabase test db` now gets the explicit top-level file list; `node --test` for the Edge Function helpers; a `concurrency` job runs the harness at scale 0.25 (not yet seen on a hosted runner; the manual full-scale requirement is in the harness README). The secret-leak grep gate allows `apps/web/src/lib/monnify.ts` only for lines of the form `serverEnv.MONNIFY_API_SECRET` (narrow pattern, not a path exclusion); it passes today; it does not scan `supabase/functions`.
