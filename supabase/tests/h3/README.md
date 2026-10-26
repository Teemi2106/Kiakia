# H3 in plpgsql: generator and verification tooling

`supabase/migrations/0099_h3_core.sql` is GENERATED. Do not edit it by hand.
Edit `migration.template.sql` (the functions) and rebuild; the lookup tables come
from the H3 v4.5.0 C sources via `gen-tables.mjs` -> `tables.json`.

Dev-only tooling, not part of the pnpm workspace (`h3-js` 4.5.0 is the reference):

    cd supabase/tests/h3
    pnpm install --ignore-workspace
    node build-migration.mjs                # rewrites supabase/migrations/0099_h3_core.sql
    node gen-pgtap.mjs                      # rewrites supabase/tests/h3_core.sql (small pgTAP subset)

Exhaustive verification against h3-js (migration already applied to the DB;
run from the repo root, `<db>` is the local Postgres container):

    node supabase/tests/h3/verify-core.mjs out.sql --no-migration   # latLngToCell, parent, validity, ranges
    node supabase/tests/h3/verify-disk.mjs disk.sql                 # gridDisk, compared as sets
    docker exec -i <db> psql -U postgres -v ON_ERROR_STOP=1 -f - < out.sql
    docker exec -i <db> psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/h3_core.sql

Every report must show 0 mismatches. `verify-core.mjs` also prints a "knife-edge"
group (points within about one ulp of a cell vertex): 89 of those 5,000 vectors
land in a different cell than h3-js. These are floating-point tie cases: the point
sits exactly on a vertex shared by the cells, the libm last bit decides, and the
SQL result is always a cell that shares that vertex. That is expected and is not
counted as a mismatch.

`verify-disk.mjs` also checks `h3_grid_disk_distances` against h3-js `gridDiskDistances` (cell, ring pairs).

`h3_grid_disk` is capped at k = 50 (NULL above). `disk.sql` takes about two
minutes because it includes pentagon disks at k up to 30.
