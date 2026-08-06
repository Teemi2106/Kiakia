-- Local development seed data only. Run automatically by `supabase db reset`.
-- Never applied to staging/production (those get real vendor/rider data
-- through normal onboarding, not this file).
--
-- Intentionally NOT seeding the real Jabi-Utako polygon here: real launch
-- geography needs the §15 validation gate (five vendor commitments, ten
-- rider interviews, three timed deliveries) run first, and the actual
-- surveyed coordinates. Seeding a fabricated polygon under that name would
-- be worse than seeding nothing — it would look authoritative and isn't.
-- What follows is a clearly-synthetic square so local development has
-- something to test area-containment checkout logic against.

insert into service_areas (name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, free_above_kobo)
values (
  'Synthetic Dev Area (not a real launch polygon)',
  st_geogfromtext('POLYGON((7.4 9.0, 7.5 9.0, 7.5 9.1, 7.4 9.1, 7.4 9.0))'),
  true,
  50000,  -- ₦500 base delivery fee
  15000,  -- ₦150 per km
  1000000 -- free delivery above ₦10,000
);
