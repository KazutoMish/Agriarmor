# AgriArmor / RedRevive

Responsive React + Vite + TypeScript storefront with a Supabase order backend and an admin dashboard. Customers pay offline through cash on delivery, GCash, bank transfer, or pickup. No payment gateway is integrated, and uploading a payment proof does not mark an order as paid.

## Run locally

1. Install Node.js 22 or a newer supported LTS version.
2. Open this project in a terminal and run `npm install`.
3. Copy `.env.example` to `.env.local`. The supplied Supabase URL and publishable key are included. Verify them in your Supabase dashboard if your project rejects requests. Never put a service-role key in a `VITE_` variable; Vite includes these values in the browser bundle.
4. Complete the Supabase setup below.
5. Run `npm run dev` and open the local URL printed by Vite.

On this Windows workspace, double-click `start.cmd` to launch the development server. It uses the checksum-verified portable Node runtime in `.tools/node/` if Node is not installed globally. That ignored runtime is a local convenience; other checkouts need Node.js installed.

Useful commands:

```sh
npm run dev
npm test
npm run test:db
npm run build
npm run preview
```

The frontend can display a sample catalog when live configuration is unavailable. Sample products are previews; order placement and tracking require a configured Supabase project and successful backend requests. Restart the development server after changing environment variables. The supplied URL/key were accepted by a read-only check, but `public.products` was absent (`PGRST205`); apply the SQL before accepting orders.

## Create the Supabase backend

1. Open the intended Supabase project. The included URL points to `nugxapjqwbkfhyymumrk`; use a different project by changing both environment variables.
2. In **SQL Editor**, run the complete contents of `supabase/migrations/001_initial.sql` once. This creates the tables, constraints, RLS policies, order RPCs, and Storage buckets/policies. Review the SQL before applying it to a project that already has tables with these names.
3. Run `supabase/seed.sql` to load the initial RedRevive product variants and promotional banner. No customer discount code is enabled by the seed.
4. In **Authentication → Users**, create the owner's user with a strong password. Confirm the email or create it as confirmed. Keep public sign-ups disabled if customers do not need accounts.
5. Copy that user's UUID, replace the example below, and run it in SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = 'YOUR_AUTH_USER_UUID'::uuid;
```

6. Open `/admin`, sign in with the owner's email/password, and confirm that orders, product editing, promotions, and statistics load. Ordinary authenticated accounts without the `admin` role cannot use the dashboard data.
7. In Authentication settings, set the deployed site URL and allowed redirect URLs for your domain. This app uses password sign-in rather than an OAuth redirect.

The SQL files are deliverables; they are not automatically applied to your Supabase project by installing or running the frontend.

### Local server credentials

The storefront uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.local`. Keep server credentials in the separate, Git-ignored `.env.server.local`; `.env.server.example` lists the supported names for `@supabase/server`. Load that file explicitly for trusted Node processes with `node --env-file=.env.server.local <server-script.mjs>`. Never prefix `SUPABASE_SECRET_KEY` with `VITE_` or import server credentials into `src/`.

Saving these settings does not start a backend or create database tables. Checkout uses the existing Supabase RPCs, which must first be created by the migration using Supabase's SQL Editor, a connected Supabase integration, or a PostgreSQL connection. The project API secret is separate from the database password and Management API access token.

After applying the migration and seed, run `supabase/tests/security.sql` in SQL Editor as `postgres` to exercise anonymous, customer, and admin access, pricing, stock, tracking, and Storage policies. The test uses a transaction and rolls its fixtures back. Alternatively, use a direct database connection from your own terminal:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
```

Keep database connection passwords outside the frontend environment files.

`npm run test:db` also runs the migration, seed, and security suite locally in PGlite without credentials. It supplies small stand-ins for Supabase's Auth and Storage database schemas. This checks PostgreSQL functions, constraints, and RLS; it does not test the hosted Auth API, actual image transfers, or concurrent database sessions. Run the SQL suite and the end-to-end order checks against your Supabase project before launch.

## Payment and fulfillment settings

Set these optional environment variables to the owner's verified account details:

| Variable | Purpose |
| --- | --- |
| `VITE_GCASH_NAME` | Registered GCash account name |
| `VITE_GCASH_NUMBER` | GCash number |
| `VITE_BANK_NAME` | Bank name |
| `VITE_BANK_ACCOUNT_NAME` | Bank account name |
| `VITE_BANK_ACCOUNT_NUMBER` | Bank account number |
| `VITE_WHATSAPP_NUMBER` | Optional WhatsApp destination, international digits only |

Until account details are configured, checkout tells customers to contact AgriArmor for transfer instructions. Bank and GCash payment references are stored with the order. Payment proof images are optional, limited to JPG/PNG/WebP and 5 MB, and stored privately. Admins can view proofs using temporary signed URLs. Confirm transfers manually with your bank or GCash account.

Delivery costs ₱60; a subtotal after discounts of at least ₱499 qualifies for free delivery. Pickup has no delivery fee. Keep the SQL pricing rule and the display helper in `src/lib/utils.ts` aligned when changing this policy. The database calculates the actual amounts from current product prices and valid promotions, so browser-side totals cannot override charges.

## Security model

- All application tables have Row Level Security enabled.
- Public visitors can read available products and currently active promotions. They cannot list or directly read orders, order items, payment proofs, or customer profiles.
- Direct anonymous inserts into orders and order items are disabled. The public order RPC creates both atomically to enforce pricing, stock, and spam checks.
- Checkout calls `quote_order` and `place_order`. The database validates quantities, stock, fulfillment, customer fields, scheduling, promotion dates, and totals, then records the order and its item snapshots in a transaction.
- Tracking uses `track_order` with the order number and normalized customer phone. It returns a limited response for that matching order.
- Public payment-proof uploads require a short-lived server-issued path tied to a matching order and phone; proofs are private. Product image management and proof reading require the admin role.
- The client validates input with Zod. A honeypot and backend checks provide basic spam protection. A production shop can add stronger gateway rate limits or a verified challenge if traffic requires it.
- Admin permissions come from `profiles.role`; editing browser state or the URL does not grant database permissions.

## Customize the shop

Products, stock, availability, image uploads, discount codes, and the promotional banner are managed in `/admin`. Product images are served from the public `product-images` bucket. Current product prices are 250 ml ₱75, 500 ml ₱150, and 1 L ₱300. Review the sample promotion, descriptions, contact links, delivery area, and product directions before launch.

Orders move from pending → confirmed → preparing → out for delivery or ready for pickup → completed. Admins may cancel eligible orders. The dashboard includes search, status/date filters, order details, statistics, and CSV export. Treat CSV downloads as customer data and store them appropriately.

Customer confirmations are shown in the browser. Email and Telegram owner notifications are optional extensions and are not configured by this project.

Cart quantities persist in local browser storage. Confirmation details and interrupted checkout requests are held in session storage for the current tab so a lost network response can be retried with the same request ID. Payment images are never stored in browser storage. The landing page reserves space for customer stories without inventing testimonials; replace it with approved real feedback when available. The footer Facebook and Instagram buttons use the profile links supplied for AgriArmor in `src/components/Layout.tsx`. Product bottle SVGs are packaging illustrations, and the tomato artwork comes from the supplied brand assets.

## Deploy

1. Provision the backend and owner account as above.
2. Add the same public `VITE_` variables in the hosting provider's build settings, including verified payment details. Local `.env.local` is ignored by Git.
3. Set the build command to `npm run build` and publish the `dist` directory.
4. Configure an SPA fallback so requests such as `/products`, `/checkout`, `/track`, and `/admin` serve `index.html`. On Netlify, use `/* /index.html 200`; the included root `vercel.json` configures the Vercel rewrite.
5. Set `VITE_SITE_URL` to your final public HTTPS origin (without a trailing slash). Replace the static canonical/Open Graph site URL and `og:image` URL in `index.html` with absolute URLs for that domain; social crawlers may not run JavaScript. Keep the supplied `public/assets/og-image.png` or replace it with an approved brand image.
6. Test a real low-value order, tracking with both correct and incorrect phone numbers, each offline payment method, a private proof upload, and admin status updates. Verify that an anonymous Supabase client cannot read orders.

Changing Vite environment variables requires rebuilding the frontend. Do not deploy a preview that lacks working database migrations or verified contact/payment information as a live shop.

### Deploy to Vercel

1. Push this project to a GitHub repository, including `src/`, `public/`, `package.json`, `package-lock.json`, and `vercel.json`. Keep the existing `.gitignore` so local environment files and `.tools/` stay out of the repository.
2. In Vercel, choose **Add New → Project**, connect GitHub, and import the repository.
3. Select the directory containing this project's `package.json` as the root. Use **Vite**, build command `npm run build`, output directory `dist`, and Node.js **24.x**. Leave the install command at its automatic setting. The included `vercel.json` supplies the framework, build, output, and SPA routing configuration.
4. Before deploying, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vercel project's environment variables, copying their values from `.env.local`. Select Production and Preview if both environments should use the existing backend. The frontend needs only the publishable browser credentials; keep `.env.server.local` and its secret key local. Add the optional payment/contact variables from `.env.example` when needed.
5. Click **Deploy**. After Vercel assigns the production URL, add `VITE_SITE_URL` with that HTTPS origin, without a trailing slash, then redeploy to bake it into the frontend. In Supabase **Authentication → URL Configuration**, set the Site URL to the same production origin and configure redirect URLs if using auth redirects.
6. Open `/products`, `/cart`, and `/admin` on the deployed URL and refresh to confirm routing. Verify the catalog prices and checkout quote against the existing Supabase backend.

Vercel hosts the frontend; the existing Supabase database, authentication, and storage continue running in Supabase. Deploying this repository does not apply SQL migrations.

Official references: [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite), [Vercel environment variables](https://vercel.com/docs/environment-variables), and [Supabase Auth URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Project layout

```text
src/                 React pages, components, state, and Supabase client
supabase/migrations/001_initial.sql  Database, RLS, RPCs, and Storage setup
supabase/seed.sql                    Initial catalog and banner
supabase/tests/security.sql          Rollback-only database integration checks
tests/               Checkout and cart input checks
public/              Public brand assets and sharing image
.env.example         Public configuration template
```
