# Activate the Stack & Sip dashboard

Your Supabase project URL and publishable key have been added to connection.json. The project is https://dsjbgccckmzibhcnpoei.supabase.co. You still need to install the database and configure a Netlify site. Your existing ChatGPT-hosted website is unchanged; this package becomes the independently hosted version when deployed.

## 1. Create the database

1. Sign in at https://supabase.com/dashboard and create a new project.
2. Open the project's SQL Editor. Paste the complete contents of `supabase/install.sql` and run it **once on a new project**. This combined file installs the schema, tracking function and menu in one step.
3. Alternatively, run schema.sql followed by seed.sql. Do not run both installation methods.
4. Confirm the Table Editor shows 13 categories, 84 products and one shop settings row. The temporary Abuja Municipal delivery fee is ₦6,500; staff can update it later.

The schema also creates the public `menu-images` bucket, protected staff upload permissions and an owner access record for **umar.umar@st.futminna.edu.ng**. The record alone is not a login account; invite the owner in step 4.

Do not run this schema against an existing production database. It is an initial installation, not a migration or a restore script. Later menu edits belong in the dashboard; do not rerun the seed to reset them.

## 2. Deploy the complete project on Netlify

Recommended: extract the ZIP, put **all of the extracted project contents** into a GitHub repository, then import that repository into Netlify. Include `public`, `netlify`, `supabase`, `scripts`, `package.json` and `netlify.toml` at the repository root.

Netlify settings are already in `netlify.toml`:

- Build command: `node scripts/prepare-config.cjs`
- Publish directory: `public`
- Functions directory: `netlify/functions`

Use Node 24 for builds. Netlify should deploy all three `submit-order`, `order-status` and `invite-staff` functions. A static drag-and-drop upload of just `public` will not provide these server functions or run the configuration build. Use a Git-connected deployment for this package.

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

The bundled connection.json already provides your public URL/key when no public environment overrides are set. The server secret must still be added in Netlify; it is never bundled. To override the public connection for another project, set both URL and publishable key together.

Trigger a new deployment after adding the variables. Updating an environment variable without rebuilding will not update the browser configuration.

## 4. Set up owner login and invitations

1. In Supabase Authentication → URL Configuration, set Site URL to your Netlify origin, e.g. `https://your-site.netlify.app`.
2. Add the exact redirect URL `https://your-site.netlify.app/admin.html` to the allowed redirect URLs. Add the corresponding URL later if you use a custom domain.
3. In Authentication → Users, choose **Invite user** and invite **umar.umar@st.futminna.edu.ng**. Use the dashboard URL as the redirect destination where available.
4. Open the invitation email, set a password and visit `/admin.html`. If an invitation opened the homepage, use the dashboard's Forgot password button after ensuring `/admin.html` is an allowed redirect URL.
5. Sign in with the invited owner account. The verified email must match the owner record above.
6. Use Staff access in the dashboard to invite café staff. Only the owner can grant or revoke access. Staff need to accept their invitation and set their password before signing in.

There is no public signup screen. You can disable public signups in Supabase Authentication settings; administrator invitations should remain available. If the owner account already exists, use a password reset instead of creating a duplicate user.

Configure your own SMTP email provider in Supabase Authentication for reliable production invitations and password resets. Supabase's default email service is restricted and may prevent delivery to additional staff. This package does not include an SMTP account or automatic order emails.

## 5. Check the live workflow before taking orders

1. Sign in as owner and change one product's price and photo. Refresh its customer category/product page and confirm the new details appear.
2. Mark that product sold out and check that Add To Cart is disabled. Restore it after testing.
3. Submit a small test pickup order from the customer website. Confirm it appears in Orders with zero delivery fee and the current item price.
4. Submit a delivery test; confirm the estimated fee and address. Check the saved PDF/image uses the same reference as the dashboard.
5. Open the customer's private tracking link. Change status and the confirmed delivery fee in the dashboard, then confirm the tracking page updates within 15 seconds. Older orders should keep their original item prices.
6. Invite a staff account and verify that it can manage orders/menu but cannot invite others. Revoke that account and confirm order access stops.
7. Pause online ordering and confirm new submissions are rejected. Resume when ready.
8. Check the mobile dashboard and customer pages on a phone, and test WhatsApp sharing.

Mark test orders cancelled so staff can distinguish them from real requests.

## Operating the café

- Keep Orders open on the café device to receive the 30-second refreshes. It does not notify staff after the browser tab is closed.
- Customers must click **Submit order to café** for an order to enter this dashboard. Generating a card alone does not submit it.
- WhatsApp sharing opens a prepared message; the user still taps Send and attaches/downloads the PDF or image as needed. No paid WhatsApp automation is configured.
- UpMenu orders remain in UpMenu. Its existing link does not synchronize its menu or orders with Supabase.
- This package records paid/unpaid status but does not take payments or verify transactions automatically.
- Change prices, availability and pictures from Menu. Shop settings controls the delivery estimate and online ordering switch.
- Uploaded pictures are public menu assets; customer order details are staff-only. Use Supabase's backup options and restrict access to the Supabase/Netlify accounts to trusted administrators.

## Common problems

| Symptom | Check |
| --- | --- |
| Dashboard says Connection needed | Both public connection variables are set; deploy again |
| Menu says live menu unavailable | Project URL/key, SQL installation and Supabase project status |
| Submit says unavailable or gives a non-JSON response | Both Netlify functions deployed, not only static HTML |
| Online submission is not connected | `SUPABASE_URL` and `SUPABASE_SECRET_KEY` exist in Functions environment |
| Invitation/password link fails | Allowed `/admin.html` redirect, email delivery/SMTP and expired links |
| Account has no staff access | Verified email matches an active `staff_members` row |
| Menu edit conflicts | Another staff member edited it; refresh then retry |

Official guides: https://docs.netlify.com/build/functions/get-started/ · https://supabase.com/docs/guides/auth/redirect-urls · https://supabase.com/docs/guides/auth/auth-smtp

## Updating an earlier installation

If you already installed the previous database package, run only `supabase/migrations/001_customer_tracking.sql` to add tracking, then deploy this updated project. Do not rerun schema.sql or seed.sql. Earlier orders can also be tracked using the link in the staff dashboard's prepared WhatsApp update. For a new Supabase project, schema.sql already includes the tracking function.

A customer receives the tracking link immediately after a successful website submission. The PDF/image and prepared WhatsApp message include it as well. Keep it private: anyone holding the link can see that order's status and item summary. Phone numbers, delivery addresses, customer notes and internal staff notes are excluded. Automatic WhatsApp/email/push notifications are not configured; updates appear on the tracking page while it is open.
