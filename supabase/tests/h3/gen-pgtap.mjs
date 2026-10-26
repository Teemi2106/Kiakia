// Writes supabase/tests/h3_core.sql: a small deterministic pgTAP file whose expected
// values come from h3-js 4.5.0 (the C library compiled to WebAssembly).
//   pnpm install --ignore-workspace && node gen-pgtap.mjs
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as h3 from 'h3-js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'h3_core.sql');
const big = (c) => BigInt('0x' + c);
const byVal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
let seed = 20261025;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const T = []; // test statements (and comments)
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const is = (got, exp, name) => T.push(`select is(${got}, ${exp}, ${q(name)});`);
const section = (s) => T.push(`\n-- ${s}`);
const cellSql = (c) => `${typeof c === 'bigint' ? c : big(c)}::bigint`;
const digest = (cells) => {
  const s = cells.map(big).sort(byVal).join(',');
  return `${cells.length}:${createHash('md5').update(s).digest('hex')}`;
};
// "count:md5(sorted comma list)" of the SQL result, same shape as digest()
const diskSql = (c, k) =>
  `(select cardinality(a) || ':' || md5(array_to_string(array(select x from unnest(a) x order by x), ',')) from (select h3_grid_disk(${cellSql(c)}, ${k}) a) s)`;

const distJs = (c, k) => {
  const e = h3.gridDiskDistances(c, k).flatMap((ring, d) => ring.map((x) => `${big(x)}:${d}`)).sort();
  return `${e.length}:${createHash('md5').update(e.join(',')).digest('hex')}`;
};
// same shape for h3_grid_disk_distances: count + md5 of the sorted "cell:ring" list
const distSql = (c, k) =>
  `(select count(*) || ':' || coalesce(md5(string_agg(cell || ':' || k, ',' order by (cell || ':' || k) collate "C")), '') from h3_grid_disk_distances(${cellSql(c)}, ${k}))`;

// --- latLngToCell
section('latLngToCell: Ibadan (res 7, 8, 9), global, edges, pentagon centres, invalid input');
const ibadan = [[7.3775, 3.947], [7.4, 3.9], [7.25, 3.75], [7.55, 4.05]];
for (const [lat, lng] of ibadan)
  for (const r of [7, 8, 9]) is(`h3_latlng_to_cell(${lat}, ${lng}, ${r})`, cellSql(h3.latLngToCell(lat, lng, r)), `ibadan ${lat},${lng} res ${r}`);
for (let n = 0; n < 24; n++) {
  const lat = +((Math.asin(2 * rnd() - 1) * 180) / Math.PI).toFixed(6);
  const lng = +(rnd() * 360 - 180).toFixed(6);
  const r = n % 16;
  is(`h3_latlng_to_cell(${lat}, ${lng}, ${r})`, cellSql(h3.latLngToCell(lat, lng, r)), `global ${lat},${lng} res ${r}`);
}
for (const [lat, lng] of [[90, 0], [-90, 0], [0, 180], [0, -180], [89.9999, 45]])
  for (const r of [0, 4, 9]) is(`h3_latlng_to_cell(${lat}, ${lng}, ${r})`, cellSql(h3.latLngToCell(lat, lng, r)), `edge ${lat},${lng} res ${r}`);
for (const p of h3.getPentagons(2).slice(0, 6)) {
  const [lat, lng] = h3.cellToLatLng(p);
  is(`h3_latlng_to_cell(${lat}, ${lng}, 2)`, cellSql(p), `pentagon centre ${p} maps back to itself`);
  const [la, ln] = h3.cellToLatLng(h3.gridDisk(p, 1).find((c) => c !== p));
  is(`h3_latlng_to_cell(${la}, ${ln}, 2)`, cellSql(h3.latLngToCell(la, ln, 2)), `pentagon neighbour centre of ${p}`);
}
for (const [a, b, c, name] of [
  ['7.4', '3.9', '16', 'res 16'], ['7.4', '3.9', '-1', 'res -1'], ['91', '3.9', '8', 'lat 91'],
  ['7.4', '181', '8', 'lng 181'], ["'NaN'::float8", '3.9', '8', 'lat NaN'], ['7.4', "'Infinity'::float8", '8', 'lng Infinity'],
]) T.push(`select is(h3_latlng_to_cell(${a}, ${b}, ${c}), null::bigint, ${q('invalid input gives null: ' + name)});`);
T.push(`select is(h3_latlng_to_cell(null, 3.9, 8), null::bigint, 'null input gives null (strict)');`);

// --- parent
section('cellToParent');
for (const [lat, lng] of [[7.3775, 3.947], [-33.9, 151.2]]) {
  const c = h3.latLngToCell(lat, lng, 12);
  for (const r of [0, 3, 7, 9, 11, 12]) is(`h3_cell_to_parent(${cellSql(c)}, ${r})`, cellSql(h3.cellToParent(c, r)), `parent of ${c} at res ${r}`);
  is(`h3_cell_to_parent(${cellSql(c)}, 13)`, 'null::bigint', 'parent finer than the cell is null');
  is(`h3_cell_to_parent(${cellSql(c)}, -1)`, 'null::bigint', 'parent res -1 is null');
}
for (const p of h3.getPentagons(5).slice(0, 3)) is(`h3_cell_to_parent(${cellSql(p)}, 1)`, cellSql(h3.cellToParent(p, 1)), `parent of pentagon ${p}`);

// --- validity
section('validity, resolution, pentagon');
const c9 = h3.latLngToCell(7.3775, 3.947, 9);
const b9 = big(c9);
is(`h3_is_valid_cell(${cellSql(c9)})`, 'true', 'valid Ibadan cell');
is(`h3_get_resolution(${cellSql(c9)})`, '9', 'resolution of a res 9 cell');
is(`h3_is_pentagon(${cellSql(c9)})`, 'false', 'Ibadan cell is not a pentagon');
for (const r of [0, 1, 5, 9, 15]) {
  const p = h3.getPentagons(r)[3];
  is(`h3_is_pentagon(${cellSql(p)})`, 'true', `pentagon at res ${r}`);
  is(`h3_is_valid_cell(${cellSql(p)})`, 'true', `valid pentagon at res ${r}`);
}
const mut = [
  [-1n, 'negative (high bit set)'],
  [(b9 & ~(15n << 59n)) | (2n << 59n), 'wrong mode'],
  [(b9 & ~(127n << 45n)) | (122n << 45n), 'base cell 122'],
  [b9 | (7n << 18n), 'digit 7 within the resolution'],
  [b9 & ~7n, 'trailing digit not 7'],
  [b9 | (1n << 56n), 'reserved bits set'],
];
for (const [m, name] of mut) is(`h3_is_valid_cell(${m}::bigint)`, 'false', `invalid index: ${name}`);
const pent3 = h3.getPentagons(3)[0];
is(`h3_is_valid_cell(${(big(pent3) & ~(7n << 33n)) | (1n << 33n)}::bigint)`, 'false', 'pentagon with a leading k digit is invalid');
is(`(select count(*)::int from unnest(array[${h3.getPentagons(7).map(cellSql).join(',')}]) c where h3_is_pentagon(c))`, '12', 'all 12 res-7 pentagons recognised');

// --- descendant range
section('cellToDescendantRange');
for (const [lat, lng, r, cr] of [[7.3775, 3.947, 8, 9], [7.3775, 3.947, 7, 9], [7.4, 3.9, 5, 8], [-20, 60, 3, 6], [10, -170, 8, 8]]) {
  const c = h3.latLngToCell(lat, lng, r);
  const kids = h3.cellToChildren(c, cr).map(big).sort(byVal);
  T.push(`select results_eq(format('select lo, hi from h3_cell_to_descendant_range(%s, ${cr})', ${cellSql(c)}), $$values (${kids[0]}::bigint, ${kids[kids.length - 1]}::bigint)$$, ${q(`range of ${c} to res ${cr} equals min/max of its children`)});`);
  const nbKids = h3.gridDisk(c, 1).filter((x) => x !== c).flatMap((n) => h3.cellToChildren(n, cr)).map(big);
  T.push(`select is((select count(*)::int from unnest(array[${nbKids.join(',')}]::bigint[]) k, h3_cell_to_descendant_range(${cellSql(c)}, ${cr}) r where k between r.lo and r.hi), 0, ${q(`no neighbour descendant of ${c} inside the range`)});`);
  T.push(`select is((select count(*)::int from unnest(array[${kids.join(',')}]::bigint[]) k, h3_cell_to_descendant_range(${cellSql(c)}, ${cr}) r where k between r.lo and r.hi), ${kids.length}, ${q(`all ${kids.length} children of ${c} inside the range`)});`);
}
{
  const p = h3.getPentagons(4)[5];
  const kids = h3.cellToChildren(p, 6).map(big).sort(byVal);
  T.push(`select results_eq(format('select lo, hi from h3_cell_to_descendant_range(%s, 6)', ${cellSql(p)}), $$values (${kids[0]}::bigint, ${kids[kids.length - 1]}::bigint)$$, 'pentagon range equals min/max of its children');`);
}
T.push(`select is((select count(*)::int from h3_cell_to_descendant_range(${cellSql(c9)}, 8)), 0, 'coarser child resolution gives no rows');`);
T.push(`select is((select count(*)::int from h3_cell_to_descendant_range(${cellSql(c9)}, 16)), 0, 'child resolution above 15 gives no rows');`);

// --- gridDisk
section('gridDisk (set equality: count + md5 of the sorted set)');
for (const [lat, lng] of [[7.3775, 3.947], [7.5, 4.0]])
  for (const r of [7, 8, 9]) for (const k of [0, 1, 2, 5, 8, 10]) {
    const c = h3.latLngToCell(lat, lng, r);
    is(diskSql(c, k), q(digest(h3.gridDisk(c, k))), `Ibadan disk res ${r} k ${k} (${lat},${lng})`);
  }
for (const [lat, lng, r, k] of [[-33.9, 151.2, 5, 6], [64.1, -21.9, 6, 4], [0, 0, 3, 3], [35, 139, 8, 7], [-80, 10, 2, 5], [89.5, 20, 3, 4]]) {
  const c = h3.latLngToCell(lat, lng, r);
  is(diskSql(c, k), q(digest(h3.gridDisk(c, k))), `global disk ${lat},${lng} res ${r} k ${k}`);
}
section('gridDisk around pentagons (pentagon-safe fallback)');
for (const r of [0, 2, 5, 9]) {
  const pents = h3.getPentagons(r);
  for (const k of [1, 3, 8]) {
    const p = pents[(r + k) % 12];
    is(diskSql(p, k), q(digest(h3.gridDisk(p, k))), `pentagon ${p} res ${r} k ${k}`);
  }
}
for (const r of [3, 8]) for (const pi of [0, 4, 11]) {
  const p = h3.getPentagons(r)[pi];
  const nb = h3.gridDisk(p, 2).filter((c) => c !== p);
  for (const k of [2, 6]) {
    const c = nb[(pi * 3 + k) % nb.length];
    is(diskSql(c, k), q(digest(h3.gridDisk(c, k))), `pentagon-distortion disk res ${r} near ${p} k ${k}`);
  }
}
{
  const c = h3.latLngToCell(7.3775, 3.947, 8);
  is(diskSql(c, 50), q(digest(h3.gridDisk(c, 50))), 'k 50 (cap) Ibadan res 8');
  is(`cardinality(h3_grid_disk(${cellSql(c)}, 50))`, '7651', 'k 50 holds 3k(k+1)+1 cells');
  const p = h3.getPentagons(8)[2];
  is(diskSql(p, 30), q(digest(h3.gridDisk(p, 30))), 'pentagon res 8 k 30');
  is(`h3_grid_disk(${cellSql(c)}, 51)`, 'null::bigint[]', 'k above the cap is null');
  is(`h3_grid_disk(${cellSql(c)}, -1)`, 'null::bigint[]', 'negative k is null');
  is(`h3_grid_disk(${b9 | (7n << 18n)}::bigint, 2)`, 'null::bigint[]', 'invalid origin is null');
  is(`h3_grid_disk(null, 2)`, 'null::bigint[]', 'null origin is null (strict)');
  is(`h3_grid_disk(${cellSql(c)}, 0)`, `array[${cellSql(c)}]`, 'k 0 is the origin alone');
  is(`(select count(distinct x) from unnest(h3_grid_disk(${cellSql(c)}, 8)) x)::int`, '217', 'no duplicates in a k 8 disk');
}

section('gridDiskDistances (cell + ring pairs; count + md5 of the sorted pairs)');
for (const r of [7, 8, 9]) for (const k of [0, 1, 3, 8]) {
  const c = h3.latLngToCell(7.3775, 3.947, r);
  is(distSql(c, k), q(distJs(c, k)), `Ibadan distances res ${r} k ${k}`);
}
for (const [r, pi, k] of [[2, 3, 4], [5, 0, 6], [8, 7, 8], [9, 11, 3]]) {
  const p = h3.getPentagons(r)[pi];
  is(distSql(p, k), q(distJs(p, k)), `pentagon distances res ${r} k ${k}`);
  const nb = h3.gridDisk(p, 1).filter((x) => x !== p)[pi % 5];
  is(distSql(nb, k), q(distJs(nb, k)), `pentagon-neighbour distances res ${r} k ${k}`);
}
{
  const c = h3.latLngToCell(7.3775, 3.947, 8);
  is(`(select array_agg(n order by k) from (select k, count(*)::int n from h3_grid_disk_distances(${cellSql(c)}, 8) group by k) s)`, `array[1,6,12,18,24,30,36,42,48]`, 'ring sizes of a k 8 disk are 1,6,...,48');
  is(`(select count(*)::int from h3_grid_disk_distances(${cellSql(c)}, 51))`, '0', 'distances above the cap give no rows');
  is(`(select count(*)::int from h3_grid_disk_distances(${cellSql(c)}, -1))`, '0', 'negative k gives no rows');
  is(`(select k from h3_grid_disk_distances(${cellSql(c)}, 3) where cell = ${cellSql(c)})`, '0', 'the origin is at distance 0');
}

// --- privileges
section('privileges and search_path');
const fnSet = `(select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '\\_h3\\_%' or p.proname like 'h3\\_%'))`;
T.push(`select cmp_ok((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'h3\\_%'), '>=', 7, 'public h3 functions exist');`);
for (const role of ['anon', 'authenticated'])
  T.push(`select is((select count(*)::int from ${fnSet} f where has_function_privilege('${role}', f.oid, 'execute')), 0, '${role} cannot execute any h3 function');`);
T.push(`select is((select count(*)::int from ${fnSet} f where not has_function_privilege('service_role', f.oid, 'execute')), 0, 'service_role can execute every h3 function');`);
T.push(`select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '\\_h3\\_%' or p.proname like 'h3\\_%') and not (p.proconfig::text like '%search_path=public%')), 0, 'every h3 function pins search_path');`);
T.push(`select is((select provolatile::text || proparallel::text || proisstrict::text from pg_proc where proname = 'h3_grid_disk'), 'istrue', 'h3_grid_disk is immutable, parallel safe, strict');`);

const n = T.filter((l) => l.startsWith('select')).length;
const head = `-- pgTAP: H3 core in plpgsql (0099_h3_core.sql) against h3-js 4.5.0.
--
-- GENERATED by supabase/tests/h3/gen-pgtap.mjs - do not edit by hand; regenerate
-- with \`cd supabase/tests/h3 && pnpm install --ignore-workspace && node gen-pgtap.mjs\`.
--
-- Rider dispatch finds candidates by H3 cell, so a wrong cell silently hides a
-- rider. Every expected value comes from h3-js, not from the SQL port itself:
-- latLngToCell (Ibadan, global, poles/antimeridian, pentagon centres, invalid
-- input), cellToParent, validity/pentagon, descendant ranges, gridDisk set
-- equality (count + md5 of the sorted set; incl. pentagons and their distortion
-- area, k up to the cap of 50) and the service_role-only grants. The exhaustive
-- run (tens of thousands of vectors) is verify-core.mjs / verify-disk.mjs in
-- supabase/tests/h3; this file is the small committed regression subset.
--
-- Run with: supabase test db

begin;
select plan(${n});
`;
writeFileSync(out, head + T.join('\n') + '\n\nselect * from finish();\nrollback;\n');
console.log('wrote', out, n, 'tests');
