-- KiaKia - dispatch_offers was never added to the supabase_realtime
-- publication.
--
-- 0019_rider_dispatch.sql's own table comment on dispatch_offers says: "The
-- rider app detects 'you have a new offer' by subscribing to
-- postgres_changes on this table filtered to rider_id = its own
-- auth.uid(), or by polling its own rows." 0026_rider_self_service.sql then
-- added `orders` and `order_rider_locations` to supabase_realtime for the
-- customer tracking map, and 0038_customer_notifications.sql added
-- `notifications` - but nothing, ever, added `dispatch_offers`. A
-- Postgres Changes subscription against a table that is not a member of
-- the publication simply never fires - no error, no rows, nothing - so
-- the rider app's documented primary detection mechanism for a new offer
-- has been silently inert since 0019 shipped. (The rider app can still
-- discover an offer by polling, which 0019's own comment allows for, but
-- the realtime path this migration fixes is the one actually described as
-- the mechanism.)
--
-- Fix: add dispatch_offers to supabase_realtime, using the same defensive
-- idempotent `do $$ ... if not exists (select 1 from pg_publication_tables
-- ...) $$` pattern 0026_rider_self_service.sql uses for orders /
-- order_rider_locations - not 0038's bare `alter publication ... add
-- table`, which errors outright if the table happens to already be a
-- member (e.g. added out-of-band via the Supabase dashboard, or a second
-- run of this migration set against an environment configured some other
-- way already). 0038's own migration got away with the bare form only
-- because nothing had touched `notifications` before it; that is not
-- something a new migration should rely on being true again.
--
-- REPLICA IDENTITY - deliberately left at its default (not set to FULL)
-- here, after actually reasoning about it rather than defaulting to the
-- "just turn it on" answer:
--
-- What the rider app needs is to see its own offer flip status (e.g.
-- 'offered' -> 'expired' when accept_dispatch_offer()/sweep_dispatch_offers()
-- lazily/proactively expires it, or 'offered' -> 'accepted' when another
-- concurrent accept wins the race) via an UPDATE event, filtered by
-- `rider_id = auth.uid()` at the Realtime layer. REPLICA IDENTITY only
-- controls what Postgres includes for the OLD row image on UPDATE/DELETE in
-- the logical replication stream - the NEW row image for an UPDATE is
-- always the complete, current row regardless of REPLICA IDENTITY, because
-- that is simply the row as it now exists on disk, not a diff. Realtime's
-- RLS-based authorization for postgres_changes evaluates the table's
-- policies against that NEW row for INSERT/UPDATE events - and
-- dispatch_offers' "rider reads own offers" policy (0019) only needs
-- rider_id, which is always present in the NEW row - so the default
-- identity is already sufficient for every UPDATE event this migration's
-- own reasoning cares about.
--
-- REPLICA IDENTITY FULL would only matter here for a DELETE event (to
-- evaluate RLS against the OLD row, since DELETE has no NEW row at all) or
-- for a consumer that wants the pre-update column values. dispatch_offers
-- rows are never deleted anywhere in this schema (checked: no `delete from
-- dispatch_offers` exists in any migration - rows are only inserted and
-- updated, status moves forward through offered -> accepted/expired/
-- declined and stays there), and no consumer needs the old status value,
-- only the current one. This is the exact same reasoning
-- 0026_rider_self_service.sql already applied (without spelling it out) to
-- `orders` and `order_rider_locations`, both of which are also RLS-filtered
-- on non-primary-key columns (customer_id/rider_id) for UPDATE events and
-- neither of which sets REPLICA IDENTITY FULL - this migration does not
-- introduce a new, inconsistent posture, it follows the one already
-- established.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dispatch_offers'
  ) then
    alter publication supabase_realtime add table dispatch_offers;
  end if;
end $$;
