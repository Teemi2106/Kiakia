// Dev-only: writes a psql script that loads vectors computed with h3-js and
// compares the SQL port against them, printing mismatch counts. By default the
// script wraps everything in `begin; \i supabase/migrations/0099_h3_core.sql; ...
// rollback;` (run psql from the repo root); with --no-migration it assumes 0099
// is already applied and leaves no objects behind (temp tables only).
//   node verify-core.mjs out.sql [--no-migration]
import { writeFileSync } from 'node:fs';
import * as h3 from 'h3-js';

const out = process.argv[2];
let seed = 20261025;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (n) => Math.floor(rnd() * n);
const pad = (hex) => hex.padStart(16, '0');
const rows = { ll: [], par: [], val: [], rng: [] };
const rlat = () => (Math.asin(2 * rnd() - 1) * 180) / Math.PI; // uniform on the sphere
const rlng = () => rnd() * 360 - 180;
const clampLat = (x) => Math.max(-90, Math.min(90, x));
const wrapLng = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
let kind = '';
const addLL = (lat, lng, res, alt = []) =>
  rows.ll.push([lat, lng, res, h3.latLngToCell(lat, lng, res), kind, alt]);

// global uniform, random resolution
kind = 'global';
for (let n = 0; n < 9000; n++) addLL(rlat(), rlng(), ri(16));
// Ibadan box, every resolution
kind = 'ibadan';
for (let n = 0; n < 6000; n++) addLL(7.2 + rnd() * 0.4, 3.7 + rnd() * 0.4, n % 16);
// poles
kind = 'pole';
for (const lat of [90, -90, 89.9999, -89.9999, 89.999999999, -89.999999999])
  for (let r = 0; r < 16; r++)
    for (let n = 0; n < 12; n++) addLL(lat, n < 3 ? [0, 180, -180][n] : rlng(), r);
// antimeridian: exactly +-180 and within 1e-1..1e-9 deg of it
kind = 'antimeridian';
for (let n = 0; n < 2000; n++) {
  const d = n % 4 === 0 ? 0 : 10 ** -(1 + ri(9));
  const sign = rnd() < 0.5 ? 1 : -1;
  addLL(rlat(), sign * (180 - d), ri(16));
}
// every base cell centre (and pentagons heavily) with tiny offsets
const res0 = h3.getRes0Cells();
kind = 'basecell-centre-offsets';
for (const c of res0) {
  const [la, lo] = h3.cellToLatLng(c);
  const reps = h3.isPentagon(c) ? 60 : 6;
  for (let n = 0; n < reps; n++) {
    const e = n === 0 ? 0 : 10 ** -(1 + ri(8));
    addLL(clampLat(la + (rnd() - 0.5) * e), wrapLng(lo + (rnd() - 0.5) * e), n % 16);
  }
}
// centres, vertices and just-inside vertices of random cells (borders are the hard case)
for (let n = 0; n < 2500; n++) {
  const r = ri(16);
  const c = h3.latLngToCell(rlat(), rlng(), r);
  const [la, lo] = h3.cellToLatLng(c);
  kind = 'cell-centre';
  addLL(la, lo, r);
  const b = h3.cellToBoundary(c)[ri(5)];
  // knife-edge rows: the point is within ~1 ulp of a border, where the cell is
  // decided by last-bit libm rounding. alt = the neighbours sharing that vertex;
  // the SQL result must be the h3-js cell or one of them.
  const alt = h3.gridDisk(c, 1).filter((x) => h3.cellToBoundary(x)
    .some((v) => Math.abs(v[0] - b[0]) < 1e-8 && Math.abs(wrapLng(v[1] - b[1])) < 1e-8));
  kind = 'exact-vertex(knife-edge)';
  addLL(b[0], b[1], r, alt);
  kind = 'near-vertex-1e-9(knife-edge)';
  addLL(clampLat(la + (b[0] - la) * (1 - 1e-9)), wrapLng(lo + (b[1] - lo) * (1 - 1e-9)), r, alt);
  kind = 'near-vertex-1e-6';
  addLL(clampLat(la + (b[0] - la) * (1 - 1e-6)), wrapLng(lo + (b[1] - lo) * (1 - 1e-6)), r);
}
// invalid inputs: SQL must return NULL
const bad = [[NaN, 0, 9], [0, NaN, 9], [Infinity, 0, 9], [0, -Infinity, 9], [90.0001, 0, 9], [-90.0001, 0, 9],
  [0, 180.0001, 9], [0, -180.0001, 9], [0, 0, -1], [0, 0, 16], [95, 200, 9]];

// parents: random cells at every resolution -> a random coarser resolution
for (let n = 0; n < 4000; n++) {
  const r = ri(16);
  const c = h3.latLngToCell(rlat(), rlng(), r);
  const p = ri(r + 1);
  rows.par.push([c, p, h3.cellToParent(c, p)]);
}
for (const c0 of res0) {
  if (!h3.isPentagon(c0)) continue;
  for (let r = 1; r <= 15; r++) {
    const c = h3.cellToCenterChild(c0, r);
    const p = ri(r + 1);
    rows.par.push([c, p, h3.cellToParent(c, p)]);
  }
}

// validity / pentagon / resolution on valid and mutated indexes
const mutate = (hex) => {
  let b = BigInt('0x' + hex);
  const k = ri(4);
  if (k === 0) b ^= 1n << BigInt(ri(64));
  else if (k === 1) b ^= (1n << BigInt(ri(64))) | (1n << BigInt(ri(64)));
  else if (k === 2) b = (b & ~(7n << BigInt(3 * ri(15)))) | (BigInt(ri(8)) << BigInt(3 * ri(15)));
  else b = (b & ~(0x7fn << 45n)) | (BigInt(ri(128)) << 45n);
  return (b & 0xffffffffffffffffn).toString(16);
};
const resOf = (hex) => Number((BigInt('0x' + hex) >> 52n) & 15n);
const addVal = (hex) => {
  const valid = h3.isValidCell(hex);
  rows.val.push([hex, valid, valid ? h3.isPentagon(hex) : false, resOf(hex)]);
};
for (let n = 0; n < 6000; n++) {
  const r = ri(16);
  let hex = h3.latLngToCell(rlat(), rlng(), r);
  if (n % 5 === 4) hex = h3.cellToCenterChild(res0[ri(122)], r); // includes pentagon chains
  if (n % 2) hex = mutate(hex);
  addVal(hex);
}
for (const hex of ['0', 'ffffffffffffffff', '8000000000000000', '8928308280fffff', '8f2830828282828', '1']) addVal(hex);

// descendant ranges: lo/hi vs h3-js; sampled res-9 descendants inside, neighbours' outside
const randomDesc = (c, res) => {
  let x = c;
  while (h3.getResolution(x) < res) {
    const k = h3.cellToChildren(x, h3.getResolution(x) + 1);
    x = k[ri(k.length)];
  }
  return x;
};
const parents = [...res0];
for (let n = 0; n < 700; n++) parents.push(h3.latLngToCell(rlat(), rlng(), ri(10)));
for (const c0 of res0) if (h3.isPentagon(c0)) for (let r = 1; r <= 9; r++) parents.push(h3.cellToCenterChild(c0, r));
for (let n = 0; n < 200; n++) parents.push(h3.latLngToCell(7.2 + rnd() * 0.4, 3.7 + rnd() * 0.4, 5 + ri(5)));
for (const c of parents) {
  const cr = h3.getResolution(c);
  for (const cres of cr === 9 ? [9] : [9, Math.min(15, 9 + ri(4))]) {
    const ins = [];
    const outs = [];
    if (cres === 9) {
      for (let i = 0; i < 6; i++) ins.push(randomDesc(c, 9));
      for (const nb of h3.gridDisk(c, 1)) if (nb !== c) outs.push(randomDesc(nb, 9));
    }
    const centre = h3.cellToCenterChild(c, cres);
    let hiExp = null;
    if (cres - cr <= 5) {
      const k = h3.cellToChildren(c, cres);
      hiExp = k[k.length - 1];
    }
    rows.rng.push([c, cres, centre, hiExp, ins, outs]);
  }
}

const q = (s) => (s === null ? '\\N' : String(s));
const H = (hex) => (hex === null ? '\\N' : pad(hex));
const B = (b) => (b ? 't' : 'f');
let s = '';
if (!process.argv.includes('--no-migration')) s += 'begin;\n\\i supabase/migrations/0099_h3_core.sql\n';
s += 'create temp table v_ll(lat float8, lng float8, res int, exp text, kind text, alt text);\ncopy v_ll from stdin;\n';
for (const [a, b, c, d, e, f] of rows.ll) s += [q(a), q(b), q(c), H(d), e, `{${f.map(pad).join(',')}}`].join('\t') + '\n';
for (const [a, b, c] of bad) s += [q(a), q(b), q(c), '\\N', 'invalid', '{}'].join('\t') + '\n';
s += '\\.\ncreate temp table v_par(cell text, res int, exp text);\ncopy v_par from stdin;\n';
for (const [a, b, c] of rows.par) s += [H(a), b, H(c)].join('\t') + '\n';
s += '\\.\ncreate temp table v_val(cell text, valid bool, pent bool, res int);\ncopy v_val from stdin;\n';
for (const [a, b, c, d] of rows.val) s += [H(a), B(b), B(c), d].join('\t') + '\n';
s += '\\.\ncreate temp table v_rng(cell text, cres int, centre text, hi_exp text, ins text, outs text);\ncopy v_rng from stdin;\n';
for (const [a, b, c, d, e, f] of rows.rng)
  s += [H(a), b, H(c), H(d), `{${e.map(pad).join(',')}}`, `{${f.map(pad).join(',')}}`].join('\t') + '\n';
s += '\\.\n';
s += `create function pg_temp.hx(t text) returns bigint language sql as $$ select ('x' || t)::bit(64)::bigint $$;
select 'latLngToCell vectors (excl. knife-edge)' as what, count(*) as n,
  count(*) filter (where h3_latlng_to_cell(lat, lng, res) is distinct from pg_temp.hx(exp)) as mismatches
  from v_ll where kind not like '%knife-edge%';
select 'latLngToCell knife-edge (point within ~1 ulp of a border)' as what, count(*) as n,
  count(*) filter (where h3_latlng_to_cell(lat, lng, res) is distinct from pg_temp.hx(exp)) as differs_from_h3js,
  count(*) filter (where h3_latlng_to_cell(lat, lng, res) is distinct from pg_temp.hx(exp)
     and not (lpad(to_hex(h3_latlng_to_cell(lat, lng, res)), 16, '0') = any (alt::text[]))) as outside_tie_set
  from v_ll where kind like '%knife-edge%';
select kind, count(*) as n, count(*) filter (where h3_latlng_to_cell(lat, lng, res) is distinct from pg_temp.hx(exp)) as mismatches from v_ll group by kind order by kind;
select 'cellToParent vectors' as what, count(*) as n,
  count(*) filter (where h3_cell_to_parent(pg_temp.hx(cell), res) is distinct from pg_temp.hx(exp)) as mismatches from v_par;
select 'isValid/isPentagon/getRes vectors' as what, count(*) as n,
  count(*) filter (where h3_is_valid_cell(pg_temp.hx(cell)) is distinct from valid
     or (valid and h3_is_pentagon(pg_temp.hx(cell)) is distinct from pent)
     or h3_get_resolution(pg_temp.hx(cell)) is distinct from res) as mismatches from v_val;
select 'descendant range lo/hi vs h3-js' as what, count(*) as n,
  count(*) filter (where r.lo is distinct from pg_temp.hx(centre)
     or (hi_exp is not null and r.hi is distinct from pg_temp.hx(hi_exp))
     or r.lo < 0 or r.hi < 0 or r.lo > r.hi) as mismatches
  from v_rng, lateral h3_cell_to_descendant_range(pg_temp.hx(cell), cres) r;
select 'range: res-9 descendants inside' as what, coalesce(sum(cardinality(ins::text[])), 0) as n,
  coalesce(sum((select count(*) from unnest(ins::text[]) d where not (pg_temp.hx(d) between r.lo and r.hi))), 0) as mismatches
  from v_rng, lateral h3_cell_to_descendant_range(pg_temp.hx(cell), 9) r where cres = 9;
select 'range: neighbours res-9 descendants outside' as what, coalesce(sum(cardinality(outs::text[])), 0) as n,
  coalesce(sum((select count(*) from unnest(outs::text[]) d where pg_temp.hx(d) between r.lo and r.hi)), 0) as mismatches
  from v_rng, lateral h3_cell_to_descendant_range(pg_temp.hx(cell), 9) r where cres = 9;
select 'null/edge behaviour (all must be t)' as what,
  h3_latlng_to_cell(0, 0, 16) is null as res16, h3_cell_to_parent(pg_temp.hx('08928308280fffff'), 10) is null as finer_parent,
  (select count(*) from h3_cell_to_descendant_range(pg_temp.hx('08928308280fffff'), 8)) = 0 as coarser_child,
  h3_latlng_to_cell('NaN', 0, 9) is null as nan, h3_latlng_to_cell(0, 'Infinity', 9) is null as inf;
`;
if (!process.argv.includes('--no-migration')) s += 'rollback;\n';
writeFileSync(out, s);
console.log(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])), 'invalid-input rows:', bad.length);
