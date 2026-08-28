-- KiaKia — let a vendor delete a menu item that's only sitting in someone's
-- (mutable, pre-purchase) cart.
--
-- cart_items.menu_item_id had no ON DELETE clause (0004_ordering.sql), so
-- deleting a menu_items row failed outright (23503, foreign_key_violation)
-- the moment *any* customer had ever added it to an open cart — and
-- deleteMenuItemAction (apps/web/src/app/actions/menu.ts) never checked the
-- delete's own error, so the failure was silent: the vendor clicked
-- delete, nothing happened, and there was no indication why.
--
-- order_items.menu_item_id is deliberately left untouched (still RESTRICT)
-- — unlike a cart, an order is a historical receipt (see menu_items' own
-- table comment: "a vendor editing a menu must never mutate a historical
-- receipt"), so an item that has actually been ordered still can't be
-- hard-deleted; deleteMenuItemAction now surfaces that specific case as a
-- clear "mark unavailable instead" error rather than swallowing it.
--
-- The constraint is looked up rather than named literally since it was
-- never given an explicit name in 0004_ordering.sql — safer than assuming
-- Postgres's default-naming output matches exactly.

do $$
declare
  fkey_name text;
begin
  select conname into fkey_name
  from pg_constraint
  where conrelid = 'cart_items'::regclass
    and confrelid = 'menu_items'::regclass
    and contype = 'f';

  execute format('alter table cart_items drop constraint %I', fkey_name);
end $$;

alter table cart_items
  add constraint cart_items_menu_item_id_fkey
  foreign key (menu_item_id) references menu_items (id) on delete cascade;
