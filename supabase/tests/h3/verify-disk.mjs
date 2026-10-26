// Dev-only: compares h3_grid_disk (0099 already applied) with h3-js gridDisk as SETS, and
// h3_grid_disk_distances with h3-js gridDiskDistances as sets of (cell, ring) pairs.
//   node verify-disk.mjs out.sql && docker exec -i <db> psql -U postgres -v ON_ERROR_STOP=1 -f - < out.sql
import { writeFileSync } from 'node:fs';
import * as h3 from 'h3-js';

let seed = 20261026;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const big = (c) => BigInt('0x' + c).toString();
const cases = []; // [kind, cell, k]
const add = (kind, cell, k) => cases.push([kind, cell, k]);

// Ibadan origins, res 7/8/9, k 0..10
for (let n = 0; n < 40; n++) {
  const lat = 7.2 + rnd() * 0.4, lng = 3.7 + rnd() * 0.4;
  for (const res of [7, 8, 9]) for (let k = 0; k <= 10; k++) add('ibadan', h3.latLngToCell(lat, lng, res), k);
}
// Ibadan, k up to 30
for (let n = 0; n < 4; n++) {
  const c = h3.latLngToCell(7.2 + rnd() * 0.4, 3.7 + rnd() * 0.4, 8);
  for (const k of [11, 15, 20, 25, 30]) add('ibadan_bigk', c, k);
}
// random global origins
for (let n = 0; n < 600; n++) {
  const lat = (Math.asin(2 * rnd() - 1) * 180) / Math.PI, lng = rnd() * 360 - 180;
  const res = Math.floor(rnd() * 16);
  add('global', h3.latLngToCell(lat, lng, res), Math.floor(rnd() * 11));
}
// polar / low-res global
for (let n = 0; n < 300; n++) {
  const lat = (rnd() < 0.5 ? 1 : -1) * (80 + rnd() * 10), lng = rnd() * 360 - 180;
  add('polar', h3.latLngToCell(lat, lng, Math.floor(rnd() * 6)), Math.floor(rnd() * 11));
}
// pentagons and their neighbours (distortion area)
const pents = h3.getPentagons ? [] : [];
let nPent = 0, nNb = 0;
for (const res of [0, 1, 2, 3, 4, 5, 7, 8, 9, 12]) {
  for (const p of h3.getPentagons(res)) {
    for (let k = 0; k <= 10; k++) { add('pentagon', p, k); nPent++; }
    for (const nb of h3.gridDisk(p, 2)) {
      if (nb === p) continue;
      for (const k of [1, 2, 3, 6]) { add('pent_nb', nb, k); nNb++; }
    }
  }
}
// big-k around pentagons at a fine resolution
for (const p of h3.getPentagons(8)) for (const k of [15, 30]) add('pentagon_bigk', p, k);

const rows = cases.map(([kind, cell, k]) => {
  const exp = h3.gridDisk(cell, k).map(big).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const expd = h3.gridDiskDistances(cell, k)
    .flatMap((ring, d) => ring.map((c) => `${big(c)}:${d}`)).sort();
  return `('${kind}',${big(cell)},${k},'{${exp.join(',')}}','{${expd.join(',')}}')`;
});
const sql = [
  'create temp table dv (kind text, cell bigint, k int, exp bigint[], expd text[]);',
  ...Array.from({ length: Math.ceil(rows.length / 200) }, (_, i) =>
    `insert into dv values ${rows.slice(i * 200, i * 200 + 200).join(',')};`),
  `select kind, count(*) as vectors,
          count(*) filter (where got is distinct from exp) as mismatches
   from (select kind, exp, (select array_agg(x order by x) from unnest(h3_grid_disk(cell, k)) x) as got from dv) s
   group by kind order by kind;`,
  `select count(*) as total_vectors,
          count(*) filter (where (select array_agg(x order by x) from unnest(h3_grid_disk(cell, k)) x) is distinct from exp) as total_mismatches
   from dv;`,
  `select kind, count(*) as vectors,
          count(*) filter (where got is distinct from expd) as dist_mismatches
   from (select kind, expd, (select array_agg(cell::text || ':' || k order by cell::text || ':' || k) from h3_grid_disk_distances(cell, k)) as got from dv) s
   group by kind order by kind;`,
  `select count(*) as total_vectors,
          count(*) filter (where (select array_agg(cell::text || ':' || k order by cell::text || ':' || k) from h3_grid_disk_distances(dv.cell, dv.k)) is distinct from expd) as total_dist_mismatches
   from dv;`,
];
writeFileSync(process.argv[2], sql.join('\n') + '\n');
console.log('vectors', cases.length);

