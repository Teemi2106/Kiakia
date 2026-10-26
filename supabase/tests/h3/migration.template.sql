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

-- @@TABLES@@

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
