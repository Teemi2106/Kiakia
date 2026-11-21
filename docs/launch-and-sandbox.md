# Public site and sandbox domain

The public marketing pages remain available on `kiakia.ng` with their existing
content and layout. Links and calls to action that enter the customer or vendor
app are shown as non-clickable “Coming soon” labels. The sandbox branch serves
the full app at `sandbox.kiakia.ng`; responses from that host are marked noindex.

## Vercel setup

Use the existing Vercel project linked to this repository; keep its current root
directory and build settings:

1. Keep the current production branch connected to `kiakia.ng` and
   `www.kiakia.ng`.
2. Keep a long-lived Git branch named `sandbox` for internal testing. Pushes to
   it create Preview deployments.
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

Production keeps the existing marketing pages and environment. When KiaKia is
ready to accept customers and vendors, restore the app-entry links in the
marketing header, home calls to action, vendor page, and footer.
