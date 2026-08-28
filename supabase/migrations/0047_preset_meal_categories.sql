-- KiaKia — preset meal categories.
--
-- menu_categories.name used to be free text a vendor typed at creation time,
-- so one vendor's "Swallow" and another's "Local Foods" were the same thing
-- under different labels. Replaced with category_key, constrained to a
-- fixed preset list (packages/domain/src/meal-categories.ts is the single
-- source of truth for the key set/labels — keep both in sync by hand, same
-- convention as vendors.category's CATEGORIES const in
-- VendorOnboardingForm.tsx).
--
-- Clean cut, not a backfill: no real vendor category data exists yet
-- (pre-launch — supabase/seed.sql's only row is the placeholder "Menu"), so
-- `name` is dropped outright rather than best-effort matched to a preset.

alter table menu_categories drop column name;

alter table menu_categories add column category_key text;

update menu_categories set category_key = 'combo_meals' where category_key is null;

alter table menu_categories alter column category_key set not null;

alter table menu_categories add constraint menu_categories_category_key_check
  check (category_key in (
    'swallow',
    'soups',
    'rice_dishes',
    'proteins_grills',
    'small_chops_snacks',
    'pastries_bakery',
    'drinks',
    'combo_meals'
  ));

-- A vendor can add a given preset category to their own menu only once.
alter table menu_categories add constraint menu_categories_vendor_category_key_unique
  unique (vendor_id, category_key);
