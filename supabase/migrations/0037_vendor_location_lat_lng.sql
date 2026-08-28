-- Plain lat/lng reads for vendors.location, for the Delivery Zone map (the
-- vendor's own store location on a real map, replacing the static
-- "Kitchen Location" placeholder). Mirrors get_order_tracking()'s
-- st_y()/st_x() conversion (0029_order_tracking.sql) but as generated
-- columns rather than a new RPC — `vendors` SELECT is already granted to
-- `authenticated` (0007_rls.sql only revokes insert/update/delete), so
-- these ride along on every existing `select("*")` against vendors
-- (getVendorForCurrentUser(), the customer storefront) with no other code
-- change required. Stored, not virtual, so they're indexable/filterable
-- like any other column; ::geometry cast is required because PostGIS has
-- no direct geography overload for st_x/st_y, same reasoning as 0029.
alter table vendors
  add column location_lat double precision generated always as (st_y(location::geometry)) stored,
  add column location_lng double precision generated always as (st_x(location::geometry)) stored;
