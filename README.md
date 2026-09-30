# Stack & Sip website and staff dashboard

This package includes the complete customer website, staff dashboard, Supabase database setup and Netlify server functions. The café design, hero image, category pages, purple cart buttons, menu prices and WhatsApp PDF/image cards are retained. Every customer page has a shared header with sliding opening hours and a visible Staff login button.

**Start with [SETUP.md](SETUP.md).** Your Supabase URL and browser-safe publishable key are configured. Database installation, the private Netlify server key and deployment are still required. No passwords or secret/service-role keys are included.

## Staff can

- Review customer details, items, quantities, delivery addresses and notes.
- Search orders and update their status: pending, confirmed, preparing, ready, completed or cancelled.
- Record payment status, adjust an order's confirmed delivery fee and add private notes.
- Change product names, prices, descriptions and availability; upload replacement pictures.
- Pause online ordering and change the default delivery estimate.
- Prepare a WhatsApp message to a customer. The staff member still taps Send.
- Invite or revoke staff access from the owner account.

The dashboard checks for new orders every 30 seconds while its Orders tab is visible. It is a browser dashboard, not a native app, and does not send background push notifications.

## Customers can

Browse category pages, add items to a cart, enter pickup/delivery details and generate a branded order PDF/image. Once Supabase and Netlify are connected, customers can submit an order directly to the café dashboard. The saved receipt uses the server's current prices and saved reference. Customers also get a private tracking link showing Pending, Confirmed, Preparing, Ready, Completed or Cancelled. Active orders refresh every 15 seconds while the tracking page is open. It remains an unpaid order request until staff confirm it.

WhatsApp-only orders and orders placed on the separate UpMenu website do not automatically appear in this dashboard. The existing UpMenu link is retained; its basket and order management remain separate.

## Project layout

| Path | Purpose |
| --- | --- |
| `public/` | Complete HTML, CSS, JavaScript, images and website assets |
| `public/admin.html` | Staff sign-in and dashboard |
| `public/track.html` | Private customer order tracking |
| `public/assets/vendor/` | Locally bundled Supabase browser SDK |
| `netlify/functions/` | Protected order submission and owner invitation endpoints |
| `netlify/lib/` | Server-side Supabase requests and response helpers |
| `supabase/schema.sql` | Tables, access policies, storage and database functions |
| `supabase/seed.sql` | 13 categories and 84 existing products with original prices |
| `scripts/prepare-config.cjs` | Generates browser-safe configuration during deployment |
| `tests/` | Database permissions, API and frontend workflow tests |

## Validation

With Node 24 and npm installed, run `npm install`, then `npm test`. The tests execute the actual SQL in PGlite PostgreSQL and exercise server handlers and checkout DOM behavior with simulated network responses. These do not replace a real Supabase/Netlify launch test; follow the checks in SETUP.md after connecting the accounts.

Database policies protect customer records from public access. Server-side submission checks live prices and availability, uses retry-safe order IDs, and limits submissions per hashed client IP. Existing orders keep a snapshot of their item prices. Staff edits are recorded in the database audit log. The server secret must remain in Netlify environment variables.

The included product pictures retain the existing website's source information and illustration labels. Staff should replace any placeholders with actual café photographs as needed.

Customer tracking exposes only the order reference, items, totals, fulfillment, payment record and status. It never returns customer phone/address or internal staff notes. A random UUID link is required; references cannot be used to look up orders. Tracking is available for website-submitted orders, not the separate UpMenu basket. No automatic WhatsApp, email or background push notifications are configured.
