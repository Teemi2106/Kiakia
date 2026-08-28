-- Plain lat/lng reads for addresses.location, for the checkout map showing
-- the customer's delivery address alongside the vendor pin. Mirrors
-- vendors.location_lat/location_lng (0037_vendor_location_lat_lng.sql) and
-- get_order_tracking()'s st_y()/st_x() conversion (0029_order_tracking.sql)
-- — generated columns rather than a new RPC, since `addresses` is already
-- fully selectable by its owning customer (0007_rls.sql's "manage own
-- addresses" policy), so these ride along on every existing addresses read
-- with no other grant needed.
alter table addresses
  add column location_lat double precision generated always as (st_y(location::geometry)) stored,
  add column location_lng double precision generated always as (st_x(location::geometry)) stored;
