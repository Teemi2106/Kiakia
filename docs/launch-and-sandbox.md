# Launch hold and sandbox domain

The production domains `kiakia.ng` and `www.kiakia.ng` are placed in a launch
hold by `apps/web/src/proxy.ts`. Page requests show the KiaKia Coming Soon page;
direct links to app routes do the same. API requests and writes return `503`.
The `sandbox.kiakia.ng` host is not held, so it can serve the full app from a
separate Git branch deployment.

## Vercel setup

Use the existing Vercel project linked to this repository; keep its current root
directory and build settings:

1. Keep the current production branch connected to `kiakia.ng` and
   `www.kiakia.ng`.
2. Create a long-lived Git branch named `sandbox` from the code internal testers
   should use, then push it so Vercel creates a Preview deployment.
3. In the project’s **Settings → Domains**, add `sandbox.kiakia.ng`. Edit that
   domain, connect it to the **Preview** environment, and enter `sandbox` as the
   Git branch. Vercel will keep the domain on the latest deployment from that
   branch. See [Assigning a domain to a Git branch](https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch).
4. Add the DNS record Vercel shows for `sandbox.kiakia.ng` at the domain’s DNS
   provider. Do not change the existing apex (`kiakia.ng`) record. Vercel’s
   [custom domain guide](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
   covers domain verification and DNS setup.
5. If the sandbox should be limited to staff, enable Vercel Deployment
   Protection for Preview deployments and grant access to the testers.

Branch domains use Preview environment variables. Configure those independently
from Production, using the variable names in `apps/web/.env.example`:

- Point Preview at a separate Supabase project with test data. Avoid using the
  live production database for internal testing.
- Set `NEXT_PUBLIC_SITE_URL=https://sandbox.kiakia.ng` in Preview.
- Use sandbox payment credentials and test-only service credentials in Preview.
- In Supabase Auth, allow `https://sandbox.kiakia.ng/auth/callback**` as a
  redirect URL and set the sandbox project’s site URL accordingly.

Production stays on the current production environment. Merging the tested
sandbox work into the production branch updates the main deployment, which will
continue showing Coming Soon until the launch hold is removed from
`apps/web/src/proxy.ts`.
