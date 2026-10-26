// Committed fixtures for the concurrency scenarios (real races need committed rows).
// Everything is created through the postgres role (like the pgTAP fixtures in
// supabase/tests/dispatch_*.sql), under unique ids, and removed again by cleanup().
//
// Geometry (as in dispatch_rpcs.sql): the base vendor sits at (lat 9.5, lng 7.5); a rider
// with east = n sits n x 0.001 degrees (about 110 m) east of it. Big orders fund any rider.
import { randomUUID } from "node:crypto";

export const BASE = { lat: 9.5, lng: 7.5 };
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

export class Fixtures {
  /** @param admin Sess connected as postgres */
  constructor(admin) {
    this.admin = admin;
    this.run = randomUUID().slice(0, 8);
    this.seq = 0;
    this.base = null;
    this.reset();
  }

  reset() {
    this.users = [];
    this.riders_ = [];
    this.orders = [];
    this.vendors = [];
  }

  q(sql, params) {
    return this.admin.q(sql, params);
  }

  /** Once per run: service area, customer, vendor owner, admin, and a base vendor. */
  async init() {
    if (this.base) return this.base;
    const area = randomUUID();
    await this.q(
      `insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
       values ($1, $2, st_geogfromtext('POLYGON((0 0, 20 0, 20 20, 0 20, 0 0))'), true, 50000, 15000, 50000, 15000)`,
      [area, `CONC ${this.run}`],
    );
    const customer = await this.rawUser("cust", { track: false });
    const owner = await this.rawUser("owner", { track: false });
    const admin = await this.rawUser("admin", { track: false });
    await this.q(`insert into user_roles (user_id, role) values ($1, 'admin') on conflict do nothing`, [admin]);
    this.base = { area, customer, owner, admin, vendor: null };
    this.base.vendor = await this.vendor(BASE.lat, BASE.lng, { track: false });
    return this.base;
  }

  async rawUser(label, { track = true, phone = null } = {}) {
    const id = randomUUID();
    const email = `conc-${this.run}-${label}-${++this.seq}@example.test`;
    await this.q(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ($1, $2, 'authenticated', 'authenticated', $3, '', now(),
               '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now())`,
      [id, EMPTY_UUID, email],
    );
    if (phone) await this.q(`update profiles set phone = $2 where id = $1`, [id, phone]);
    if (track) this.users.push(id);
    return id;
  }

  async vendor(lat, lng, { track = true } = {}) {
    const b = this.base ?? (await this.init());
    const id = randomUUID();
    const slug = `conc-${this.run}-${++this.seq}`;
    await this.q(
      `insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins)
       values ($1, $2, $3, $4, 'active', st_geogfromtext($5), 1500, 20000, 20)`,
      [id, b.owner, `CONC V ${slug}`, slug, `POINT(${lng} ${lat})`],
    );
    await this.q(
      `insert into vendor_staff (vendor_id, user_id, role) values ($1, $2, 'vendor_owner') on conflict do nothing`,
      [id, b.owner],
    );
    if (track) this.vendors.push(id);
    return id;
  }

  /**
   * KYC-approved, online, freshly pinged riders, created set-based in two statements.
   * specs: [{east,north,lat,lng,online,kyc,pingAgoSec,phone}] ; position either {lat,lng} or {east,north}
   * in units of 0.001 degrees from the BASE vendor. Returns the user ids in spec order.
   */
  async riders(specs) {
    if (!specs.length) return [];
    const ids = specs.map(() => randomUUID());
    const emails = ids.map((_, k) => `conc-${this.run}-rider-${++this.seq}-${k}@example.test`);
    await this.q(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       select i, $3::uuid, 'authenticated', 'authenticated', e, '', now(),
              '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
       from unnest($1::uuid[], $2::text[]) as t(i, e)`,
      [ids, emails, EMPTY_UUID],
    );
    this.users.push(...ids);
    const phones = specs.map((s) => (s.phone ? `+23480${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` : null));
    if (phones.some(Boolean)) {
      await this.q(`update profiles p set phone = t.ph from unnest($1::uuid[], $2::text[]) as t(i, ph) where p.id = t.i and t.ph is not null`, [ids, phones]);
    }
    const wkt = specs.map((s) => `POINT(${s.lng ?? BASE.lng + (s.east ?? 1) * 0.001} ${s.lat ?? BASE.lat + (s.north ?? 0) * 0.001})`);
    await this.q(
      `insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
       select i, o, k, st_geogfromtext(w), now() - make_interval(secs => a)
       from unnest($1::uuid[], $2::boolean[], $3::text[], $4::text[], $5::float8[]) as t(i, o, k, w, a)`,
      [ids, specs.map((s) => s.online ?? true), specs.map((s) => s.kyc ?? "approved"), wkt, specs.map((s) => s.pingAgoSec ?? 0)],
    );
    this.riders_.push(...ids);
    return ids;
  }

  async rider(spec = {}) {
    return (await this.riders([spec]))[0];
  }

  /**
   * An order of the base vendor (or `vendor`). status 'ready_for_pickup' = the ready path;
   * 'preparing' (accepted long ago so it is already due) = the early-accept path.
   */
  async order({ vendor, status = "ready_for_pickup", paid = true, rider = null, readyAgoSec = 0, acceptedAgoSec, small = false } = {}) {
    const b = this.base ?? (await this.init());
    const id = randomUUID();
    const ready = status === "ready_for_pickup";
    const accAgo = acceptedAgoSec ?? (ready ? readyAgoSec : 3600);
    await this.q(
      `insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo,
                           service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at,
                           accepted_at, first_dispatched_at, delivery_by)
       values ($1, $2, $3, $4, $5, $6, $7, 50000, $8, 0, $9, '{"line1": "1 Conc Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
               $10, case when $11 then now() - make_interval(secs => $12) end, now() - make_interval(secs => $13),
               case when $11 then now() - make_interval(secs => $12) end, 'rider')`,
      [
        id,
        b.customer,
        vendor ?? b.vendor,
        b.area,
        status,
        paid ? "paid" : "pending",
        small ? 100000 : 5000000,
        small ? 10000 : 100000,
        small ? 160000 : 5150000,
        rider,
        ready,
        readyAgoSec,
        accAgo,
      ],
    );
    this.orders.push(id);
    return id;
  }

  /** Engine entry as the ready trigger / tick would call it. */
  async advance(orderId, trigger = "test") {
    const { rows } = await this.q(`select _dispatch_advance($1, $2, false) as r`, [orderId, trigger]);
    return rows[0].r;
  }

  async liveOffer(orderId) {
    const { rows } = await this.q(`select * from dispatch_offers where order_id = $1 and status = 'offered'`, [orderId]);
    return rows[0] ?? null;
  }

  async offers(orderId) {
    const { rows } = await this.q(`select * from dispatch_offers where order_id = $1 order by attempt_no`, [orderId]);
    return rows;
  }

  /**
   * An offer that is already past its expiry when inserted (offered_at/expires_at are immutable, so
   * a lapsed offer is inserted as one, same as pg_temp.lapse_live in the pgTAP suites).
   * Also wakes the order for the tick (next_check_at) by creating/adjusting its state row.
   */
  async lapsedOffer(orderId, riderId, { cycle = 1, attempt = 1, status = "offered", expiredAgoSec = 1 } = {}) {
    const { rows } = await this.q(
      `insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at, responded_at, close_reason)
       values ($1, $2, $3, $4, $5, now() - interval '3 minutes', now() - make_interval(secs => $6),
               case when $3 = 'offered' then null else now() - interval '1 minute' end,
               case when $3 = 'offered' then null when $3 = 'expired' then 'timeout' else null end)
       returning id`,
      [orderId, riderId, status, cycle, attempt, expiredAgoSec],
    );
    return rows[0].id;
  }

  /** A live offer with a normal ttl, inserted directly (engine-bypassing, for forced multi-hold fixtures). */
  async directLiveOffer(orderId, riderId, { cycle = 1, attempt = 1, ttlSec = 45 } = {}) {
    const { rows } = await this.q(
      `insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, expires_at)
       values ($1, $2, 'offered', $3, $4, now() + make_interval(secs => $5)) returning id`,
      [orderId, riderId, cycle, attempt, ttlSec],
    );
    return rows[0].id;
  }

  /** Make the order's state row due for the tick (without touching the offer). */
  async makeDue(orderId) {
    await this.q(`update order_dispatch set next_check_at = now() - interval '1 second' where order_id = $1`, [orderId]);
  }

  async setSetting(key, value) {
    const { rows } = await this.q(`select value_int from platform_settings where key = $1`, [key]);
    await this.q(`update platform_settings set value_int = $2 where key = $1`, [key, value]);
    return Number(rows[0].value_int);
  }

  /** Remove everything this iteration created. Event rows are append-only and stay (no FK; unique ids). */
  async cleanup() {
    const o = this.orders;
    const r = this.riders_;
    const u = this.users;
    const v = this.vendors;
    const steps = [
      [`delete from message_outbox where recipient_user_id = any($1) or dedupe_key in (select 'offer:' || id || ':push' from dispatch_offers where order_id = any($2))`, [u, o]],
      [`delete from dispatch_offers where order_id = any($1)`, [o]],
      [`delete from dispatch_attempts where order_id = any($1)`, [o]],
      [`delete from notifications where order_id = any($1)`, [o]],
      [`delete from rider_notifications where order_id = any($1) or rider_id = any($2)`, [o, r]],
      [`delete from order_events where order_id = any($1)`, [o]],
      [`delete from order_rider_locations where order_id = any($1)`, [o]],
      [`delete from orders where id = any($1)`, [o]],
      [`delete from rider_offer_responses where rider_id = any($1)`, [r]],
      [`delete from riders where user_id = any($1)`, [r]],
      [`delete from vendor_staff where vendor_id = any($1)`, [v]],
      [`delete from vendors where id = any($1)`, [v]],
      [`delete from auth.users where id = any($1)`, [u]],
    ];
    const problems = [];
    for (const [sql, params] of steps) {
      try {
        await this.q(sql, params);
      } catch (e) {
        problems.push(`${sql.slice(0, 40)}: ${e.message}`);
      }
    }
    // a failed delete must not leave a fixture rider dispatchable for the next iteration
    if (r.length) await this.q(`update riders set is_online = false where user_id = any($1)`, [r]).catch(() => {});
    this.reset();
    return problems;
  }

  /** Remove rows left by an earlier run that crashed (everything the harness creates is recognisable by name). */
  async purgeLeftovers() {
    const q = async (sql) => (await this.q(sql)).rows.map((r) => r.id);
    this.vendors = await q(`select id from vendors where slug like 'conc-%'`);
    this.orders = await q(`select id from orders where vendor_id = any(array(select id from vendors where slug like 'conc-%'))`);
    this.users = await q(`select id from auth.users where email like 'conc-%@example.test'`);
    this.riders_ = await q(`select user_id id from riders where user_id = any(array(select id from auth.users where email like 'conc-%@example.test'))`);
    const n = { orders: this.orders.length, riders: this.riders_.length, users: this.users.length };
    const problems = (await this.cleanup()).filter((p) => !p.includes('admin_audit_log'));
    await this.q(`delete from service_areas where name like 'CONC %'`).catch(() => {});
    return { n, problems };
  }

  /** Final teardown of the per-run base rows. */
  async dropBase() {
    if (!this.base) return [];
    const b = this.base;
    const problems = [];
    for (const [sql, params] of [
      [`delete from vendor_staff where vendor_id = $1`, [b.vendor]],
      [`delete from vendors where id = $1`, [b.vendor]],
      [`delete from service_areas where id = $1`, [b.area]],
      [`delete from auth.users where id = any($1)`, [[b.customer, b.owner]]],
    ]) {
      try {
        await this.q(sql, params);
      } catch (e) {
        problems.push(`${sql.slice(0, 40)}: ${e.message}`);
      }
    }
    // the admin user is referenced by admin_audit_log (append-only) once an admin action ran: it stays (throwaway DB)
    await this.q(`delete from user_roles where user_id = $1`, [b.admin]).catch(() => {});
    await this.q(`delete from auth.users where id = $1`, [b.admin]).catch(() => {});
    this.base = null;
    return problems;
  }
}
