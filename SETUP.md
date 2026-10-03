# Activate the Stack & Sip dashboard

Your Supabase project URL and publishable key have been added to connection.json. The project is https://dsjbgccckmzibhcnpoei.supabase.co. You still need to install the database and configure a Netlify site. Your existing ChatGPT-hosted website is unchanged; this package becomes the independently hosted version when deployed.

## 1. Create the database

1. Sign in at https://supabase.com/dashboard and create a new project.
2. Open the project's SQL Editor. Paste the complete contents of `supabase/install.sql` and run it **once on a new project**. This combined file installs the schema, tracking function and menu in one step.
3. Alternatively, run schema.sql followed by seed.sql. Do not run both installation methods.
4. After either install method, apply the additive migrations in this order: `002_bank_transfer_payments.sql`, `003_card_and_external_checkout.sql`, `004_delivery_receipt_before_staff.sql`, `005_offer_customizations.sql`, `006_configurable_offer_options.sql`, `007_quote_first_checkout.sql`, `008_receipt_checkout_refinements.sql`, then `009_paystack_payments.sql`. The 006–009 migrations add database-backed choices, receipt-first quoting, owner-managed payment instructions, WebP receipt validation, and quote-bound Paystack payments; they do not reinstall or reset production data. Do not skip 003 or 004. Existing orders and snapshots remain intact.
5. Confirm the Table Editor shows 13 categories, 84 products and one shop settings row. The temporary Abuja Municipal delivery fee is ₦6,500; staff can update it later.

The schema also creates the public `menu-images` bucket, protected staff upload permissions and an owner access record for **umar.umar@st.futminna.edu.ng**. The record alone is not a login account; invite the owner in step 4.

Do not run this schema against an existing production database. It is an initial installation, not a migration or a restore script. Later menu edits belong in the dashboard; do not rerun the seed to reset them.

## 2. Deploy the complete project on Netlify

Recommended: extract the ZIP, put **all of the extracted project contents** into a GitHub repository, then import that repository into Netlify. Include `public`, `netlify`, `supabase`, `scripts`, `package.json` and `netlify.toml` at the repository root.

Netlify settings are already in `netlify.toml`:

- Build command: `node scripts/prepare-config.cjs`
- Publish directory: `public`
- Functions directory: `netlify/functions`

Use Node 24 for builds. Netlify should deploy `create-order-quote`, `quote-upload-url`, `quote-validate-receipt`, `place-quoted-order`, `initialize-paystack-payment`, `verify-paystack-payment`, `paystack-webhook`, `order-status`, `order-receipt`, `invite-staff`, `payment-upload-url`, `payment-submit` and `payment-receipt-url`. `submit-order` remains as a retired endpoint returning HTTP 410 so an old direct-submit client cannot bypass receipt-first checkout. A static drag-and-drop upload of just `public` will not provide these server functions or run the configuration build. Use a Git-connected deployment for this package.

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

After applying migrations through `008_receipt_checkout_refinements.sql` and deploying the Netlify functions, sign in to the staff dashboard as the café owner and open **Shop settings**. Enter the real bank name, account name, account number, and customer payment instructions, then save. No bank details or transfer instructions are prefilled. Checkout remains blocked with a clear message until all four are configured. Staff who are not the owner cannot read or change these payment fields. Owner edits use a settings-version check; refresh the dashboard before retrying if another owner session has changed them.

Receipt uploads accept PDF, JPG, PNG and WebP files up to 5 MB. Customers upload and validate a private receipt before the separate **Place order** action becomes available. Replacing a receipt invalidates and removes the previous private upload where possible. If a quote expires or an item becomes unavailable after payment, the receipt remains private for staff review and no order is silently repriced or created.

The bundled connection.json already provides your public URL/key when no public environment overrides are set. The server secret must still be added in Netlify; it is never bundled. To override the public connection for another project, set both URL and publishable key together.

Trigger a new deployment after adding the variables. Updating an environment variable without rebuilding will not update the browser configuration.

## 5. Configure Paystack (optional)

In Netlify site settings → Environment variables, add the keys from Paystack Dashboard → Settings → API Keys & Webhooks for the same mode (test or live):

| Variable | Value | Where it is used |
| --- | --- | --- |
| `PAYSTACK_PUBLIC_KEY` | `pk_test_…` or `pk_live_…` | Sent to the customer browser to open Paystack Inline |
| `PAYSTACK_SECRET_KEY` | `sk_test_…` or `sk_live_…` | Netlify Functions only: initialize configuration, verify transactions and validate webhook signatures |

Never put the secret key in website code, a public environment variable, Git, or chat. The checkout opens Paystack Inline and lets the payment options enabled on the merchant account appear; this project does not force a fixed channel list. If Paystack keys are missing or misconfigured, customers can still select bank transfer.

In the Paystack dashboard, set the webhook URL to `https://<your-netlify-site>/.netlify/functions/paystack-webhook`. Deploy after setting the keys and webhook. The browser callback is only a prompt to check payment; Netlify independently asks Paystack to verify the issued reference, NGN currency, status and exact quoted amount before an order can be created. Webhook events undergo signature validation and the same server verification. If payment arrives after the quote expires or item availability changes, no order is repriced or discarded; staff can review it in the dashboard's Paystack payment exceptions.

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
5. In Staff dashboard → Shop settings, enter the customer-facing bank name, account name and account number. Save before taking payment submissions.
6. Enter a small pickup test order. Confirm the server returns a 30-minute locked quote with live prices, bank instructions, and zero delivery fee; verify no order is visible in Orders yet.
7. Upload a JPG, PNG or PDF receipt under 5 MB and explicitly place the order. Confirm the order now appears in Orders with Payment verification pending, not before. Check the order snapshot shows base price, automatically included package allowance and priced add-ons.
8. Verify the payment in the dashboard; confirm the customer tracking page reports paid but remains pending until staff updates fulfilment. Try moving a different unpaid order to Preparing and confirm the server rejects it. Reject another test receipt with a reason, then test replacement.
9. Let a quote expire and attempt to upload an already-paid receipt; confirm the website retains it in Receipt exceptions and staff can view the private receipt and record a resolution note. Separately mark a quoted choice out of stock before placement and confirm its receipt is also retained for review without repricing.
10. Confirm the downloadable tracking receipt reflects current order/payment statuses and has a generation timestamp. Change order status and confirm private tracking refreshes within 15 seconds.
11. Invite a staff account and verify it can manage orders/menu/options but cannot invite others. Revoke that account and confirm access stops.
12. Pause online ordering and confirm quote creation is rejected. Resume when ready; check the mobile dashboard and customer pages.

Mark test orders cancelled so staff can distinguish them from real requests.

## Operating the café

- Keep Orders open on the café device to receive the 30-second refreshes. It does not notify staff after the browser tab is closed.
- Customers must submit a receipt and click **Upload receipt & place order** before an order enters this dashboard. A quote or uploaded receipt by itself does not create an order.
- WhatsApp sharing opens a prepared message; the user still taps Send and attaches/downloads the PDF or image as needed. No paid WhatsApp automation is configured.
- UpMenu orders remain in UpMenu. Its existing link does not synchronize its menu or orders with Supabase.
- Bank transfer is manual: staff must compare the receipt to the actual bank transaction and verify or reject it in Orders.
- Change prices, availability and pictures from Menu. Shop settings controls the delivery estimate and online ordering switch.
- Uploaded pictures are public menu assets; customer order details are staff-only. Use Supabase's backup options and restrict access to the Supabase/Netlify accounts to trusted administrators.

## Common problems

| Symptom | Check |
| --- | --- |
| Dashboard says Connection needed | Both public connection variables are set; deploy again |
| Menu says live menu unavailable | Project URL/key, SQL installation and Supabase project status |
| Submit says unavailable or gives a non-JSON response | Both Netlify functions deployed, not only static HTML |
| Online submission is not connected | `SUPABASE_URL` and `SUPABASE_SECRET_KEY` exist in Functions environment |
| Payment instructions are unavailable | Apply migrations 002–007 in order, then enter bank details in Staff dashboard → Shop settings |
| An order does not appear in Orders until receipt upload and placement | This is expected: quote drafts remain private and no order exists until the receipt is submitted |
| Payment receipt upload/view fails | Confirm the private bucket exists, the migration is applied, and Netlify `SUPABASE_URL` matches the browser project |
| Invitation/password link fails | Allowed `/admin.html` redirect, email delivery/SMTP and expired links |
| Account has no staff access | Verified email matches an active `staff_members` row |
| Menu edit conflicts | Another staff member edited it; refresh then retry |

Official guides: https://docs.netlify.com/build/functions/get-started/ · https://supabase.com/docs/guides/auth/redirect-urls · https://supabase.com/docs/guides/auth/auth-smtp

## Updating an earlier installation

If you already installed the previous database package, run `supabase/migrations/001_customer_tracking.sql` only if tracking was not installed, then apply migrations 002, 003, 004, 005, 006 and 007 in order. Do not rerun `schema.sql`, `install.sql` or `seed.sql` against an existing project. If migrations 006 and 007 were already applied, re-run the updated 006 and then updated 007 from the Supabase SQL Editor: 006 changes only untouched default option groups (staff-edited groups are versioned and preserved), and 007 safely replaces the quote function so package allowances are not mandatory customer selections and all explicit add-ons are priced. For a new Supabase project, install the schema and seed once, then apply the same additive migrations in order. The café owner enters the bank name, account name and account number in Staff dashboard → Shop settings; no bank details are hardcoded in the website.

A customer receives a private tracking link only after uploading a payment receipt and placing the order. Keep it private: anyone holding the link can see that order's status and item summary, and request the latest order receipt or their submitted payment receipt. The order receipt is fetched fresh from the server each time and can be downloaded or printed/saved as PDF; it shows the generated timestamp and current payment/order statuses. Routine tracking omits phone/address and internal staff notes. Automatic WhatsApp/email/push notifications are not configured; status and payment updates appear on the tracking page while it is open.
