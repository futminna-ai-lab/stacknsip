# Activate the Stack & Sip dashboard

Your Supabase project URL and publishable key have been added to connection.json. The project is https://dsjbgccckmzibhcnpoei.supabase.co. You still need to install the database and configure a Netlify site. Your existing ChatGPT-hosted website is unchanged; this package becomes the independently hosted version when deployed.

## 1. Create the database

1. Sign in at https://supabase.com/dashboard and create a new project.
2. Open the project's SQL Editor. Paste the complete contents of `supabase/install.sql` and run it **once on a new project**. This combined file installs the schema, tracking function and menu in one step.
3. Alternatively, run schema.sql followed by seed.sql. Do not run both installation methods.
4. After either install method, apply the additive migrations in this order: `002_bank_transfer_payments.sql`, `003_card_and_external_checkout.sql`, `004_delivery_receipt_before_staff.sql`, `005_offer_customizations.sql`, `006_configurable_offer_options.sql`, `007_quote_first_checkout.sql`, `008_receipt_checkout_refinements.sql`, `009_paystack_payments.sql`, `010_included_options_are_optional.sql`, `011_order_card_submission.sql`, then `012_release_receipt_verified_deliveries.sql`. Migrations 006–012 add configurable options, locked checkout quotes, bank receipt support, Paystack processing and verification, correct included package allowances, a legacy service-role-only direct-submission RPC, and staff-queue visibility after transfer receipt submission; they do not reinstall or reset production data. Do not skip 003 or 004. Existing orders and snapshots remain intact.
5. Confirm the Table Editor shows 13 categories, 84 products and one shop settings row. The temporary Abuja Municipal delivery fee is ₦6,500; staff can update it later.

The schema also creates the public `menu-images` bucket, protected staff upload permissions and an owner access record for **umar.umar@st.futminna.edu.ng**. The record alone is not a login account; invite the owner in step 4.

Do not run this schema against an existing production database. It is an initial installation, not a migration or a restore script. Later menu edits belong in the dashboard; do not rerun the seed to reset them.

## 2. Deploy the complete project on Netlify

Recommended: extract the ZIP, put **all of the extracted project contents** into a GitHub repository, then import that repository into Netlify. Include `public`, `netlify`, `supabase`, `scripts`, `package.json` and `netlify.toml` at the repository root.

Netlify settings are already in `netlify.toml`:

- Build command: `node scripts/prepare-config.cjs`
- Publish directory: `public`
- Functions directory: `netlify/functions`

Use Node 24 for builds. Apply all database migrations through `012_release_receipt_verified_deliveries.sql` before deployment. Netlify deploys the quote and payment functions in `netlify/functions`, including `create-order-quote`, `quote-upload-url`, `quote-validate-receipt`, `place-quoted-order`, `initialize-paystack-payment`, `verify-paystack-payment`, `paystack-webhook`, `order-status`, `order-receipt`, `payment-upload-url`, `payment-submit` and `payment-receipt-url`. A static drag-and-drop upload of just `public` will not provide these server functions or run the configuration build. Use a Git-connected deployment for this package.

This package now connects to your supplied Supabase project by default. Install the schema and seed before deployment so the live menu can load. Copy your resulting HTTPS Netlify address for the next steps.

## 3. Add the connection settings

From Supabase Project Settings → API / API Keys, obtain your project URL, publishable key and server secret key. Add these as environment variables in Netlify:

| Variable | Value | Where it is used |
| --- | --- | --- |
| `SUPABASE_URL` | Your HTTPS Supabase project URL | Build and Functions |
| `SUPABASE_PUBLISHABLE_KEY` | The `sb_publishable_…` key, or legacy `anon` key | Build |
| `SUPABASE_SECRET_KEY` | The `sb_secret_…` key, or legacy `service_role` key | Functions only |
| `NODE_VERSION` | `24` | Build |

If your Netlify plan does not expose variable scopes, enter the variables for the deployment environment. The build script only writes the URL and publishable key into the website. The server secret is read exclusively inside Functions.

**Never paste the secret/service_role key into chat, HTML, `config.js`, GitHub or a public file.** Add it directly through Netlify's environment settings. The `.env.example` contains names and blank values only; it is not automatically loaded by this package.

## 4. Configure payment instructions

After applying migrations through `008_receipt_checkout_refinements.sql` and deploying the Netlify functions, sign in to the staff dashboard as the café owner and open **Shop settings**. Enter the real bank name, account name, account number, and customer payment instructions, then save. No bank details or transfer instructions are prefilled. Customers cannot request a bank-transfer quote until all four fields are configured. Staff who are not the owner cannot read or change these payment fields. Owner edits use a settings-version check; refresh the dashboard before retrying if another owner session has changed them.

Receipt uploads accept PDF, JPG, PNG and WebP files up to 5 MB. Customers choose bank transfer, receive a locked quote, upload their receipt and place the order. Paystack customers are sent to the secure payment modal; the server verifies each transaction before creating an order.

The bundled connection.json already provides your public URL/key when no public environment overrides are set. The server secret must still be added in Netlify; it is never bundled. To override the public connection for another project, set both URL and publishable key together.

Trigger a new deployment after adding the variables. Updating an environment variable without rebuilding will not update the browser configuration.

## 5. Configure Paystack

In Netlify site settings → Environment variables, add the keys from Paystack Dashboard → Settings → API Keys & Webhooks for the same mode (test or live):

| Variable | Value | Where it is used |
| --- | --- | --- |
| `PAYSTACK_PUBLIC_KEY` | `pk_test_…` or `pk_live_…` | Sent to the customer browser to open Paystack Inline |
| `PAYSTACK_SECRET_KEY` | `sk_test_…` or `sk_live_…` | Netlify Functions only: initialize configuration, verify transactions and validate webhook signatures |

Never put the secret key in website code, a public environment variable, Git, or chat. The payment-method selector keeps bank transfer available when Paystack is not configured.

Set the webhook URL to `https://<your-netlify-site>/.netlify/functions/paystack-webhook`. Netlify independently verifies the issued reference, NGN currency, status and quoted amount; webhook events undergo signature validation and the same server verification.

## 6. Set up owner login and invitations

1. In Supabase Authentication → URL Configuration, set Site URL to your Netlify origin, e.g. `https://your-site.netlify.app`.
2. Add the exact redirect URL `https://your-site.netlify.app/admin.html` to the allowed redirect URLs. Add the corresponding URL later if you use a custom domain.
3. In Authentication → Users, choose **Invite user** and invite **umar.umar@st.futminna.edu.ng**. Use the dashboard URL as the redirect destination where available.
4. Open the invitation email, set a password and visit `/admin.html`. If an invitation opened the homepage, use the dashboard's Forgot password button after ensuring `/admin.html` is an allowed redirect URL.
5. Sign in with the invited owner account. The verified email must match the owner record above.
6. Use Staff access in the dashboard to invite café staff. Only the owner can grant or revoke access. Staff need to accept their invitation and set their password before signing in.

There is no public signup screen. You can disable public signups in Supabase Authentication settings; administrator invitations should remain available. If the owner account already exists, use a password reset instead of creating a duplicate user.

Configure your own SMTP email provider in Supabase Authentication for reliable production invitations and password resets. Supabase's default email service is restricted and may prevent delivery to additional staff. This package does not include an SMTP account or automatic order emails.

## 7. Check the live workflow before taking orders

1. Sign in as owner and change one product's price and photo. Refresh its customer category/product page and confirm the new details appear.
2. Use the quick availability toggle on the menu card to mark the product sold out. Confirm it remains listed with purchasing disabled, an already-open customer page refreshes availability when revisited, and a stale cart names the sold-out item instead of placing it. Restore it after testing.
3. Open a configurable offer. Package-included syrups/toppings should be automatic, with no required selections. Every optional add-on dropdown should start at “No, thank you”; choosing an available extra must show its price and update base + extras = unit total and unit total × quantity = line total. Confirm differently customized copies remain separate cart lines.
4. Extra syrups and toppings use their existing Extras product prices. In Menu → Configure options, change a choice's stock, included allowance, minimum/maximum paid extras, price, and availability. Maximum is a total limit that includes the package allowance. Choices without a configured price cannot be sold as add-ons. Confirm the customer menu updates and a stale cart identifies the unavailable choice; checkout also verifies current stock on the server. Re-enable the choices after testing.
5. In Staff dashboard → Shop settings, enter the customer-facing bank name, account name, account number and instructions. Save these before testing bank transfer.
6. Enter a small pickup test order, select bank transfer and submit the customer form. Confirm the server returns a 30-minute quote with the correct live prices and bank details. Upload a JPG, PNG or PDF receipt under 5 MB, then place the order; confirm it appears in Orders as Verification pending with a private tracking link.
7. Enter a separate test order, select Paystack and provide an email address. Confirm the secure Paystack modal offers the payment methods enabled for the merchant account. Make a test payment and verify the order enters Orders only after server-side payment verification.
8. Confirm the customer tracking page reports the current payment status and remains pending until staff updates fulfilment. Try moving an unpaid order to Preparing and confirm the server rejects it. Reject another test receipt with a reason, then test replacement.
9. Change a selected item or option to unavailable after creating a cart, then request a quote. Confirm the server rejects it instead of silently repricing or creating an order.
10. Confirm the downloadable tracking receipt reflects current order/payment statuses and has a generation timestamp. Change order status and confirm private tracking refreshes within 15 seconds.
11. Invite a staff account and verify it can manage orders/menu/options but cannot invite others. Revoke that account and confirm access stops.
12. Pause online ordering and confirm quote creation is rejected. Resume when ready; check the mobile dashboard and customer pages.

Mark test orders cancelled so staff can distinguish them from real requests.

## Operating the café

- Keep Orders open on the café device to receive the 30-second refreshes. It does not notify staff after the browser tab is closed.
- Customers choose bank transfer or Paystack from the checkout form. Transfer orders enter the dashboard after receipt submission; Paystack orders enter after server-side verification.
- UpMenu orders remain in UpMenu. Its existing link does not synchronize its menu or orders with Supabase.
- Bank transfer is manual: staff must compare the receipt to the actual bank transaction and verify or reject it in Orders.
- Change prices, availability and pictures from Menu. Shop settings controls the delivery estimate and online ordering switch.
- Uploaded pictures are public menu assets; customer order details are staff-only. Use Supabase's backup options and restrict access to the Supabase/Netlify accounts to trusted administrators.

## Common problems

| Symptom | Check |
| --- | --- |
| Dashboard says Connection needed | Both public connection variables are set; deploy again |
| Menu says live menu unavailable | Project URL/key, SQL installation and Supabase project status |
| Checkout function is unavailable | Open the deployed Netlify site or run through Netlify Dev; static file previews and VS Code Live Server do not run Functions |
| Online checkout is not configured | `SUPABASE_URL` and `SUPABASE_SECRET_KEY` exist in Functions environment |
| Payment instructions are unavailable | Apply migrations 002–008 in order, then enter bank details in Staff dashboard → Shop settings |
| A transfer order does not appear in Orders after receipt submission | Apply migration 012 and confirm the receipt was successfully submitted |
| Payment receipt upload/view fails | Confirm the private bucket exists, the migration is applied, and Netlify `SUPABASE_URL` matches the browser project |
| Invitation/password link fails | Allowed `/admin.html` redirect, email delivery/SMTP and expired links |
| Account has no staff access | Verified email matches an active `staff_members` row |
| Menu edit conflicts | Another staff member edited it; refresh then retry |

Official guides: https://docs.netlify.com/build/functions/get-started/ · https://supabase.com/docs/guides/auth/redirect-urls · https://supabase.com/docs/guides/auth/auth-smtp

## Updating an earlier installation

If you already installed the previous database package, do not rerun `schema.sql`, `install.sql` or `seed.sql`. Apply any missing additive migrations in order through `012_release_receipt_verified_deliveries.sql`; do not reset production tables. Migration 010 repairs included selections, migration 011 adds a service-role-only legacy RPC (its public HTTP endpoint is retired), and migration 012 ensures transfer orders with submitted receipts appear in the staff queue. The cafe owner enters the bank name, account name and account number in Staff dashboard → Shop settings; no bank details are hardcoded in the website.

A customer receives a private tracking link after placing a bank-transfer order or completing Paystack payment. Keep it private: anyone holding the link can see that order's status and item summary, and request the latest order receipt or their submitted payment receipt. The tracking page shows bank-transfer instructions when configured and accepts payment receipt uploads. Bank-transfer orders are visible to staff after receipt submission; Paystack orders appear after server-side verification. The order receipt is fetched fresh from the server each time and can be downloaded or printed/saved as PDF; it shows the generated timestamp and current payment/order statuses. Routine tracking omits phone/address and internal staff notes. Status and payment updates appear on the tracking page while it is open.
