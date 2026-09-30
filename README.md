# Stack & Sip website and staff dashboard

This package includes the complete customer website, staff dashboard, Supabase database setup and Netlify server functions. The café design, hero image, category pages, purple cart buttons, menu prices and WhatsApp PDF/image cards are retained. Every customer page has a shared header with sliding opening hours and a visible Staff login button.

**Start with [SETUP.md](SETUP.md).** Your Supabase URL and browser-safe publishable key are configured. Database installation, the private Netlify server key and deployment are still required. No passwords or secret/service-role keys are included.

## Staff can

- Review customer details, items, quantities, delivery addresses and notes.
- Search orders and update their status: pending, confirmed, preparing, ready, completed or cancelled.
- Record payment status, adjust an order's confirmed delivery fee and add private notes.
- Review private bank-transfer receipts, view submission history, and verify or reject payments with a reason.
- Change product names, prices, descriptions and availability; upload replacement pictures.
- Pause online ordering and change the default delivery estimate.
- Prepare a WhatsApp message to a customer. The staff member still taps Send.
- Invite or revoke staff access from the owner account.

The dashboard checks for new orders every 30 seconds while its Orders tab is visible. It is a browser dashboard, not a native app, and does not send background push notifications.

## Customers can

Browse category pages, add items to a cart, enter pickup/delivery details and generate a branded order PDF/image. Once Supabase and Netlify are connected, customers can submit an order directly to the café dashboard. The saved order total and reference come from the database. Customers use the private tracking link to see separate order/payment statuses, view the generated order receipt, see bank-transfer instructions and upload a private PDF/JPG/PNG receipt. Staff manually verify payments; uploads never mark an order paid. Active tracking refreshes every 15 seconds while open.

WhatsApp-only orders and orders placed on the separate UpMenu website do not automatically appear in this dashboard. The existing UpMenu link is retained; its basket and order management remain separate.

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
| `supabase/seed.sql` | 13 categories and 84 existing products with original prices |
| `scripts/prepare-config.cjs` | Generates browser-safe configuration during deployment |
| `tests/` | Database permissions, API and frontend workflow tests |

## Validation

With Node 24 and npm installed, run `npm install`, then `npm test`. The tests execute the actual SQL in PGlite PostgreSQL and exercise server handlers and checkout DOM behavior with simulated network responses. These do not replace a real Supabase/Netlify launch test; follow the checks in SETUP.md after connecting the accounts.

Database policies protect customer records from public access. Server-side submission checks live prices and availability, uses retry-safe order IDs, and limits submissions per hashed client IP. Existing orders keep a snapshot of their item prices. Staff edits are recorded in the database audit log. The server secret must remain in Netlify environment variables.

The included product pictures retain the existing website's source information and illustration labels. Staff should replace any placeholders with actual café photographs as needed.

Routine customer tracking exposes order progress, items, totals, fulfillment and payment status but omits phone/address and internal staff notes. The customer order receipt fetches its contact/address fields separately using the same private tracking token; payment receipt access is limited to a matching token or authenticated staff. A random UUID link is required; references cannot be used to look up orders. Tracking is available for website-submitted orders, not the separate UpMenu basket. No automatic WhatsApp, email or background push notifications are configured.
