-- KiaKia: expand the preset meal categories from 8 to 14.
--
-- packages/domain/src/meal-categories.ts is the source of truth for the key set
-- and labels; keep the CHECK constraint below in sync with it by hand.
--
-- Existing rows are remapped, not dropped:
--   proteins_grills   -> proteins_meat
--   small_chops_snacks-> snacks_small_chops
--   combo_meals       -> swallow_soup_combos
--   pastries_bakery   -> snacks_small_chops (no pastry category in the new list)
-- (vendor_id, category_key) is unique, so a vendor who ends up with two rows
-- for the same new key has the duplicate's items moved onto the survivor and
-- the duplicate deleted, rather than failing the whole migration.

alter table menu_categories drop constraint menu_categories_category_key_check;

update menu_categories set category_key = 'proteins_meat'      where category_key = 'proteins_grills';
update menu_categories set category_key = 'swallow_soup_combos' where category_key = 'combo_meals';

-- Both of these land on snacks_small_chops, which can collide per vendor.
update menu_items mi
   set category_id = keep.id
  from menu_categories old
  join menu_categories keep
    on keep.vendor_id = old.vendor_id and keep.category_key = 'snacks_small_chops'
 where mi.category_id = old.id
   and old.category_key in ('small_chops_snacks', 'pastries_bakery')
   and old.id <> keep.id;

-- Vendors with no snacks row yet: promote one old row to it.
update menu_categories mc
   set category_key = 'snacks_small_chops'
 where mc.id in (
   select distinct on (vendor_id) id
     from menu_categories
    where category_key in ('small_chops_snacks', 'pastries_bakery')
      and not exists (
        select 1 from menu_categories k
         where k.vendor_id = menu_categories.vendor_id and k.category_key = 'snacks_small_chops'
      )
    order by vendor_id, (category_key = 'small_chops_snacks') desc, sort_order
 );

-- Whatever is left of the two old keys is a duplicate whose items moved above.
update menu_items mi
   set category_id = keep.id
  from menu_categories old
  join menu_categories keep
    on keep.vendor_id = old.vendor_id and keep.category_key = 'snacks_small_chops'
 where mi.category_id = old.id
   and old.category_key in ('small_chops_snacks', 'pastries_bakery');

delete from menu_categories where category_key in ('small_chops_snacks', 'pastries_bakery');

alter table menu_categories add constraint menu_categories_category_key_check
  check (category_key in (
    'swallow',
    'soups',
    'rice_dishes',
    'beans_dishes',
    'pasta_noodles',
    'swallow_soup_combos',
    'proteins_meat',
    'snacks_small_chops',
    'breakfast',
    'grills_bbq',
    'fast_food',
    'sides',
    'drinks',
    'local_specials'
  ));
