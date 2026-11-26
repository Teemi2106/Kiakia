-- New stores start with the widest delivery distance available in KiaKia.
-- Existing store distances are preserved because a saved short distance may
-- be an intentional operating choice rather than the old 3 km default.
alter table public.vendors
  alter column delivery_radius_m set default 20000;

comment on column public.vendors.delivery_radius_m is
  'Maximum straight-line delivery distance from the kitchen in metres. New stores default to 20 km; checkout also requires the customer address to be inside an active KiaKia service area.';
