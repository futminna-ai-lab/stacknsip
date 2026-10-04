# Stack & Sip website and staff dashboard

This package includes the complete customer website, staff dashboard, Supabase database setup and Netlify server functions. The café design, hero image, category pages, purple cart buttons, menu prices and checkout receipt flow are retained. Every customer page has a shared header with sliding opening hours and a visible Staff login button.

**Start with [SETUP.md](SETUP.md).** Your Supabase URL and browser-safe publishable key are configured. Database installation, the private Netlify server key and deployment are still required. No passwords or secret/service-role keys are included.

## Staff can

- Review orders, server-validated item/option snapshots, quantities, delivery addresses and notes. Bank-transfer orders enter the queue after receipt submission; Paystack orders enter after server-side payment verification.
- Search orders and update their status: pending, confirmed, preparing, ready, completed or cancelled.
- Record payment status, adjust an order's confirmed delivery fee and add private notes.
- Review private bank-transfer receipts, view submission history, and verify or reject payments with a reason. Review Paystack payments that arrived after quote expiry or no longer match available offers.
- Change product names, prices, descriptions and availability; mark an item sold out or available directly from its menu card; upload replacement pictures.
- Configure per-offer option groups, included selections, minimum/maximum/repeat rules, add-on prices, color swatches and option availability. Changes are optimistic-version checked and audited.
- Review receipts attached to expired quotes or options that became unavailable. Resolve them with a note; the system does not silently create an order or change the quoted amount.
- Pause online ordering and change the default delivery estimate.
- As owner, edit the bank destination and payment instructions shown on customer tracking pages. Payment configuration is version-checked, audited, and unavailable to non-owner staff or the public menu API.
- Prepare a WhatsApp message to a customer. The staff member still taps Send.
- Invite or revoke staff access from the owner account.

The dashboard checks for new orders every 30 seconds while its Orders tab is visible. It is a browser dashboard, not a native app, and does not send background push notifications.

## Customers can

Browse categories and configure offer choices, then enter customer details and choose bank transfer or Paystack. Bank transfer shows a locked quote, then accepts a receipt upload before placing the order. Paystack opens its secure payment window and creates an order only after server-side payment verification. Current prices and option availability are checked by the server before payment. Extras are options on eligible offers, not a customer-facing category. Fulfilment is blocked until staff verifies bank-transfer payments.

Orders placed on the separate UpMenu website do not automatically appear in this dashboard. The existing UpMenu link is retained; its basket and order management remain separate.

## Project layout

| Path | Purpose |
| --- | --- |
| `public/` | Complete HTML, CSS, JavaScript, images and website assets |
| `public/admin.html` | Staff sign-in and dashboard |
| `public/track.html` | Private customer order tracking |
| `public/assets/vendor/` | Locally bundled Supabase browser SDK |
| `netlify/functions/` | Protected order submission, payment receipt and owner invitation endpoints |
| `netlify/lib/` | Server-side Supabase requests and response helpers |
| `supabase/schema.sql` | Tables, access policies, storage and database functions |
| `supabase/migrations/002_bank_transfer_payments.sql` | Private payment receipt storage, submission history and staff review functions |
| `supabase/migrations/004_delivery_receipt_before_staff.sql` | Hides new bank-transfer delivery drafts until receipt submission |
| `supabase/migrations/005_offer_customizations.sql` | Backward-compatible legacy offer validation |
| `supabase/migrations/006_configurable_offer_options.sql` | DB-backed offer option groups, choice stock and optional disabled colors |
| `supabase/migrations/007_quote_first_checkout.sql` | Locked expiring quotes, receipt-first order creation and payment-gated fulfilment |
| `supabase/migrations/008_receipt_checkout_refinements.sql` | Owner-only payment instructions, quote destination snapshots, and WebP receipt support |
| `supabase/migrations/009_paystack_payments.sql` | Quote-bound Paystack transactions, server-paid orders, idempotency and exception review |
| `supabase/migrations/010_included_options_are_optional.sql` | Stops included package allowances from being treated as required paid extras |
| `supabase/migrations/011_order_card_submission.sql` | Legacy service-role-only direct-submission RPC; the public HTTP endpoint is retired |
| `supabase/migrations/012_release_receipt_verified_deliveries.sql` | Releases delivery orders into the staff queue when payment receipts are submitted |
| `supabase/seed.sql` | 13 categories and 84 existing products with original prices |
| `scripts/prepare-config.cjs` | Generates browser-safe configuration during deployment |
| `tests/` | Database permissions, API and frontend workflow tests |

## Validation

With Node 24 and npm installed, run `npm install`, then `npm test`. Tests exercise the SQL, server handlers, bank receipt upload, Paystack verification/webhooks, configurable customer options, quote checkout and tracking with simulated network responses. These do not replace a real Supabase/Netlify launch test; follow the checks in SETUP.md after connecting the accounts.

Database policies protect customer records from public access. The server calculates locked quotes from live product and option data. Bank-transfer orders are created only after a receipt is submitted, while Paystack orders are created only after server-side payment verification. Quotes and uploaded receipt evidence remain private; existing orders keep their item/option snapshots. Staff edits are version checked and recorded in the audit log. The server secret must remain in Netlify environment variables.

The included product pictures retain the existing website's source information and illustration labels. Staff should replace any placeholders with actual café photographs as needed.

Routine customer tracking exposes order progress, items, totals, fulfillment and payment status but omits phone/address and internal staff notes. The customer order receipt fetches its contact/address fields separately using the same private tracking token; payment receipt access is limited to a matching token or authenticated staff. A random UUID link is required; references cannot be used to look up orders. Tracking is available for website-submitted orders, not the separate UpMenu basket. No automatic WhatsApp, email or background push notifications are configured.
