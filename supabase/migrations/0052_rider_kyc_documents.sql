-- KiaKia - rider KYC documents.
--
-- register_rider() (0026_rider_self_service.sql) only ever accepted
-- vehicle_type/plate_number. There has never been a way for a rider to
-- submit an ID, a driver's licence, or a vehicle photo - so approve_rider()/
-- reject_rider() (0027_rider_kyc_admin_approval.sql) have had literally
-- nothing to review; every approval to date could only be a rubber stamp
-- on vehicle_type/plate_number text fields. This migration builds the
-- missing document-submission surface: a private storage bucket, a metadata
-- table, a rider-facing submit RPC, and an admin approve/reject RPC pair.
--
-- PRIVATE BUCKET, UNLIKE vendor-media/avatars - these are government ID
-- photos, a driver's licence, and a vehicle photo: real PII, not something
-- shown on a public storefront. vendor-media (0036) and avatars (0046) are
-- both deliberately public buckets with NO storage.objects RLS policy,
-- because their only write path is a Server Action using the service-role
-- client after that action's own authorization check - the object itself
-- is meant to be publicly viewable once uploaded, so a public bucket is the
-- correct choice there. Neither reasoning applies here: (a) these files
-- must never be publicly readable, and (b) the rider mobile app uploads
-- DIRECTLY from the device using the rider's own JWT - there is no Server
-- Action in front of it (this repo has no rider UI at all, per every prior
-- rider migration's own header), so the object-store write path has no
-- service-role gate to rely on. storage.objects RLS is therefore not
-- optional here the way it was for vendor-media/avatars - it is the only
-- thing standing between a rider's device and every OTHER rider's ID
-- photos.
--
-- rider_documents WRITE MODEL - a deliberate deviation worth calling out
-- explicitly. A first read of "rider reads and inserts own rows" suggests
-- a plain RLS insert policy (`rider_id = auth.uid()`). This migration does
-- NOT do that - it revokes insert/update/delete from `authenticated`
-- entirely and routes every write through submit_rider_document() (below),
-- for three concrete reasons: (1) resubmitting a document (a rider
-- re-uploading a clearer ID photo after a rejection) needs upsert-on-
-- doc_type-with-status-reset-to-pending semantics, which a plain RLS
-- INSERT policy cannot express atomically - two concurrent submissions for
-- the same doc_type would otherwise race against the unique(rider_id,
-- doc_type) constraint instead of cleanly upserting; (2) validating that
-- p_storage_path actually belongs to the caller (begins with
-- `auth.uid()::text || '/'`) needs to happen exactly once, in the one place
-- that also does the upsert, rather than being duplicated as both a table
-- CHECK constraint and an RPC-side check that could drift apart; (3) this
-- matches the dominant idiom already established across this schema for
-- any table where a specific invariant needs protecting end to end -
-- dispatch_offers (0019), order_delivery_codes (0022), order_rider_locations
-- (0026) - "revoke every authenticated-reachable write, route exclusively
-- through a narrow SECURITY DEFINER RPC" - rather than the profiles-style
-- "allow the write, protect one column with a trigger" idiom
-- (protect_profile_status(), 0007), which exists there specifically because
-- profiles has many legitimately self-service columns alongside the one
-- protected one. rider_documents has no legitimately-rider-writable column
-- once storage_path validation and the upsert-reset semantics are both
-- routed through one function, so the narrower "no direct write path at
-- all" posture is the correct - and simpler - choice, not merely a
-- defensible alternative. Given this, a BEFORE UPDATE trigger guarding
-- status/review_note specifically would be redundant: there is no
-- authenticated-reachable UPDATE at all for it to protect against.

-- ---------------------------------------------------------------------------
-- storage bucket: rider-kyc (private)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rider-kyc',
  'rider-kyc',
  false,
  10485760, -- 10MiB - generous enough for a phone-camera photo or a scanned PDF ID
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- storage.objects already has row level security enabled by Supabase's
-- storage extension itself - not re-enabled here, only scoped further with
-- the policies below. Every policy is scoped to bucket_id = 'rider-kyc'
-- specifically, so none of this affects vendor-media/avatars' deliberately
-- policy-free posture (0036/0046).
--
-- storage.foldername(name) returns the path split on '/' as text[] - a
-- rider app uploading to `<their own auth.uid()>/government_id.jpg` puts
-- their own uid as the first segment, which is what every policy below
-- checks. No cross-rider read/write/delete is possible: a rider whose own
-- uid is not the first path segment of an object is matched by none of
-- these policies, and RLS with zero matching policies denies by default.
create policy "riders read own kyc objects" on storage.objects for select
  using (bucket_id = 'rider-kyc' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "riders upload own kyc objects" on storage.objects for insert
  with check (bucket_id = 'rider-kyc' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "riders update own kyc objects" on storage.objects for update
  using (bucket_id = 'rider-kyc' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'rider-kyc' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "riders delete own kyc objects" on storage.objects for delete
  using (bucket_id = 'rider-kyc' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- rider_documents
-- ---------------------------------------------------------------------------

create table rider_documents (
  id            uuid primary key default uuid_generate_v7(),
  rider_id      uuid not null references riders (user_id),
  doc_type      text not null check (doc_type in ('government_id', 'drivers_license', 'vehicle_photo')),
  storage_path  text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (rider_id, doc_type)
);

comment on table rider_documents is
  'One row per (rider, doc_type) - a resubmission overwrites storage_path and resets status to pending rather than accumulating history rows, mirroring riders.kyc_status itself being a single current value, not a log. Written only by submit_rider_document() (rider-facing) and approve_rider_document()/reject_rider_document() (admin, service_role only) - no authenticated-reachable write path exists at all, same posture as dispatch_offers/order_delivery_codes/order_rider_locations. See this migration''s header for why a plain RLS insert policy was deliberately not used here.';

create trigger rider_documents_set_updated_at
  before update on rider_documents
  for each row execute function set_updated_at();

create index rider_documents_rider_id_idx on rider_documents (rider_id);

alter table rider_documents enable row level security;

create policy "rider reads own documents" on rider_documents for select
  using (rider_id = auth.uid());

revoke insert, update, delete on rider_documents from authenticated;

-- ---------------------------------------------------------------------------
-- submit_rider_document() - the only writer of rider_documents reachable by
-- `authenticated`.
-- ---------------------------------------------------------------------------

create or replace function submit_rider_document(
  p_doc_type     text,
  p_storage_path text
)
returns rider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document rider_documents;
begin
  if auth.uid() is null then
    raise exception 'submit_rider_document: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from riders where user_id = auth.uid()) then
    raise exception 'submit_rider_document: no rider row for the caller - call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_doc_type not in ('government_id', 'drivers_license', 'vehicle_photo') then
    raise exception 'submit_rider_document: unknown doc_type %', p_doc_type
      using errcode = 'check_violation';
  end if;

  -- The one check that makes storage.objects RLS (above) and this table's
  -- metadata agree with each other: a rider can upload only into their own
  -- folder, but nothing before this check stopped them from then pointing a
  -- rider_documents row's storage_path at some OTHER rider's object path
  -- (which they could not read via the storage RLS above, but a reviewing
  -- admin using the service-role key bypasses that RLS entirely and would
  -- unknowingly review the wrong rider's file). Comparing the literal
  -- prefix, not just extracting the folder segment, so a path with no '/'
  -- at all is also rejected rather than passing some looser check.
  if p_storage_path is null or left(p_storage_path, length(auth.uid()::text) + 1) <> auth.uid()::text || '/' then
    raise exception 'submit_rider_document: storage_path % does not belong to the caller', p_storage_path
      using errcode = 'insufficient_privilege';
  end if;

  -- Upsert on (rider_id, doc_type): a resubmission (e.g. after rejection, a
  -- rider uploads a clearer photo) replaces storage_path and forces status
  -- back to 'pending' - review_note from a prior rejection is cleared too,
  -- since it refers to the document being replaced.
  insert into rider_documents (rider_id, doc_type, storage_path, status, review_note)
  values (auth.uid(), p_doc_type, p_storage_path, 'pending', null)
  on conflict (rider_id, doc_type) do update set
    storage_path = excluded.storage_path,
    status       = 'pending',
    review_note  = null
  returning * into v_document;

  return v_document;
end;
$$;

comment on function submit_rider_document(text, text) is
  'Upserts the CALLER''S OWN rider_documents row for p_doc_type, always resetting status to pending and clearing review_note on resubmission. Validates that p_storage_path begins with auth.uid()::text || ''/'' so a rider can never point a document row at another rider''s uploaded object, independent of - and in addition to - the storage.objects RLS policies (above) that already stop them from uploading there in the first place.';

revoke execute on function submit_rider_document(text, text) from public;
grant execute on function submit_rider_document(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- approve_rider_document() / reject_rider_document() - mirrors
-- approve_rider()/reject_rider() (0027_rider_kyc_admin_approval.sql)
-- exactly: service_role callers only, with a real admin/superadmin
-- user_roles row for p_actor_id. Never grant to authenticated.
-- ---------------------------------------------------------------------------

create or replace function approve_rider_document(p_document_id uuid, p_actor_id uuid)
returns rider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document     rider_documents;
  -- Same NULL-safe role check as 0018/0027/0030's admin branches - see
  -- those migrations for why the current_setting fallback and `is distinct
  -- from` matter here.
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'approve_rider_document: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'approve_rider_document: actor % is not an admin', p_actor_id;
  end if;

  update rider_documents
  set status = 'approved', review_note = null
  where id = p_document_id
  returning * into v_document;

  if not found then
    raise exception 'approve_rider_document: document % does not exist', p_document_id
      using errcode = 'no_data_found';
  end if;

  return v_document;
end;
$$;

comment on function approve_rider_document(uuid, uuid) is
  'Sets rider_documents.status = ''approved''. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id - mirrors approve_rider() (0027_rider_kyc_admin_approval.sql). Does not itself touch riders.kyc_status - an admin approves each document independently and calls approve_rider() separately once every required document is approved; this migration does not invent an auto-approve-on-N-of-3-documents rule that no product decision has actually specified. Never grant to authenticated.';

revoke execute on function approve_rider_document(uuid, uuid) from public, authenticated;
grant execute on function approve_rider_document(uuid, uuid) to service_role;

create or replace function reject_rider_document(p_document_id uuid, p_actor_id uuid, p_note text)
returns rider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document     rider_documents;
  v_caller_role  text := coalesce(auth.role(), current_setting('role', true));
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'reject_rider_document: requires the service-role key';
  end if;

  if p_actor_id is null or not exists (
    select 1 from user_roles where user_id = p_actor_id and role in ('admin', 'superadmin')
  ) then
    raise exception 'reject_rider_document: actor % is not an admin', p_actor_id;
  end if;

  update rider_documents
  set status = 'rejected', review_note = p_note
  where id = p_document_id
  returning * into v_document;

  if not found then
    raise exception 'reject_rider_document: document % does not exist', p_document_id
      using errcode = 'no_data_found';
  end if;

  return v_document;
end;
$$;

comment on function reject_rider_document(uuid, uuid, text) is
  'Sets rider_documents.status = ''rejected'' with an admin-supplied p_note - the rider app reads review_note (via the "rider reads own documents" RLS policy above) to show the rider why, and submit_rider_document() clears it automatically the moment they resubmit. service_role callers only, with a real admin/superadmin user_roles row for p_actor_id. Never grant to authenticated.';

revoke execute on function reject_rider_document(uuid, uuid, text) from public, authenticated;
grant execute on function reject_rider_document(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Frontend-dev note: same shape as 0021/0027's own footer notes - an admin
-- Server Action should call approve_rider_document()/reject_rider_document()
-- via createAdminClient() (lib/supabase/admin.ts), after
-- requireAdminContext() (apps/web/src/lib/auth/dal.ts) verifies the caller
-- holds admin/superadmin, passing (p_document_id, p_actor_id: session.userId
-- [, p_note]). No admin UI belongs in this repo - a separate frontend-dev
-- pass builds the (admin) route group against this contract.
-- ---------------------------------------------------------------------------
