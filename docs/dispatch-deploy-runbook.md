# Deploying sequential dispatch (migrations 0099-0109) to the hosted project

Project ref: `jvtgnxseilkavwqulbcc`. Hosted is at migration 0098 (checked with
`supabase migration list --linked`). Order matters: functions and secrets first,
migrations second, web app last. Forward-fix only: there is no rollback for
0099-0109, so take the backup first and deploy in a quiet window (few orders
being prepared).

Run from the repo root in PowerShell. `npx supabase@2.121.0` is the CLI used
during development.

## 0. Backup
Dashboard > Database > Backups, or:

    npx supabase@2.121.0 db dump --linked -f backup-schema.sql
    npx supabase@2.121.0 db dump --linked --data-only -f backup-data.sql

Keep these files out of git (they contain personal data).

## 1. Function secret (must exist before 0103)

    $s = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    npx supabase@2.121.0 secrets set MESSAGE_WORKER_SECRET=$s --project-ref jvtgnxseilkavwqulbcc
    $s    # keep this value for step 3

Optional now, needed when you turn email/SMS on: `SITE_URL`,
`MESSAGE_UNSUBSCRIBE_SECRET` (same value in the web app env), `RESEND_API_KEY`,
`MESSAGE_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `TERMII_API_KEY`,
`TERMII_SENDER_ID`, `TERMII_WEBHOOK_TOKEN`. Rider push works without them;
email and SMS sends will fail until they are set.

## 2. Deploy the Edge Functions BEFORE applying 0103

    npx supabase@2.121.0 functions deploy message-worker --project-ref jvtgnxseilkavwqulbcc
    npx supabase@2.121.0 functions deploy message-webhooks --project-ref jvtgnxseilkavwqulbcc
    npx supabase@2.121.0 functions deploy dispatch-push --project-ref jvtgnxseilkavwqulbcc

(`message-webhooks` and `message-worker` use `verify_jwt = false` from
`supabase/config.toml`; their own secret or signature is the credential.) If the
old worker is live when 0103 lands, offer pushes queued with no address are
suppressed permanently.

## 3. Vault secrets (SQL editor, as postgres)

    select vault.create_secret('https://jvtgnxseilkavwqulbcc.functions.supabase.co/message-worker', 'message_worker_function_url');
    select vault.create_secret('<the value of $s from step 1>', 'message_worker_secret');

If they already exist from the 0096 setup, update them instead of creating.
`dispatch_push_function_url` / `dispatch_push_service_role_key` from 0065 are
only needed for rollback.

## 4. Migrations

    npx supabase@2.121.0 db push --linked

It must list 0099 to 0109 and nothing else. If the CLI login fails with
EAUTHQUERY, retry, or use the direct connection:
`db push --db-url "postgresql://postgres:<password>@db.jvtgnxseilkavwqulbcc.supabase.co:5432/postgres"`.
0100 patches the 0098 function bodies textually and aborts (inside its
transaction) if hosted does not have exactly the 0098 bodies.

## 5. Verify (SQL editor)

    select jobname, schedule, active from cron.job order by jobname;
    -- expect dispatch-tick (5 seconds); sweep-dispatch-offers and
    -- dispatch-orders-nearing-prep-completion are gone
    select * from cron_job_health();
    select admin_dispatch_health();   -- healthy: true, problems: []
    select key, value_int from platform_settings where key like 'dispatch_%' order by key;

If `healthy` is false, the Overview shows a red banner with the same problems.

## 6. Web app
Deploy the web app after the migrations (the admin dispatch pages call RPCs
created by 0099-0109). Set `MESSAGE_UNSUBSCRIBE_SECRET` in the web app env if
promotions will be sent.

## 7. After
- Place one real test order and watch it: `/admin/dispatch` shows the live
  offer, the rider app receives it, a decline moves to the next rider.
- `packages/db/src/generated.ts` is hand-edited for these migrations; run
  `pnpm typecheck` after any regeneration.
- CI does not run the full-scale concurrency harness or the e2e cycle: run
  `supabase/tests/concurrency/run.mjs` and the e2e cycle before the next
  dispatch change.
