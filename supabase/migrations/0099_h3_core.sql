-- KiaKia - a pure SQL/plpgsql port of the parts of Uber H3 (v4.5.0) that rider
-- dispatch needs, so the database can turn a GPS ping into an H3 cell with no
-- extension.
--
-- WHY THIS EXISTS. Neither hosted Supabase nor the supabase/postgres image ships
-- the h3 extension, and the rider app calls update_rider_location(lat, lng)
-- directly, so the cell has to be computed inside the database. Dispatch
-- (docs/dispatch-design.md D6) will store riders.h3_cell at resolution 9 and
-- discover candidates by mapping disk cells to the contiguous range of their
-- resolution-9 descendants (h3_cell_to_descendant_range) and range-scanning one
-- btree index. This migration adds the H3 core plus gridDisk; no table, no dispatch function and
-- no existing object is touched.
--
-- ATTRIBUTION AND LICENSE. This is a derivative port of the H3 C library,
-- Copyright 2016-2026 Uber Technologies, Inc., licensed under the Apache License,
-- Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0), source
-- https://github.com/uber/h3 tag v4.5.0 (src/h3lib/lib/{faceijk,h3Index,algos,
-- baseCells}.c, src/h3lib/include/{coordijk,vec3d,constants}.h). The lookup
-- tables below are copied from those files by script
-- (supabase/tests/h3/gen-tables.mjs -> tables.json -> build-migration.mjs, which
-- assembles this file from migration.template.sql) and the functions are
-- cross-checked against h3-js 4.5.0, which is that same C library compiled to
-- WebAssembly. This notice must stay with any copy of the tables.
--
-- FUNCTIONS (names are fixed; later migrations rely on them)
--   h3_latlng_to_cell(lat, lng, res)       == h3-js latLngToCell
--   h3_cell_to_parent(cell, res)           == h3-js cellToParent
--   h3_get_resolution / h3_is_valid_cell / h3_is_pentagon
--   h3_cell_to_descendant_range(cell, res) -- min/max index of all descendants
--   h3_grid_disk(cell, k)                  == set of h3-js gridDisk (k 0..50, else NULL;
--                                             NULL for an invalid cell)
--   h3_grid_disk_distances(cell, k)        == h3-js gridDiskDistances as rows (cell, k)
-- Internal helpers are prefixed _h3_ and are not part of the contract.
--
-- INDEX <-> bigint. An H3 index is 64 bits. Bit 63 is reserved and always 0 for
-- cells (mode 1 sits in bits 59..62), so every valid cell fits in a POSITIVE
-- signed bigint and bigint order equals unsigned order. h3-js prints the index
-- as lowercase hex; the bigint is its value, i.e.
-- ('x' || lpad(hex, 16, '0'))::bit(64)::bigint. Layout: bits 59..62 mode (=1),
-- 52..55 resolution, 45..51 base cell (0..121), then 15 three-bit digits, digit r
-- at bit (15 - r) * 3; digits beyond the resolution are 7.
--
-- INVALID INPUT. Data problems return NULL, never an error, so a trigger that
-- maintains riders.h3_cell cannot block a location ping: NaN/Infinity, lat
-- outside [-90, 90], lng outside [-180, 180], res outside 0..15. (h3-js is laxer
-- about lat/lng range; KiaKia coordinates are validated GPS, so stricter is
-- right.) h3_cell_to_parent returns NULL for a res finer than the cell or outside
-- 0..15; h3_cell_to_descendant_range returns zero rows for a res coarser than the
-- cell or above 15. h3_cell_to_parent, h3_cell_to_descendant_range,
-- h3_get_resolution and h3_is_pentagon are pure bit operations and trust their
-- input to be a valid cell (check with h3_is_valid_cell). All functions are
-- STRICT: a NULL argument gives NULL (or no rows).
--
-- DESCENDANT RANGE. For a cell at resolution r and a child resolution c >= r:
--   lo = the cell with digits r+1..c set to 0 (the centre child chain)
--   hi = the cell with digits r+1..c set to 6 (the largest legal digit)
-- Both carry resolution c and keep digits above c at 7. Every index with
-- resolution c that lies in [lo, hi] shares the parent's high bits and numeric
-- order is lexicographic, so it IS a descendant (or an invalid index with a
-- digit 7 / bad trailing digits); every descendant has digits 0..6 so it lies in
-- [lo, hi]. Pentagon parents are covered: the all-0 and all-6 chains are legal,
-- only a leading 1 digit is not.
--
-- NUMERICS. The port follows the C evaluation order operation by operation in
-- double precision (each plpgsql operator is one IEEE-754 operation, so there is
-- no fused multiply-add), so results match h3-js, including on cell borders.
-- sin/cos/tan/acos/atan2 come from the platform libm, whose last-bit rounding can
-- in principle differ from the libm inside h3-js; a point within ~1e-16 rad of a
-- cell border could land in the neighbour cell. GPS cannot see that.
--
-- PERFORMANCE. Lookup tables are IMMUTABLE zero-argument SQL functions returning
-- arrays; the planner folds each call into a constant, so a lookup is an array
-- subscript with no SPI query per digit.
--
-- PRIVILEGES. Every function is revoked from public, anon and authenticated and
-- granted to service_role only. They are called from SECURITY DEFINER dispatch
-- code (and a SECURITY DEFINER trigger function), never directly by clients.

-- ---------------------------------------------------------------------------
-- 1. Constant tables (copied from the H3 C sources; flat, 1-based arrays)
-- ---------------------------------------------------------------------------

-- digit -> digit rotated 60 degrees counter-clockwise, index digit + 1 (7 entries)
create or replace function public._h3_t_rot_ccw()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 5, 3, 1, 6, 4, 2
  ]::integer[] $f$;

-- digit -> digit rotated 60 degrees clockwise, index digit + 1 (7 entries)
create or replace function public._h3_t_rot_cw()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 3, 6, 2, 5, 1, 4
  ]::integer[] $f$;

-- 1 for the 12 pentagon base cells, index base cell + 1 (122 entries)
create or replace function public._h3_t_bc_is_pentagon()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
    0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
    0, 0
  ]::integer[] $f$;

-- home icosahedron face of each base cell, index base cell + 1 (122 entries)
create or replace function public._h3_t_bc_home_face()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    1, 2, 1, 2, 0, 1, 1, 2, 0, 2, 1, 1, 3, 3, 11, 4, 0, 6, 0, 2, 7, 2, 0, 6, 10, 6, 3, 11, 4,
    3, 0, 4, 5, 0, 7, 11, 7, 10, 12, 6, 7, 4, 3, 3, 4, 6, 11, 8, 5, 14, 5, 12, 10, 4, 12, 7,
    11, 10, 13, 10, 11, 9, 8, 6, 8, 9, 14, 5, 16, 8, 5, 12, 7, 12, 10, 9, 13, 16, 15, 15, 16,
    14, 13, 5, 8, 14, 9, 14, 17, 12, 16, 17, 15, 16, 9, 15, 13, 8, 13, 17, 19, 14, 19, 17, 13,
    17, 16, 9, 15, 15, 18, 18, 19, 17, 19, 18, 18, 19, 19, 18, 19, 18
  ]::integer[] $f$;

-- pentagon clockwise-offset faces (2 per base cell), index base cell * 2 + 1..2 (244 entries)
create or replace function public._h3_t_bc_cw_offset()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 0, 0, 0, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 6,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 8, 0, 0,
    0, 0, 0, 0, 0, 0, 11, 15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 16, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 19, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 13, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 14, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1, 0, 0,
    0, 0, 0, 0, 0, 0
  ]::integer[] $f$;

-- base cell for (face, i, j, k at res 0), index face * 27 + i * 9 + j * 3 + k + 1 (540 entries)
create or replace function public._h3_t_fijk_base_cell()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    16, 18, 24, 33, 30, 32, 49, 48, 50, 8, 5, 10, 22, 16, 18, 41, 33, 30, 4, 0, 2, 15, 8, 5,
    31, 22, 16, 2, 6, 14, 10, 11, 17, 24, 23, 25, 0, 1, 9, 5, 2, 6, 18, 10, 11, 4, 3, 7, 8, 0,
    1, 16, 5, 2, 7, 21, 38, 9, 19, 34, 14, 20, 36, 3, 13, 29, 1, 7, 21, 6, 9, 19, 4, 12, 26, 0,
    3, 13, 2, 1, 7, 26, 42, 58, 29, 43, 62, 38, 47, 64, 12, 28, 44, 13, 26, 42, 21, 29, 43, 4,
    15, 31, 3, 12, 28, 7, 13, 26, 31, 41, 49, 44, 53, 61, 58, 65, 75, 15, 22, 33, 28, 31, 41,
    42, 44, 53, 4, 8, 16, 12, 15, 22, 26, 28, 31, 50, 48, 49, 32, 30, 33, 24, 18, 16, 70, 67,
    66, 52, 50, 48, 37, 32, 30, 83, 87, 85, 74, 70, 67, 57, 52, 50, 25, 23, 24, 17, 11, 10, 14,
    6, 2, 45, 39, 37, 35, 25, 23, 27, 17, 11, 63, 59, 57, 56, 45, 39, 46, 35, 25, 36, 20, 14,
    34, 19, 9, 38, 21, 7, 55, 40, 27, 54, 36, 20, 51, 34, 19, 72, 60, 46, 73, 55, 40, 71, 54,
    36, 64, 47, 38, 62, 43, 29, 58, 42, 26, 84, 69, 51, 82, 64, 47, 76, 62, 43, 97, 89, 71, 98,
    84, 69, 96, 82, 64, 75, 65, 58, 61, 53, 44, 49, 41, 31, 94, 86, 76, 81, 75, 65, 66, 61, 53,
    107, 104, 96, 101, 94, 86, 85, 81, 75, 57, 59, 63, 74, 78, 79, 83, 92, 95, 37, 39, 45, 52,
    57, 59, 70, 74, 78, 24, 23, 25, 32, 37, 39, 50, 52, 57, 46, 60, 72, 56, 68, 80, 63, 77, 90,
    27, 40, 55, 35, 46, 60, 45, 56, 68, 14, 20, 36, 17, 27, 40, 25, 35, 46, 71, 89, 97, 73, 91,
    103, 72, 88, 105, 51, 69, 84, 54, 71, 89, 55, 73, 91, 38, 47, 64, 34, 51, 69, 36, 54, 71,
    96, 104, 107, 98, 110, 115, 97, 111, 119, 76, 86, 94, 82, 96, 104, 84, 98, 110, 58, 65, 75,
    62, 76, 86, 64, 82, 96, 85, 87, 83, 101, 102, 100, 107, 112, 114, 66, 67, 70, 81, 85, 87,
    94, 101, 102, 49, 48, 50, 61, 66, 67, 75, 81, 85, 95, 92, 83, 79, 78, 74, 63, 59, 57, 109,
    108, 100, 93, 95, 92, 77, 79, 78, 117, 118, 114, 106, 109, 108, 90, 93, 95, 90, 77, 63, 80,
    68, 56, 72, 60, 46, 106, 93, 79, 99, 90, 77, 88, 80, 68, 117, 109, 95, 113, 106, 93, 105,
    99, 90, 105, 88, 72, 103, 91, 73, 97, 89, 71, 113, 99, 80, 116, 105, 88, 111, 103, 91, 117,
    106, 90, 121, 113, 99, 119, 116, 105, 119, 111, 97, 115, 110, 98, 107, 104, 96, 121, 116,
    103, 120, 119, 111, 112, 115, 110, 117, 113, 105, 118, 121, 116, 114, 120, 119, 114, 112,
    107, 100, 102, 101, 83, 87, 85, 118, 120, 115, 108, 114, 112, 92, 100, 102, 117, 121, 119,
    109, 118, 120, 95, 108, 114
  ]::integer[] $f$;

-- ccw 60-degree rotations for the same key as fijk_base_cell (540 entries)
create or replace function public._h3_t_fijk_rot()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 5, 5, 0, 0, 0, 1, 0, 0, 0, 5, 5, 1, 0, 5, 1, 0, 0, 0, 0, 0,
    0, 0, 3, 1, 3, 3, 0, 5, 5, 0, 0, 0, 1, 0, 0, 1, 5, 5, 1, 0, 5, 1, 0, 0, 0, 0, 0, 0, 0, 3,
    1, 3, 3, 0, 5, 5, 0, 0, 0, 1, 0, 0, 2, 5, 5, 1, 0, 5, 1, 0, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3,
    0, 5, 5, 0, 0, 0, 1, 0, 0, 3, 5, 5, 1, 0, 5, 1, 0, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 5, 5,
    0, 0, 0, 1, 0, 0, 4, 5, 5, 1, 0, 5, 1, 0, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 0, 3, 3, 0, 0,
    3, 0, 3, 0, 3, 3, 3, 0, 0, 1, 3, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 0, 3, 3, 0, 0, 3, 0, 3,
    0, 3, 3, 3, 0, 0, 3, 3, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 0, 3, 3, 0, 0, 3, 0, 3, 0, 3, 3,
    3, 0, 0, 3, 3, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 0, 3, 3, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 0,
    3, 3, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 0, 3, 3, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 0, 3, 3, 0,
    0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 3, 3, 0, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 3, 3, 0, 0, 0, 0, 3,
    0, 3, 3, 3, 3, 3, 0, 3, 3, 0, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 3, 3, 0, 0, 0, 0, 3, 0, 3, 3,
    3, 3, 3, 0, 3, 3, 0, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 3, 3, 0, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3,
    0, 3, 3, 0, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 3, 3, 0, 0, 0, 0, 3, 0, 3, 3, 3, 3, 3, 0, 3, 3,
    0, 0, 0, 3, 0, 3, 0, 3, 3, 3, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 0, 5, 1, 0, 0,
    1, 0, 0, 4, 5, 5, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 0, 5, 1, 0, 0, 1, 0, 0,
    3, 5, 5, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 0, 5, 1, 0, 0, 1, 0, 0, 2, 5, 5,
    1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 0, 5, 1, 0, 0, 1, 0, 0, 1, 5, 5, 1, 0, 0,
    1, 1, 0, 0, 0, 0, 0, 0, 3, 1, 3, 3, 0, 0, 5, 1, 0, 0, 1, 0, 0, 0, 5, 5, 1, 0, 0, 1, 1, 0
  ]::integer[] $f$;

-- unit vector of each face centre (x, y, z), index face * 3 + 1..3 (60 entries)
create or replace function public._h3_t_face_center()
returns double precision[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0.2199307791404606, 0.6583691780274996, 0.7198475378926182, -0.2139234834501421,
    0.1478171829550703, 0.9656017935214205, 0.1092625278784797, -0.481195157287321,
    0.8697775121287253, 0.7428567301586791, -0.3593941678278028, 0.5648005936517033,
    0.8112534709140969, 0.3448953237639384, 0.472138773641393, -0.1055498149613921,
    0.9794457296411413, 0.1718874610009365, -0.8075407579970092, 0.1533552485898818,
    0.5695261994882688, -0.2846148069787907, -0.8644080972654206, 0.4144792552473539,
    0.7405621473854482, -0.6673299564565524, -0.0789837646326737, 0.8512303986474293,
    0.4722343788582681, -0.2289137388687808, -0.7405621473854481, 0.6673299564565524,
    0.0789837646326737, -0.8512303986474292, -0.4722343788582682, 0.2289137388687808,
    0.1055498149613919, -0.9794457296411413, -0.1718874610009365, 0.8075407579970092,
    -0.1533552485898819, -0.5695261994882688, 0.2846148069787908, 0.8644080972654204,
    -0.4144792552473539, -0.7428567301586791, 0.3593941678278027, -0.5648005936517033,
    -0.811253470914097, -0.3448953237639382, -0.472138773641393, -0.2199307791404607,
    -0.6583691780274996, -0.7198475378926182, 0.213923483450142, -0.1478171829550704,
    -0.9656017935214205, -0.1092625278784796, 0.481195157287321, -0.8697775121287253
  ]::double precision[] $f$;

-- azimuth of each face's class II i axis, index face + 1 (20 entries)
create or replace function public._h3_t_face_az0()
returns double precision[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    5.6199582685239395, 5.7603390817141875, 0.78021365439343, 0.4304693639799999,
    6.130269123335111, 2.692877706530643, 2.982963003477244, 3.532912002790141,
    3.494305004259568, 3.0032141694995382, 5.930472956509812, 0.13837848409025486,
    0.4487149470591504, 0.15862965011254937, 5.891865957979238, 2.711123289609793,
    3.294508837434268, 3.80481969224544, 3.6644388790551923, 2.361378999196363
  ]::double precision[] $f$;

-- base cell neighbours (7 per cell, direction digit 0..6, 127 = none) - for gridDisk (854 entries)
create or replace function public._h3_t_bc_neighbor()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 1, 5, 2, 4, 3, 8, 1, 7, 6, 9, 0, 3, 2, 2, 6, 10, 11, 0, 1, 5, 3, 13, 1, 7, 4, 12, 0, 4,
    127, 15, 8, 3, 0, 12, 5, 2, 18, 10, 8, 0, 16, 6, 14, 11, 17, 1, 9, 2, 7, 21, 9, 19, 3, 13,
    1, 8, 5, 22, 16, 4, 0, 15, 9, 19, 14, 20, 1, 7, 6, 10, 11, 24, 23, 5, 2, 18, 11, 17, 23,
    25, 2, 6, 10, 12, 28, 13, 26, 4, 15, 3, 13, 26, 21, 29, 3, 12, 7, 14, 127, 17, 27, 9, 20,
    6, 15, 22, 28, 31, 4, 8, 12, 16, 18, 33, 30, 8, 5, 22, 17, 11, 14, 6, 35, 25, 27, 18, 24,
    30, 32, 5, 10, 16, 19, 34, 20, 36, 7, 21, 9, 20, 14, 19, 9, 40, 27, 36, 21, 38, 19, 34, 13,
    29, 7, 22, 16, 41, 33, 15, 8, 31, 23, 24, 11, 10, 39, 37, 25, 24, 127, 32, 37, 10, 23, 18,
    25, 23, 17, 11, 45, 39, 35, 26, 42, 29, 43, 12, 28, 13, 27, 40, 35, 46, 14, 20, 17, 28, 31,
    42, 44, 12, 15, 26, 29, 43, 38, 47, 13, 26, 21, 30, 32, 48, 50, 16, 18, 33, 31, 41, 44, 53,
    15, 22, 28, 32, 30, 24, 18, 52, 50, 37, 33, 30, 49, 48, 22, 16, 41, 34, 19, 38, 21, 54, 36,
    51, 35, 46, 45, 56, 17, 27, 25, 36, 20, 34, 19, 55, 40, 54, 37, 39, 52, 57, 24, 23, 32, 38,
    127, 34, 51, 29, 47, 21, 39, 37, 25, 23, 59, 57, 45, 40, 27, 36, 20, 60, 46, 55, 41, 49,
    53, 61, 22, 33, 31, 42, 58, 43, 62, 28, 44, 26, 43, 62, 47, 64, 26, 42, 29, 44, 53, 58, 65,
    28, 31, 42, 45, 39, 35, 25, 63, 59, 56, 46, 60, 56, 68, 27, 40, 35, 47, 38, 43, 29, 69, 51,
    64, 48, 49, 30, 33, 67, 66, 50, 49, 127, 61, 66, 33, 48, 41, 50, 48, 32, 30, 70, 67, 52,
    51, 69, 54, 71, 38, 47, 34, 52, 57, 70, 74, 32, 37, 50, 53, 61, 65, 75, 31, 41, 44, 54, 71,
    55, 73, 34, 51, 36, 55, 40, 54, 36, 72, 60, 73, 56, 68, 63, 77, 35, 46, 45, 57, 59, 74, 78,
    37, 39, 52, 58, 127, 62, 76, 44, 65, 42, 59, 63, 78, 79, 39, 45, 57, 60, 72, 68, 80, 40,
    55, 46, 61, 53, 49, 41, 81, 75, 66, 62, 43, 58, 42, 82, 64, 76, 63, 127, 56, 45, 79, 59,
    77, 64, 47, 62, 43, 84, 69, 82, 65, 58, 53, 44, 86, 76, 75, 66, 67, 81, 85, 49, 48, 61, 67,
    66, 50, 48, 87, 85, 70, 68, 56, 60, 46, 90, 77, 80, 69, 51, 64, 47, 89, 71, 84, 70, 67, 52,
    50, 83, 87, 74, 71, 89, 73, 91, 51, 69, 54, 72, 127, 73, 55, 80, 60, 88, 73, 91, 72, 88,
    54, 71, 55, 74, 78, 83, 92, 52, 57, 70, 75, 65, 61, 53, 94, 86, 81, 76, 86, 82, 96, 58, 65,
    62, 77, 63, 68, 56, 93, 79, 90, 78, 74, 59, 57, 95, 92, 79, 79, 78, 63, 59, 93, 95, 77, 80,
    68, 72, 60, 99, 90, 88, 81, 85, 94, 101, 61, 66, 75, 82, 96, 84, 98, 62, 76, 64, 83, 127,
    74, 70, 100, 87, 92, 84, 69, 82, 64, 97, 89, 98, 85, 87, 101, 102, 66, 67, 81, 86, 76, 75,
    65, 104, 96, 94, 87, 83, 102, 100, 67, 70, 85, 88, 72, 91, 73, 99, 80, 105, 89, 97, 91,
    103, 69, 84, 71, 90, 77, 80, 68, 106, 93, 99, 91, 73, 89, 71, 105, 88, 103, 92, 83, 78, 74,
    108, 100, 95, 93, 79, 90, 77, 109, 95, 106, 94, 86, 81, 75, 107, 104, 101, 95, 92, 79, 78,
    109, 108, 93, 96, 104, 98, 110, 76, 86, 82, 97, 127, 98, 84, 103, 89, 111, 98, 110, 97,
    111, 82, 96, 84, 99, 80, 105, 88, 106, 90, 113, 100, 102, 83, 87, 108, 114, 92, 101, 102,
    107, 112, 81, 85, 94, 102, 101, 87, 85, 114, 112, 100, 103, 91, 97, 89, 116, 105, 111, 104,
    107, 110, 115, 86, 94, 96, 105, 88, 103, 91, 113, 99, 116, 106, 93, 99, 90, 117, 109, 113,
    107, 127, 101, 94, 115, 104, 112, 108, 100, 95, 92, 118, 114, 109, 109, 108, 93, 95, 117,
    118, 106, 110, 98, 104, 96, 119, 111, 115, 111, 97, 110, 98, 116, 103, 119, 112, 107, 102,
    101, 120, 115, 114, 113, 99, 116, 105, 117, 106, 121, 114, 112, 100, 102, 118, 120, 108,
    115, 110, 107, 104, 120, 119, 112, 116, 103, 119, 111, 113, 105, 121, 117, 127, 109, 118,
    113, 121, 106, 118, 120, 108, 114, 117, 121, 109, 119, 111, 115, 110, 121, 116, 120, 120,
    115, 114, 112, 121, 119, 118, 121, 116, 120, 119, 117, 113, 118
  ]::integer[] $f$;

-- ccw rotations when crossing to that neighbour (7 per cell) - for gridDisk (854 entries)
create or replace function public._h3_t_bc_neighbor_rot()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 5, 0, 0, 1, 5, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 5, 0, 0, 5, 0, 0, 2, 5, 1, 0, -1,
    1, 0, 3, 4, 2, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 3, 5, 5, 0, 0, 0, 0, 0, 0, 5, 0, 0, 5, 0, 0,
    0, 5, 1, 0, 0, 1, 3, 0, 0, 1, 0, 0, 1, 3, 0, 0, 1, 0, 3, 3, 3, 0, 0, 0, 0, 5, 0, 0, 3, 5,
    1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 3, 0, 5, 2, 0, 0, 5, 0, 0, 4, 5, 1, 0, 0, 0, 0, 0, 5, 0, 0,
    3, 3, 3, 3, 0, 3, 0, 0, 0, 3, 5, 5, 0, 0, 3, 3, 3, 0, 0, 0, 0, 3, 3, 3, 0, 3, 0, 0, 0, 0,
    3, 5, 5, 0, 0, 0, 1, 0, 1, 0, 1, 0, 3, 3, 3, 0, 3, 0, 0, -1, 3, 0, 5, 2, 0, 0, 0, 0, 3, 0,
    0, 3, 0, 0, 0, 0, 0, 5, 0, 0, 3, 0, 0, 0, 3, 3, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 3, 0, 0, 1,
    0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 3, 3, 3, 3, 0, 3, 0, 0, 1, 3, 0, 0, 1, 0, 3,
    3, 3, 3, 0, 3, 0, 0, 3, 0, 3, 0, 3, 0, 0, 0, 3, 0, 0, 3, 0, 3, 0, 0, 0, 3, 3, 0, -1, 3, 0,
    5, 2, 0, 0, 3, 0, 0, 3, 3, 0, 0, 3, 0, 0, 3, 3, 0, 0, 0, 0, 3, 5, 5, 0, 0, 0, 0, 3, 5, 5,
    0, 0, 3, 3, 3, 0, 0, 0, 0, 0, 1, 3, 0, 0, 1, 0, 0, 3, 0, 0, 3, 3, 0, 0, 0, 3, 0, 3, 0, 0,
    3, 3, 3, 0, 3, 0, 0, 3, 3, 3, 0, 3, 0, 0, -1, 3, 0, 5, 2, 0, 0, 0, 0, 3, 0, 0, 3, 0, 3, 0,
    0, 0, 3, 3, 0, 0, 3, 0, 3, 0, 3, 0, 3, 3, 3, 0, 0, 0, 0, 0, 3, 0, 3, 0, 3, 0, 0, 3, 0, 0,
    3, 3, 0, 3, 3, 3, 0, 0, 3, 0, 0, 0, 3, 0, 3, 0, 0, -1, 3, 0, 5, 2, 0, 0, 3, 3, 3, 3, 3, 0,
    0, 3, 3, 3, 3, 3, 0, 0, 3, 3, 3, 3, 0, 3, 0, 3, 3, 3, 3, 0, 3, 0, -1, 3, 0, 5, 2, 0, 0, 0,
    0, 3, 0, 0, 3, 0, 3, 3, 3, 0, 3, 0, 0, 3, 0, 0, 0, 3, 3, 0, 3, 0, 0, 3, 3, 0, 0, 3, 3, 3,
    0, 0, 0, 0, 3, 0, 0, 3, 3, 0, 0, 0, 3, 0, 0, 3, 3, 0, 0, 0, 3, 0, 3, 0, 0, -1, 3, 0, 5, 2,
    0, 0, 3, 3, 3, 0, 0, 3, 0, 3, 3, 3, 0, 0, 3, 0, 0, 0, 3, 0, 0, 3, 0, 3, 0, 0, 0, 3, 3, 0,
    0, 0, 3, 0, 5, 0, 0, 3, 3, 3, 0, 0, 0, 0, 0, 1, 3, 1, 0, 1, 0, 0, 1, 3, 1, 0, 1, 0, 0, 3,
    0, 3, 0, 3, 0, 0, 3, 0, 3, 0, 3, 0, -1, 3, 0, 5, 2, 0, 0, 0, 3, 0, 0, 3, 3, 0, 0, 0, 3, 0,
    3, 0, 0, 3, 0, 0, 3, 3, 0, 0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 3, 0, 5, 0, 0, 3, 3, 3, 3, 3, 0,
    0, 0, 0, 0, 0, 0, 1, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 3, 0, 5, 0, 0, 5, 0, 0, 5, 5, 0, 0, 0,
    3, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 3, 0, 0, -1, 3, 0, 5, 2, 0, 0, 3, 3, 3,
    0, 0, 3, 0, 5, 0, 0, 5, 5, 0, 0, 0, 1, 3, 1, 0, 1, 0, 3, 3, 3, 0, 0, 3, 0, 3, 3, 3, 0, 0,
    0, 0, 0, 1, 3, 1, 0, 1, 0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 3, 5, 1, 0,
    -1, 3, 0, 5, 2, 0, 0, 5, 0, 0, 5, 5, 0, 0, 0, 1, 0, 4, 5, 1, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0,
    3, 0, 5, 0, 0, 0, 0, 3, 0, 5, 0, 0, 0, 1, 0, 2, 5, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 3, 1,
    0, 1, 0, 5, 0, 0, 5, 5, 0, 0, -1, 1, 0, 3, 4, 2, 0, 0, 1, 0, 0, 5, 1, 0, 0, 0, 0, 0, 0, 1,
    0, 5, 0, 0, 5, 5, 0, 0, 0, 1, 0, 1, 5, 1
  ]::integer[] $f$;

-- neighbour traversal: new digit, class II table (7x7: digit * 7 + dir + 1) - for gridDisk (49 entries)
create or replace function public._h3_t_new_digit_ii()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 1, 2, 3, 4, 5, 6, 1, 4, 3, 6, 5, 2, 0, 2, 3, 1, 4, 6, 0, 5, 3, 6, 4, 5, 0, 1, 2, 4, 5,
    6, 0, 2, 3, 1, 5, 2, 0, 1, 3, 6, 4, 6, 0, 5, 2, 1, 4, 3
  ]::integer[] $f$;

-- neighbour traversal: next direction to carry, class II table - for gridDisk (49 entries)
create or replace function public._h3_t_new_adj_ii()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 5, 0, 0, 0, 2, 3, 0, 0, 2, 0, 1, 3, 3, 0, 0, 0, 0, 0,
    0, 0, 4, 4, 6, 0, 5, 0, 0, 4, 5, 0, 0, 0, 2, 0, 6, 0, 6
  ]::integer[] $f$;

-- neighbour traversal: new digit, class III table - for gridDisk (49 entries)
create or replace function public._h3_t_new_digit_iii()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 0, 2, 3, 4, 5, 6, 0, 1, 3, 4, 5, 6, 0, 1, 2, 4, 5,
    6, 0, 1, 2, 3, 5, 6, 0, 1, 2, 3, 4, 6, 0, 1, 2, 3, 4, 5
  ]::integer[] $f$;

-- neighbour traversal: next direction to carry, class III table - for gridDisk (49 entries)
create or replace function public._h3_t_new_adj_iii()
returns integer[]
language sql immutable parallel safe set search_path = public
as $f$ select array[
    0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 2, 2, 0, 0, 6, 0, 3, 2, 3, 0, 0, 0, 0, 0,
    0, 0, 4, 5, 4, 0, 1, 0, 0, 5, 5, 0, 0, 0, 6, 0, 4, 0, 6
  ]::integer[] $f$;


-- ---------------------------------------------------------------------------
-- 2. Digit and whole-index helpers
-- ---------------------------------------------------------------------------

-- The first non-zero digit going from resolution 1 upward (the "leading"
-- digit), 0 if every digit is 0, which is exactly a pentagon's centre chain.
create or replace function public._h3_leading_nonzero_digit(p_cell bigint)
returns integer
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_res integer := ((p_cell >> 52) & 15)::integer;
  v_d   integer;
begin
  for r in 1..v_res loop
    v_d := ((p_cell >> ((15 - r) * 3)) & 7)::integer;
    if v_d <> 0 then return v_d; end if;
  end loop;
  return 0;
end;
$f$;

-- Rotate every digit of the index 60 degrees counter-clockwise (_h3Rotate60ccw).
create or replace function public._h3_rotate60ccw(p_cell bigint)
returns bigint
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_h   bigint := p_cell;
  v_res integer := ((p_cell >> 52) & 15)::integer;
  v_s   integer;
begin
  for r in 1..v_res loop
    v_s := (15 - r) * 3;
    v_h := (v_h & ~(7::bigint << v_s))
         | ((_h3_t_rot_ccw())[((v_h >> v_s) & 7)::integer + 1]::bigint << v_s);
  end loop;
  return v_h;
end;
$f$;

-- Clockwise twin (_h3Rotate60cw).
create or replace function public._h3_rotate60cw(p_cell bigint)
returns bigint
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_h   bigint := p_cell;
  v_res integer := ((p_cell >> 52) & 15)::integer;
  v_s   integer;
begin
  for r in 1..v_res loop
    v_s := (15 - r) * 3;
    v_h := (v_h & ~(7::bigint << v_s))
         | ((_h3_t_rot_cw())[((v_h >> v_s) & 7)::integer + 1]::bigint << v_s);
  end loop;
  return v_h;
end;
$f$;

-- Rotation about a pentagon centre: after each digit rotation, if the leading
-- digit lands on the deleted k axis (1), rotate the whole index once more past
-- it (_h3RotatePent60ccw / _h3RotatePent60cw).
create or replace function public._h3_rotate_pent60ccw(p_cell bigint)
returns bigint
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_h     bigint := p_cell;
  v_res   integer := ((p_cell >> 52) & 15)::integer;
  v_s     integer;
  v_d     integer;
  v_found boolean := false;
begin
  for r in 1..v_res loop
    v_s := (15 - r) * 3;
    v_d := (_h3_t_rot_ccw())[((v_h >> v_s) & 7)::integer + 1];
    v_h := (v_h & ~(7::bigint << v_s)) | (v_d::bigint << v_s);
    if not v_found and v_d <> 0 then
      v_found := true;
      if _h3_leading_nonzero_digit(v_h) = 1 then
        v_h := _h3_rotate60ccw(v_h);
      end if;
    end if;
  end loop;
  return v_h;
end;
$f$;

create or replace function public._h3_rotate_pent60cw(p_cell bigint)
returns bigint
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_h     bigint := p_cell;
  v_res   integer := ((p_cell >> 52) & 15)::integer;
  v_s     integer;
  v_d     integer;
  v_found boolean := false;
begin
  for r in 1..v_res loop
    v_s := (15 - r) * 3;
    v_d := (_h3_t_rot_cw())[((v_h >> v_s) & 7)::integer + 1];
    v_h := (v_h & ~(7::bigint << v_s)) | (v_d::bigint << v_s);
    if not v_found and v_d <> 0 then
      v_found := true;
      if _h3_leading_nonzero_digit(v_h) = 1 then
        v_h := _h3_rotate60cw(v_h);
      end if;
    end if;
  end loop;
  return v_h;
end;
$f$;

-- ---------------------------------------------------------------------------
-- 3. Simple public functions
-- ---------------------------------------------------------------------------

create or replace function public.h3_get_resolution(p_cell bigint)
returns integer
language sql immutable strict parallel safe set search_path = public
as $f$ select ((p_cell >> 52) & 15)::integer $f$;

-- A pentagon is the centre-child chain (every digit 0) of a pentagon base cell.
-- The low 45 bits hold the 15 digits; shifting out the 7-padding leaves the
-- digits that exist at this resolution.
create or replace function public.h3_is_pentagon(p_cell bigint)
returns boolean
language sql immutable strict parallel safe set search_path = public
as $f$
  select (_h3_t_bc_is_pentagon())[((p_cell >> 45) & 127)::integer + 1] = 1
     and ((p_cell & ((1::bigint << 45) - 1)) >> ((15 - ((p_cell >> 52) & 15)) * 3)::integer) = 0
$f$;

-- isValidCell: reserved bits, mode, base cell range, no digit 7 up to the
-- resolution, all 7s after it, and no leading k-axis digit in a pentagon.
create or replace function public.h3_is_valid_cell(p_cell bigint)
returns boolean
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_res  integer := ((p_cell >> 52) & 15)::integer;
  v_bc   integer := ((p_cell >> 45) & 127)::integer;
  v_tail bigint  := (1::bigint << ((15 - v_res) * 3)) - 1;
  v_seen boolean := false;
  v_d    integer;
begin
  if p_cell < 0                         -- high bit set
     or ((p_cell >> 59) & 15) <> 1      -- mode: cell
     or ((p_cell >> 56) & 7) <> 0       -- reserved
     or v_bc >= 122
     or (p_cell & v_tail) <> v_tail     -- digits beyond the resolution are 7
  then
    return false;
  end if;
  for r in 1..v_res loop
    v_d := ((p_cell >> ((15 - r) * 3)) & 7)::integer;
    if v_d = 7 then return false; end if;
    if not v_seen and v_d <> 0 then
      v_seen := true;
      if v_d = 1 and (_h3_t_bc_is_pentagon())[v_bc + 1] = 1 then return false; end if;
    end if;
  end loop;
  return true;
end;
$f$;

-- cellToParent: set the resolution field and turn the dropped digits into 7s.
-- NULL when p_res is outside 0..15 or finer than the cell.
create or replace function public.h3_cell_to_parent(p_cell bigint, p_res integer)
returns bigint
language sql immutable strict parallel safe set search_path = public
as $f$
  select case
    when p_res < 0 or p_res > 15 or p_res > ((p_cell >> 52) & 15) then null
    else (p_cell & ~(15::bigint << 52)) | (p_res::bigint << 52)
         | ((1::bigint << ((15 - p_res) * 3)) - 1)
  end
$f$;

-- Inclusive [lo, hi] of every descendant at p_child_res (see header). Zero rows
-- when p_child_res is coarser than the cell or above 15.
create or replace function public.h3_cell_to_descendant_range(p_cell bigint, p_child_res integer)
returns table (lo bigint, hi bigint)
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_res  integer := ((p_cell >> 52) & 15)::integer;
  v_mid  bigint;     -- the bits of digits res+1 .. child_res (7 per digit)
  v_base bigint;
begin
  if p_child_res < v_res or p_child_res > 15 then return; end if;
  v_mid  := ((1::bigint << ((15 - v_res) * 3)) - 1)
          & ~((1::bigint << ((15 - p_child_res) * 3)) - 1);
  v_base := ((p_cell & ~(15::bigint << 52)) | (p_child_res::bigint << 52)) & ~v_mid;
  lo := v_base;
  hi := v_base | ((v_mid / 7) * 6);   -- (7 per digit) / 7 * 6 = 6 per digit
  return next;
end;
$f$;

-- ---------------------------------------------------------------------------
-- 4. latLngToCell
-- ---------------------------------------------------------------------------

-- Azimuth from unit vector c to unit vector p (_vec3AzimuthRads), operation for
-- operation as in the C library: local north/east at c, p projected onto the
-- tangent plane, atan2(east, north).
create or replace function public._h3_vec3_azimuth(
  cx double precision, cy double precision, cz double precision,
  px double precision, py double precision, pz double precision)
returns double precision
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  nx double precision; ny double precision; nz double precision;
  ex double precision; ey double precision; ez double precision;
  qx double precision; qy double precision; qz double precision;
  d  double precision; s double precision;
begin
  -- north = normalize(northPole - (northPole . c) c), and (northPole . c) = cz
  nx := (-cz) * cx;
  ny := (-cz) * cy;
  nz := 1.0 + (-cz) * cz;
  d  := sqrt(nx * nx + ny * ny + nz * nz);
  s  := case when d > 0 then 1.0 / d else 0.0 end;
  nx := nx * s; ny := ny * s; nz := nz * s;
  -- east = north x c
  ex := ny * cz - nz * cy;
  ey := nz * cx - nx * cz;
  ez := nx * cy - ny * cx;
  -- q = normalize(p - (p . c) c)
  d  := px * cx + py * cy + pz * cz;
  qx := px + (-d) * cx;
  qy := py + (-d) * cy;
  qz := pz + (-d) * cz;
  d  := sqrt(qx * qx + qy * qy + qz * qz);
  s  := case when d > 0 then 1.0 / d else 0.0 end;
  qx := qx * s; qy := qy * s; qz := qz * s;
  return atan2(qx * ex + qy * ey + qz * ez, qx * nx + qy * ny + qz * nz);
end;
$f$;

-- _faceIjkToH3: resolution-res ijk on an icosahedron face -> index. Walks from
-- the finest resolution up (aperture-7 parent, counter-clockwise for class III
-- levels and clockwise for class II), one digit per level, then maps the res-0
-- ijk to a base cell and rotates into its canonical orientation (with the
-- pentagon special cases). "Normalize" in the C code is subtracting the least
-- component from all three, which is what least() does below.
create or replace function public._h3_face_ijk_to_h3(
  p_face integer, p_i integer, p_j integer, p_k integer, p_res integer)
returns bigint
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  c_one_seventh constant double precision := 0.14285714285714285714285714285714285::double precision;
  v_i integer := p_i;  v_j integer := p_j;  v_k integer := p_k;
  v_li integer; v_lj integer; v_lk integer;   -- this level's ijk
  v_ci integer; v_cj integer; v_ck integer;   -- the parent's centre, back at this level
  v_a integer; v_b integer; v_m integer;
  v_h bigint;
  v_bc integer; v_rots integer; v_idx integer;
begin
  -- mode 1, resolution, all 15 digits 7 (H3_INIT); the base cell is filled in below
  v_h := (1::bigint << 59) | (p_res::bigint << 52) | ((1::bigint << 45) - 1);

  for r in reverse (p_res - 1)..0 loop
    v_li := v_i; v_lj := v_j; v_lk := v_k;
    v_a := v_i - v_k;
    v_b := v_j - v_k;
    if (r + 1) % 2 = 1 then
      -- class III level: _upAp7 then _downAp7
      v_i := round((3 * v_a - v_b) * c_one_seventh)::integer;
      v_j := round((v_a + 2 * v_b) * c_one_seventh)::integer;
      v_k := 0;
      v_m := least(v_i, v_j, v_k);
      v_i := v_i - v_m; v_j := v_j - v_m; v_k := v_k - v_m;
      v_ci := 3 * v_i + v_j;
      v_cj := 3 * v_j + v_k;
      v_ck := v_i + 3 * v_k;
    else
      -- class II level: _upAp7r then _downAp7r
      v_i := round((2 * v_a + v_b) * c_one_seventh)::integer;
      v_j := round((3 * v_b - v_a) * c_one_seventh)::integer;
      v_k := 0;
      v_m := least(v_i, v_j, v_k);
      v_i := v_i - v_m; v_j := v_j - v_m; v_k := v_k - v_m;
      v_ci := 3 * v_i + v_k;
      v_cj := v_i + 3 * v_j;
      v_ck := v_j + 3 * v_k;
    end if;
    -- digit = this level's ijk minus the normalized parent centre, normalized:
    -- a unit vector (or zero) whose digit is 4i + 2j + k
    v_m := least(v_ci, v_cj, v_ck);
    v_ci := v_li - (v_ci - v_m);
    v_cj := v_lj - (v_cj - v_m);
    v_ck := v_lk - (v_ck - v_m);
    v_m := least(v_ci, v_cj, v_ck);
    v_h := (v_h & ~(7::bigint << ((14 - r) * 3)))
         | ((4 * (v_ci - v_m) + 2 * (v_cj - v_m) + (v_ck - v_m))::bigint << ((14 - r) * 3));
  end loop;

  if v_i > 2 or v_j > 2 or v_k > 2 then return null; end if;

  v_idx  := p_face * 27 + v_i * 9 + v_j * 3 + v_k + 1;
  v_bc   := (_h3_t_fijk_base_cell())[v_idx];
  v_rots := (_h3_t_fijk_rot())[v_idx];
  v_h := v_h | (v_bc::bigint << 45);

  if (_h3_t_bc_is_pentagon())[v_bc + 1] = 1 then
    -- force rotation out of the missing k-axis subsequence
    if _h3_leading_nonzero_digit(v_h) = 1 then
      if (_h3_t_bc_cw_offset())[v_bc * 2 + 1] = p_face
         or (_h3_t_bc_cw_offset())[v_bc * 2 + 2] = p_face then
        v_h := _h3_rotate60cw(v_h);
      else
        v_h := _h3_rotate60ccw(v_h);
      end if;
    end if;
    for n in 1..v_rots loop v_h := _h3_rotate_pent60ccw(v_h); end loop;
  else
    for n in 1..v_rots loop v_h := _h3_rotate60ccw(v_h); end loop;
  end if;
  return v_h;
end;
$f$;

-- h3-js latLngToCell(lat, lng, res): degrees in, signed-bigint index out.
create or replace function public.h3_latlng_to_cell(
  p_lat double precision, p_lng double precision, p_res integer)
returns bigint
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_lat double precision; v_lng double precision;
  c_2pi    constant double precision := 6.28318530717958647692528676655900576839433::double precision;
  c_ap7rot constant double precision := 0.333473172251832115336090755351601070065900389::double precision;
  c_sqrt7  constant double precision := 2.6457513110645905905016157536392604257102::double precision;
  c_rsin60 constant double precision := 1.1547005383792515290182975610039149112953::double precision;
  c_inv_u  constant double precision := 2.61803398874989588842::double precision;
  c_third  constant double precision := 1.0::double precision / 3.0;
  c_2third constant double precision := 2.0::double precision / 3.0;
  v_fc   double precision[] := _h3_t_face_center();
  v_face integer := 0;
  v_sqd  double precision := 5.0;
  v_t    double precision;
  x double precision; y double precision; z double precision;
  r double precision; theta double precision;
  a1 double precision; a2 double precision; x1 double precision; x2 double precision;
  r1 double precision; r2 double precision;
  m1 integer; m2 integer;
  v_i integer; v_j integer; v_k integer := 0;
  v_ax integer; v_diff integer; v_m integer;
begin
  -- NaN sorts above every number in Postgres, so `not between` rejects NaN and
  -- Infinity too.
  if p_res < 0 or p_res > 15
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return null;
  end if;

  -- h3-js converts degrees in JS as deg * Math.PI / 180 before calling the C core
  -- (not the C degsToRads constant multiply); keep exactly that order
  v_lat := p_lat * pi() / 180.0;
  v_lng := p_lng * pi() / 180.0;
  r := cos(v_lat);
  x := cos(v_lng) * r;
  y := sin(v_lng) * r;
  z := sin(v_lat);

  -- closest icosahedron face by squared chord distance (first wins on ties)
  for f in 0..19 loop
    v_t := (v_fc[3 * f + 1] - x) * (v_fc[3 * f + 1] - x)
         + (v_fc[3 * f + 2] - y) * (v_fc[3 * f + 2] - y)
         + (v_fc[3 * f + 3] - z) * (v_fc[3 * f + 3] - z);
    if v_t < v_sqd then v_face := f; v_sqd := v_t; end if;
  end loop;

  r := acos(1 - v_sqd * 0.5);
  if r < 0.0000000000000001 then
    -- exactly on a face centre
    return _h3_face_ijk_to_h3(v_face, 0, 0, 0, p_res);
  end if;

  -- theta: counter-clockwise angle from the face's class II i axis (posAngle
  -- is "add 2pi if negative, subtract 2pi if >= 2pi")
  theta := _h3_vec3_azimuth(v_fc[3 * v_face + 1], v_fc[3 * v_face + 2], v_fc[3 * v_face + 3], x, y, z);
  theta := case when theta < 0 then theta + c_2pi else theta end;
  theta := (_h3_t_face_az0())[v_face + 1] - theta;
  theta := case when theta < 0 then theta + c_2pi else theta end;
  if theta >= c_2pi then theta := theta - c_2pi; end if;
  if p_res % 2 = 1 then                      -- class III: rotate by the ap7 angle
    theta := theta - c_ap7rot;
    theta := case when theta < 0 then theta + c_2pi else theta end;
    if theta >= c_2pi then theta := theta - c_2pi; end if;
  end if;

  -- gnomonic scaling, then up to this resolution's unit length (repeated
  -- multiplication, as in C, not a power)
  r := tan(r) * c_inv_u;
  for n in 1..p_res loop r := r * c_sqrt7; end loop;
  x := r * cos(theta);
  y := r * sin(theta);

  -- _hex2dToCoordIJK: the containing hexagon of the planar point
  a1 := abs(x);
  a2 := abs(y);
  x2 := a2 * c_rsin60;
  x1 := a1 + x2 / 2.0;
  m1 := trunc(x1)::integer;
  m2 := trunc(x2)::integer;
  r1 := x1 - m1;
  r2 := x2 - m2;

  if r1 < 0.5 then
    if r1 < c_third then
      v_i := m1;
      v_j := case when r2 < (1.0 + r1) / 2.0 then m2 else m2 + 1 end;
    else
      v_j := case when r2 < (1.0 - r1) then m2 else m2 + 1 end;
      v_i := case when (1.0 - r1) <= r2 and r2 < (2.0 * r1) then m1 + 1 else m1 end;
    end if;
  elsif r1 < c_2third then
    v_j := case when r2 < (1.0 - r1) then m2 else m2 + 1 end;
    v_i := case when (2.0 * r1 - 1.0) < r2 and r2 < (1.0 - r1) then m1 else m1 + 1 end;
  else
    v_i := m1 + 1;
    v_j := case when r2 < (r1 / 2.0) then m2 else m2 + 1 end;
  end if;

  -- fold across the axes for the negative half planes
  if x < 0.0 then
    if v_j % 2 = 0 then
      v_ax := v_j / 2;
      v_diff := v_i - v_ax;
      v_i := v_i - 2 * v_diff;
    else
      v_ax := (v_j + 1) / 2;
      v_diff := v_i - v_ax;
      v_i := v_i - (2 * v_diff + 1);
    end if;
  end if;
  if y < 0.0 then
    v_i := v_i - (2 * v_j + 1) / 2;
    v_j := -v_j;
  end if;

  v_m := least(v_i, v_j, v_k);               -- _ijkNormalize
  return _h3_face_ijk_to_h3(v_face, v_i - v_m, v_j - v_m, v_k - v_m, p_res);
end;
$f$;

-- ---------------------------------------------------------------------------
-- 6. gridDisk
-- ---------------------------------------------------------------------------

-- h3NeighborRotations: the neighbour of p_origin in direction p_dir, where
-- p_rot is the running count of 60-degree ccw rotations to apply to the
-- direction (updated as faces are crossed). o_err: 0 ok, 1 pentagon (the
-- direction is the deleted k axis; C E_PENTAGON), 2 failure (invalid input).
create or replace function public._h3_neighbor_rotations(
  p_origin bigint, p_dir integer, p_rot integer,
  out o_cell bigint, out o_rot integer, out o_err integer)
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  v_cur        bigint := p_origin;
  v_dir        integer := p_dir;
  v_rot        integer := p_rot % 6;
  v_new_rot    integer := 0;
  v_old_bc     integer := ((p_origin >> 45) & 127)::integer;
  v_new_bc     integer;
  v_old_lead   integer;
  v_r          integer := ((p_origin >> 52) & 15)::integer - 1;
  v_old_digit  integer;
  v_next       integer;
  v_s          integer;
  v_adj        boolean := false;
  v_nb         integer;
begin
  o_err := 0;
  if v_dir < 0 or v_dir > 6 then o_err := 2; return; end if;
  if v_old_bc >= 122 then o_err := 2; return; end if;
  for i in 1..v_rot loop v_dir := (_h3_t_rot_ccw())[v_dir + 1]; end loop;
  v_old_lead := _h3_leading_nonzero_digit(p_origin);

  loop
    if v_r = -1 then
      v_nb := (_h3_t_bc_neighbor())[v_old_bc * 7 + v_dir + 1];
      v_new_rot := (_h3_t_bc_neighbor_rot())[v_old_bc * 7 + v_dir + 1];
      if v_nb = 127 then
        -- the deleted k vertex of a pentagon base cell: this edge borders the ik neighbour
        v_nb := (_h3_t_bc_neighbor())[v_old_bc * 7 + 5 + 1];
        v_new_rot := (_h3_t_bc_neighbor_rot())[v_old_bc * 7 + 5 + 1];
        v_cur := _h3_rotate60ccw((v_cur & ~(127::bigint << 45)) | (v_nb::bigint << 45));
        v_rot := v_rot + 1;
      else
        v_cur := (v_cur & ~(127::bigint << 45)) | (v_nb::bigint << 45);
      end if;
      exit;
    end if;
    -- digit at resolution v_r + 1
    v_s := (14 - v_r) * 3;
    v_old_digit := ((v_cur >> v_s) & 7)::integer;
    if v_old_digit = 7 then o_err := 2; return; end if;
    if (v_r + 1) % 2 = 1 then            -- isResolutionClassIII(r + 1): the C code uses the *_II tables here
      v_cur := (v_cur & ~(7::bigint << v_s))
             | ((_h3_t_new_digit_ii())[v_old_digit * 7 + v_dir + 1]::bigint << v_s);
      v_next := (_h3_t_new_adj_ii())[v_old_digit * 7 + v_dir + 1];
    else
      v_cur := (v_cur & ~(7::bigint << v_s))
             | ((_h3_t_new_digit_iii())[v_old_digit * 7 + v_dir + 1]::bigint << v_s);
      v_next := (_h3_t_new_adj_iii())[v_old_digit * 7 + v_dir + 1];
    end if;
    if v_next <> 0 then
      v_dir := v_next;
      v_r := v_r - 1;
    else
      exit;
    end if;
  end loop;

  v_new_bc := ((v_cur >> 45) & 127)::integer;
  if (_h3_t_bc_is_pentagon())[v_new_bc + 1] = 1 then
    if _h3_leading_nonzero_digit(v_cur) = 1 then
      if v_old_bc <> v_new_bc then
        -- walked into the deleted k subsequence of a pentagon base cell
        if (_h3_t_bc_cw_offset())[v_new_bc * 2 + 1] = (_h3_t_bc_home_face())[v_old_bc + 1]
           or (_h3_t_bc_cw_offset())[v_new_bc * 2 + 2] = (_h3_t_bc_home_face())[v_old_bc + 1] then
          v_cur := _h3_rotate60cw(v_cur);
        else
          v_cur := _h3_rotate60ccw(v_cur);
        end if;
        v_adj := true;
      else
        if v_old_lead = 0 then
          o_err := 1; return;
        elsif v_old_lead = 3 then
          v_cur := _h3_rotate60ccw(v_cur);
          v_rot := v_rot + 1;
        elsif v_old_lead = 5 then
          v_cur := _h3_rotate60cw(v_cur);
          v_rot := v_rot + 5;
        else
          o_err := 2; return;
        end if;
      end if;
    end if;

    for i in 1..v_new_rot loop v_cur := _h3_rotate_pent60ccw(v_cur); end loop;

    if v_old_bc <> v_new_bc then
      if v_new_bc = 4 or v_new_bc = 117 then      -- polar pentagons
        if v_old_bc <> 118 and v_old_bc <> 8 and _h3_leading_nonzero_digit(v_cur) <> 3 then
          v_rot := v_rot + 1;
        end if;
      elsif _h3_leading_nonzero_digit(v_cur) = 5 and not v_adj then
        v_rot := v_rot + 1;
      end if;
    end if;
  else
    for i in 1..v_new_rot loop v_cur := _h3_rotate60ccw(v_cur); end loop;
  end if;

  o_cell := v_cur;
  o_rot := (v_rot + v_new_rot) % 6;
end;
$f$;

-- All cells within grid distance p_k of p_origin (the origin included), as an
-- unordered set, equal to h3-js gridDisk. NULL for an invalid origin, p_k < 0 or
-- p_k > 50 (the cap: a disk of k has 3k(k+1)+1 cells, 7,651 at k = 50; KiaKia
-- needs k <= 8, and the cap keeps a stray argument from building a huge array).
--
-- Strategy, as in the C library (gridDiskDistances): first the fast spiral
-- (gridDiskUnsafe), which walks ring by ring with h3NeighborRotations and is
-- only correct away from pentagons. The moment the origin, any visited cell or
-- any step hits a pentagon (or the pentagon distortion error), the spiral is
-- abandoned and the result is rebuilt by a breadth-first search over the six
-- neighbours (gridDiskDistancesSafe), skipping the missing direction of a
-- pentagon. BFS by rings returns the same set as the C recursive version, which
-- keeps the shortest distance to every cell.
create or replace function public._h3_grid_disk_core(
  p_origin bigint, p_k integer, out o_cells bigint[], out o_rings integer[])
language plpgsql immutable strict parallel safe set search_path = public
as $f$
declare
  c_dirs   constant integer[] := array[2, 3, 1, 5, 4, 6];  -- C DIRECTIONS order
  v_out    bigint[];
  v_rg     integer[];  -- grid distance of v_out[i], filled in step
  v_cur    bigint := p_origin;
  v_rot    integer := 0;
  v_ring   integer := 1;
  v_dir    integer := 0;
  v_i      integer := 0;
  v_res    record;
  v_ok     boolean := true;
  v_front  bigint[];
  v_next   bigint[];
  v_vis    bigint[];
  v_c      bigint;
begin
  if p_k < 0 or p_k > 50 or not h3_is_valid_cell(p_origin) then return; end if;
  v_out := array[p_origin]; v_rg := array[0];
  if p_k = 0 then o_cells := v_out; o_rings := v_rg; return; end if;

  -- fast spiral
  if h3_is_pentagon(p_origin) then
    v_ok := false;
  else
    while v_ring <= p_k loop
      if v_dir = 0 and v_i = 0 then
        select * into v_res from _h3_neighbor_rotations(v_cur, 4, v_rot);
        if v_res.o_err <> 0 then v_ok := false; exit; end if;
        v_cur := v_res.o_cell; v_rot := v_res.o_rot;
        if h3_is_pentagon(v_cur) then v_ok := false; exit; end if;
      end if;
      select * into v_res from _h3_neighbor_rotations(v_cur, c_dirs[v_dir + 1], v_rot);
      if v_res.o_err <> 0 then v_ok := false; exit; end if;
      v_cur := v_res.o_cell; v_rot := v_res.o_rot;
      v_out := v_out || v_cur; v_rg := v_rg || v_ring;
      v_i := v_i + 1;
      if v_i = v_ring then
        v_i := 0; v_dir := v_dir + 1;
        if v_dir = 6 then v_dir := 0; v_ring := v_ring + 1; end if;
      end if;
      if h3_is_pentagon(v_cur) then v_ok := false; exit; end if;
    end loop;
    if v_ok then o_cells := v_out; o_rings := v_rg; return; end if;
  end if;

  -- pentagon met: BFS by rings, rotations restart at 0 for every step
  v_vis := array[p_origin]; v_rg := array[0];
  v_front := array[p_origin];
  for d in 1..p_k loop
    v_next := '{}';
    foreach v_c in array v_front loop
      for n in 1..6 loop
        select * into v_res from _h3_neighbor_rotations(v_c, c_dirs[n], 0);
        if v_res.o_err = 0 then v_next := v_next || v_res.o_cell;
        elsif v_res.o_err = 2 then return;
        end if;
      end loop;
    end loop;
    select coalesce(array_agg(x), '{}') into v_front
    from (select unnest(v_next) as x except select unnest(v_vis)) s;
    exit when cardinality(v_front) = 0;
    v_vis := v_vis || v_front;
    v_rg := v_rg || array_fill(d, array[cardinality(v_front)]);
  end loop;
  o_cells := v_vis; o_rings := v_rg;
end;
$f$;

-- h3-js gridDisk: the cells of the disk as an unordered set (ring order in practice).
create or replace function public.h3_grid_disk(p_origin bigint, p_k integer)
returns bigint[]
language sql immutable strict parallel safe set search_path = public
as $f$ select (_h3_grid_disk_core(p_origin, p_k)).o_cells $f$;

-- h3-js gridDiskDistances: every cell of the disk with its grid distance (ring)
-- from the origin, so a caller that needs "which ring is this rider in" pays for
-- ONE disk instead of one per ring. Zero rows for an invalid origin, k < 0 or
-- k > 50. Not ordered; sort by k yourself.
create or replace function public.h3_grid_disk_distances(p_origin bigint, p_k integer)
returns table(cell bigint, k integer)
language sql immutable strict parallel safe set search_path = public
as $f$
  select u.cell, u.k
  from _h3_grid_disk_core(p_origin, p_k) c,
       lateral unnest(c.o_cells, c.o_rings) as u(cell, k)
$f$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: service_role only
-- ---------------------------------------------------------------------------

do $g$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like '\_h3\_%' or p.proname like 'h3\_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$g$;
