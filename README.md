# DetailDesk

Job cards, PPF and coating records, GST invoices and WhatsApp messages for a car care / detailing studio.
Two logins: **Owner (Admin)** and **Manager**.

## What it does

- **New job card in 5 steps:**
  1. Customer & vehicle. A returning customer is found by mobile number or car number.
  2. Inspection: damage map, 6 photos, belongings.
  3. Services: price by car segment. PPF selected panels are priced per sq ft. PPF and coating details are recorded here.
  4. Estimate & approval: discount limit, advance payment, consent and signature.
  5. Bay & team: delivery time suggested from service times, priority.
- **Job flow:** in progress → mark ready → invoice & deliver. Every step is logged with who did it.
- **GST invoices:** series per financial year (`INV/26-27/0001`), CGST/SGST with SAC, round off, amount in words, warranty lines.
  - Prints on A4. The job card prints on A5.
  - Each invoice has a customer link (`/i/<token>`) where the customer can view it, save it as PDF and pay by UPI (link and QR).
  - Each job card has a tracking link (`/j/<token>`).
- **WhatsApp:** opens WhatsApp (wa.me) with the message and the link filled in. Staff check it and tap Send. It costs nothing and needs no API account.
- **Payments:** UPI, cash, card or bank. Part payments are allowed. The advance is adjusted automatically.
- **Customers:** cars, visits, history and PPF/coating warranties.
- **Owner-only Settings:**
  - Business details and GST on/off.
  - Price list: add, edit or remove services.
  - Bays and team.
  - Manager logins.
  - What managers can do: see sales, cancel invoices, maximum discount.

The server enforces every rule, not only the screen. Examples: a manager's discount limit, the advance can't exceed the estimate, no second invoice for a job, only allowed people can cancel.

## Run on your computer

Needs Node.js 20 or newer.

```bash
npm install
npm start            # http://localhost:3000
```

The first visit asks you to create the owner login.

To show the app with sample data instead, seed an empty database before starting:

```bash
npm run seed         # owner 98765 00000 / owner123, manager 98901 22476 / manager123
npm start
```

Other commands:

```bash
npm test             # API tests on a temporary database
npm run backup       # safe copy of the database into data/backups/
npm run dev          # restarts on code changes
```

## Where data lives

Everything is in the `data/` folder:
- `data/detaildesk.db` holds the SQLite database.
- `data/uploads/` holds photos and signatures.

Set `DATA_DIR` to keep it somewhere else. Back up this folder every day: run `npm run backup` and copy `data/backups/` and `data/uploads/` off the server.

## Settings (environment variables)

| Variable | What it does | Example |
|---|---|---|
| `PORT` | Port to listen on | `3000` |
| `DATA_DIR` | Folder for the database and photos | `/var/lib/detaildesk` |
| `PUBLIC_URL` | Your public address. Used in WhatsApp links and invoice links. | `https://app.shinelab.in` |
| `TRUST_PROXY` | Set to `1` when running behind Nginx, Caddy or a hosting proxy (for secure cookies) | `1` |
| `TZ` | Time zone (default `Asia/Kolkata`) | `Asia/Kolkata` |

## Putting it online on Render

`render.yaml` sets up everything:
- Node 22.
- A 1 GB disk at `/var/data` for the database and photos.
- The Singapore region.
- A health check at `/healthz`.
- HTTPS cookies behind Render's proxy.

1. Push this folder to a GitHub repository. A private repository is fine.
2. On render.com: **New → Blueprint**, connect GitHub and pick the repository. Render reads `render.yaml`. Approve the **Starter** plan plus the 1 GB disk. That is about $7.25 a month at the time of writing; check Render's pricing page. The free plan has no disk, so all data would be lost on every restart.
3. When the deploy finishes, open the `https://<name>.onrender.com` address and create the owner login. WhatsApp and invoice links use this address automatically.
4. Optional: add your own domain in Render (Settings → Custom Domains). Then set `PUBLIC_URL` to it, so links in WhatsApp messages use your domain.
5. Render takes daily snapshots of the disk. You can also open the service's Shell and run `npm run backup`.

Every push to the main branch deploys again automatically. The data on the disk is kept.

## Putting it online on your own server

The app is one Node.js process plus a data folder, so it needs a host with a **persistent disk**:
- A small VPS, for example a 1 GB Linux server.
- Or Render or Railway with a mounted disk.

Serverless hosts (for example Vercel) don't suit it, because the database is a file.

On a VPS:
1. Install Node.js 20+.
2. Copy this folder and run `npm ci --omit=dev`.
3. Run `npm start` under a process manager (pm2 or systemd), with `PUBLIC_URL`, `DATA_DIR` and `TRUST_PROXY=1` set.
4. Put Caddy or Nginx in front for HTTPS on your domain. Logins need HTTPS on the internet.
5. Schedule `npm run backup` daily and copy the backups off the server.

## Code map

- `server/index.js`: API, rules, public invoice and job card pages.
- `server/db.js`: SQLite tables. `server/auth.js`: passwords (scrypt) and sessions (HTTP-only cookie).
- `public/shared.js`: prices, GST totals, invoice and job card layouts. The same code runs in the browser and on the server.
- `public/app.js`: the screens. `public/styles.css`: styles, including print.
- `test/api.test.js`: end-to-end API tests.
- `DetailDesk-demo.html`: the earlier single-file click-through demo. It is kept for reference.

## Later (not built yet)

- WhatsApp Business API for automatic sending and reminders. This needs a Meta business account and approved templates.
- Editing a job card after it's created, inventory/film stock, reports, and more than one branch.
