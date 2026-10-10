-- KiaKia - fixes a live data bug found while manually testing checkout:
-- Kunfat's "Takeaway Pack" option group has is_required = true and
-- min_select = 0, so a customer could confirm an order with no takeaway
-- pack chosen even though the vendor marked it required.
--
-- Root cause: is_required and min_select (0003_catalog.sql) are two
-- independent columns with no constraint tying them together, and the
-- vendor's menu form (OptionGroupsBuilder.tsx) let them be set
-- independently too - checking "Required" never touched min_select, which
-- defaults to 0. The customer-facing checkout gate only ever read
-- min_select, so a group could read "REQUIRED" in the UI while actually
-- enforcing nothing.
--
-- Three-layer fix, this migration being the data-integrity layer:
--   1. Backfill every existing row already in this state.
--   2. A check constraint so it can never happen again, at the source,
--      regardless of what any future client does.
--   (3. The vendor form and the customer checkout gate were fixed
--       separately, client-side - see OptionGroupsBuilder.tsx and
--       ItemOptionsSheet.tsx. This migration does not depend on either.)

update option_groups
set min_select = 1
where is_required and min_select = 0;

alter table option_groups
  add constraint option_groups_required_has_min_select
  check (not is_required or min_select >= 1);

comment on constraint option_groups_required_has_min_select on option_groups is
  'A required option group must actually require at least one selection. Without this, is_required and min_select could drift independently (both are plain columns with no other link between them) and a customer could confirm checkout having skipped a group the vendor marked required - see 0060''s own header for the real order this happened on.';
