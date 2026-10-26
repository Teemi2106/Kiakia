-- 0106: drop the cycle_no / attempt_no default shim on dispatch_offers.
--
-- 0100 added NOT NULL cycle_no / attempt_no columns plus a BEFORE INSERT shim
-- (dispatch_offers_default_numbers) that filled them for any writer that did not
-- set them. Every production writer now sets both explicitly (_dispatch_advance in
-- 0101, admin_reassign_order_rider in 0102; verified against the live function
-- bodies) and every pgTAP fixture was rewritten in the sequential-dispatch test
-- sprint to set them as well. With the shim gone, an insert that omits either
-- column fails with a NOT NULL violation instead of silently guessing numbers.
-- The columns are already NOT NULL (0100); nothing else changes.

drop trigger if exists dispatch_offers_default_numbers on dispatch_offers;
drop function if exists _dispatch_offers_default_numbers();
