-- Give each rider batch one minute to accept before dispatch advances to the
-- next eligible batch. The sweep still runs every 15 seconds, so an expired
-- offer is normally processed within roughly 0-15 seconds after this TTL.
--
-- _dispatch_offer_ttl() is the single source introduced by 0076 and is used
-- both for brand-new dispatch_offers rows and when an expired offer is
-- reopened in a later dispatch cycle.

create or replace function _dispatch_offer_ttl()
returns interval
language sql
immutable
parallel safe
as $$ select interval '60 seconds' $$;

comment on function _dispatch_offer_ttl() is
  'Single source for how long a dispatch offer stays live: 60 seconds. Used by the dispatch_offers.expires_at default and by the re-open path in _dispatch_offer_batch().';

-- Re-apply the expression so schema inspection also clearly reflects the
-- current TTL source. Existing live offers retain their original expires_at;
-- every offer created or reopened after this migration uses one minute.
alter table dispatch_offers
  alter column expires_at set default (now() + _dispatch_offer_ttl());

comment on column dispatch_offers.expires_at is
  'Offer expiry timestamp. Defaults to 60 seconds after creation via _dispatch_offer_ttl(); expired offers are processed by sweep_dispatch_offers(), which runs every 15 seconds.';
