// Assembles supabase/migrations/0099_h3_core.sql from migration.template.sql and
// tables.json (lookup tables extracted from the H3 v4.5.0 C sources by
// gen-tables.mjs). Reproducible: `node build-migration.mjs`.
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(fs.readFileSync(resolve(here, 'tables.json'), 'utf8'));
const out = resolve(here, '..', '..', 'migrations', '0099_h3_core.sql');

// 60-degree ccw / cw rotation of a digit (0 centre, 1 k, 2 j, 3 jk, 4 i, 5 ik, 6 ij)
const rotCcw = [0, 5, 3, 1, 6, 4, 2];
const rotCw = [0, 3, 6, 2, 5, 1, 4];
const fijkBase = t.fijk.filter((_, i) => i % 2 === 0);
const fijkRot = t.fijk.filter((_, i) => i % 2 === 1);

const specs = [
  ['rot_ccw', rotCcw, 'integer', 'digit -> digit rotated 60 degrees counter-clockwise, index digit + 1'],
  ['rot_cw', rotCw, 'integer', 'digit -> digit rotated 60 degrees clockwise, index digit + 1'],
  ['bc_is_pentagon', t.isPent, 'integer', '1 for the 12 pentagon base cells, index base cell + 1'],
  ['bc_home_face', t.homeFace, 'integer', 'home icosahedron face of each base cell, index base cell + 1'],
  ['bc_cw_offset', t.cwOffset, 'integer', 'pentagon clockwise-offset faces (2 per base cell), index base cell * 2 + 1..2'],
  ['fijk_base_cell', fijkBase, 'integer', 'base cell for (face, i, j, k at res 0), index face * 27 + i * 9 + j * 3 + k + 1'],
  ['fijk_rot', fijkRot, 'integer', 'ccw 60-degree rotations for the same key as fijk_base_cell'],
  ['face_center', t.faceCenter, 'double precision', 'unit vector of each face centre (x, y, z), index face * 3 + 1..3'],
  ['face_az0', t.az0, 'double precision', 'azimuth of each face\'s class II i axis, index face + 1'],
  ['bc_neighbor', t.neighbors, 'integer', 'base cell neighbours (7 per cell, direction digit 0..6, 127 = none) - for gridDisk'],
  ['bc_neighbor_rot', t.neighborRots, 'integer', 'ccw rotations when crossing to that neighbour (7 per cell) - for gridDisk'],
  ['new_digit_ii', t.newDigitII, 'integer', 'neighbour traversal: new digit, class II table (7x7: digit * 7 + dir + 1) - for gridDisk'],
  ['new_adj_ii', t.newAdjII, 'integer', 'neighbour traversal: next direction to carry, class II table - for gridDisk'],
  ['new_digit_iii', t.newDigitIII, 'integer', 'neighbour traversal: new digit, class III table - for gridDisk'],
  ['new_adj_iii', t.newAdjIII, 'integer', 'neighbour traversal: next direction to carry, class III table - for gridDisk'],
];

function wrap(vals) {
  const lines = []; let cur = '    ';
  vals.forEach((v, i) => {
    const s = String(v) + (i < vals.length - 1 ? ',' : '');
    if (cur.length + s.length + 1 > 96) { lines.push(cur.trimEnd()); cur = '    '; }
    cur += s + ' ';
  });
  lines.push(cur.trimEnd());
  return lines.join('\n');
}

const sql = specs.map(([name, vals, type, doc]) =>
  `-- ${doc} (${vals.length} entries)\n` +
  `create or replace function public._h3_t_${name}()\nreturns ${type}[]\n` +
  `language sql immutable parallel safe set search_path = public\nas $f$ select array[\n${wrap(vals)}\n  ]::${type}[] $f$;\n`
).join('\n');

const tpl = fs.readFileSync(resolve(here, 'migration.template.sql'), 'utf8');
fs.writeFileSync(out, tpl.replace('-- @@TABLES@@', () => sql));
console.log('wrote', out, fs.readFileSync(out, 'utf8').split('\n').length, 'lines');
