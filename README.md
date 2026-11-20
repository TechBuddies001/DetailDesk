# DetailDesk

Job cards, PPF and coating records, GST invoices and WhatsApp messages for a car care / detailing studio.
It has three kinds of login:
- **Super Admin:** you, the software provider. This is the first login, made on the setup screen.
- **Owner (Admin):** the studio owner, your client.
- **Manager:** studio staff.

## What it does

- **New job card in 5 steps:**
  1. Customer & vehicle. A returning customer is found by mobile or car number.
  2. Inspection: damage map, 6 photos, belongings.
  3. Services: price by car segment. "PPF · selected panels" is priced per sq ft. PPF and coating details are recorded. "Add service" puts a new service in the price list and on this job card (Owner, Super Admin, and Managers unless the Owner turns it off).
  4. Estimate & approval: discount limit, advance, consent and signature.
  5. Bay & team: suggested delivery time and priority.
- **Job flow:** in progress → mark ready → invoice & deliver. Every step is logged with who did it.
- **GST invoices:**
  - When making each invoice, pick **with GST** (tax invoice) or **without GST**. The job card's setting is the starting choice.
  - Numbered per financial year, like `INV/26-27/0001`. Bills without GST have their own series, like `BILL/26-27/0001`, so the GST invoice numbers stay unbroken.
  - CGST/SGST with SAC codes, round off, amount in words, warranty lines.
  - Prints on A4. The job card prints on A5.
  - Each invoice has a customer link (`/i/<token>`) where the customer can view it, save it as PDF and pay by UPI (link and QR).
  - Each job card has a tracking link (`/j/<token>`).
- **WhatsApp:** opens WhatsApp (wa.me) with the message and link filled in. Staff check it and tap Send. No API account or cost. Messages are in Hinglish by default.
- **Payments:** UPI, cash, card or bank. Part payments are allowed. The advance is adjusted automatically.
- **Customers:** cars, visits, history and warranties.
- **Owner-only Settings:**
  - Business details and GST on/off: logo, name, a line under the name (like "By Prime Automotive"), address, phone, GSTIN and UPI ID. The logo shows on invoices, job cards, the login screen and the menu.
  - Price list.
  - Bays and team.
  - Manager logins.
  - What managers can do: see sales, cancel invoices, add new services from a job card, maximum discount.

**Super Admin only:**
- Add Owner logins, and reset or turn off any login.
- Edit a job card before its invoice: customer and car details, services and prices (custom lines too), discount, bay, team and delivery.
- Edit customer and car details. Open job cards update too; invoices keep what was printed.
- Change the invoice number prefixes for GST invoices and for bills without GST (numbering continues) and the terms printed on invoices.
- Add, rename or remove service categories. PPF and Coating stay fixed.
- Edit every WhatsApp message (job card, update, car ready, invoice, payment reminder, estimate, customer message). There is a live preview, and one click brings back the Hinglish or English defaults. Words in `{curly brackets}` are filled in by the app; a line whose word has nothing to fill is left out.

The Owner keeps everything else in Settings and manages Manager logins.

When an older install is upgraded, its first Owner login becomes the Super Admin automatically.

The server enforces every rule, not only the screen:
- the manager's discount limit,
- an advance can't exceed the estimate,
- one invoice per job,
- who can cancel an invoice,
- no double payment when two people pay at once.

## Data

Everything is stored in **MySQL / MariaDB**: job cards, invoices, payments, and also photos and signatures. Nothing lives in the app folder, so redeploying never loses data. Back up the database, for example with Hostinger's daily backups or a phpMyAdmin export.

Settings (environment variables):

| Variable | What it does | Example |
|---|---|---|
| `DB_HOST` | Database host. Use `127.0.0.1` on Hostinger, not `localhost`. | `127.0.0.1` |
| `DB_PORT` | Database port | `3306` |
| `DB_NAME` | Database name | `u123456789_detaildesk` |
| `DB_USER` | Database user | `u123456789_detaildesk` |
| `DB_PASSWORD` | Database password | |
| `PUBLIC_URL` | Your public address. Used in WhatsApp and invoice links. | `https://app.yourdomain.com` |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy (Hostinger, Nginx), so login cookies are marked secure | `1` |
| `PORT`, `TZ` | Usually set by the host. `TZ` defaults to `Asia/Kolkata`. | |

Instead of the `DB_*` variables, you can set a single `DATABASE_URL=mysql://user:password@127.0.0.1:3306/dbname`.

The tables are created automatically on first start. If the database settings are wrong, the app still opens and shows exactly what to fix. The `/healthz` address shows the same message.

## Put it online on Hostinger (no VPS needed)

This works on the **Business / Unlimited Web Hosting** plan or any **Cloud** plan.

1. **Create the database:** hPanel → Websites → *your site* → **Databases → Management** → create a database and user. Note the name, user and password; they start with `u…_`.
2. **Add the app:** hPanel → **Websites → Add Website → Node.js web app** → **Connect with GitHub** → pick this repository.
3. **Settings before deploying:**
   - Node.js version **22**.
   - **Entry file `server.js`**.
   - Build command: empty.
   - Environment variables:
     ```
     DB_HOST=127.0.0.1
     DB_PORT=3306
     DB_NAME=u…_detaildesk
     DB_USER=u…_detaildesk
     DB_PASSWORD=…
     TRUST_PROXY=1
     PUBLIC_URL=https://your-app-domain
     ```
4. **Deploy.** Open the site and create the owner login on the first-time setup screen.
5. In **Settings**, add the GSTIN, UPI ID and address, and create the Manager login.

Every push to the connected branch deploys again automatically. The data stays in MySQL.

Hostinger stops an idle app after some time. The first visit after a long gap takes a few seconds.

## Run on your computer

You need Node.js 20+ and a MySQL or MariaDB server.

```bash
npm install
DB_USER=root DB_PASSWORD=... DB_NAME=detaildesk npm start     # create the empty database first
```

Then open http://localhost:3000.

To show sample data, run this on an empty database before the first start:

```bash
DB_USER=root DB_PASSWORD=... DB_NAME=detaildesk npm run seed  # owner 98765 00000 / owner123, manager 98901 22476 / manager123
```

Never run `npm run seed` on the live database.

## Tests

The tests create and delete a throwaway database each run. Point them at a MySQL server you can create databases on:

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 TEST_DB_USER=root TEST_DB_PASSWORD=... npm test
```

## Code map

- `server.js`: entry file (starts the web server).
- `server/index.js`: API, rules, public invoice and job card pages.
- `server/db.js`: MySQL tables, transactions and counters.
- `server/auth.js`: passwords (scrypt) and sessions (HTTP-only cookie).
- `public/shared.js`: prices, GST totals, invoice and job card layouts. The same code runs in the browser and on the server.
- `public/app.js`: the screens. `public/styles.css`: styles, including print.
- `test/api.test.js`: end-to-end API tests, including several people saving at the same time.
- `DetailDesk-demo.html`: the earlier single-file click-through demo, kept for reference.

## Later (not built yet)

- WhatsApp Business API for automatic sending and reminders. This needs a Meta business account.
- Inventory/film stock, reports, and more than one branch.
