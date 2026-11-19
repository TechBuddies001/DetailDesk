// DetailDesk server: JSON API + static app + public invoice / job card pages. Storage: MySQL / MariaDB.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QR = require('qrcode');
const S = require('../public/shared.js');
const D = require('./db');
const A = require('./auth');
const {all, one, run, tx, nextNum, peekNum, getKV, setKV, settings, jobFromRow, invFromRow} = D;

/* ================= helpers ================= */
class UserError extends Error { constructor(msg, code = 400){ super(msg); this.code = code; } }
const fail = (msg, code) => { throw new UserError(msg, code); };
const now = () => S.isoDT(new Date());
const pad4 = n => String(n).padStart(4, '0');
const token = n => crypto.randomBytes(n).toString('hex');
const str = (v, max, label = 'Text') => { const s = String(v ?? '').trim(); if (s.length > max) fail(`${label} is too long (max ${max} characters)`); return s; };
const int = (v, min, max, label) => { const n = Number(v); if (v === '' || v === null || v === undefined || !Number.isFinite(n) || Math.round(n) !== n || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}`); return n; };
const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const arr = v => Array.isArray(v) ? v : [];
const bool = v => v === true || v === 1 || v === 'true';
function mobile(v){
  let d = S.digits(v);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) fail('Enter a valid 10-digit mobile number');
  return d;
}
const regKey = r => String(r || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function cleanLogin(v){
  let s = String(v ?? '').trim().toLowerCase();
  if (/^[\d\s+\-]+$/.test(s)){ let d = S.digits(s); if (d.length === 12 && d.startsWith('91')) d = d.slice(2); s = d; }
  if (!/^[a-z0-9._@\-]{3,40}$/.test(s)) fail('Use your 10-digit mobile number or a username of 3 to 40 letters or numbers');
  return s;
}
const isAdmin = req => req.user.role === 'admin';
const perms = () => getKV('perms', {sales:false, cancel:false, disc:10});
const canSales = async req => isAdmin(req) || !!(await perms()).sales;
const canCancel = async req => isAdmin(req) || !!(await perms()).cancel;
const discLimit = async req => isAdmin(req) ? 100 : Math.max(0, Math.min(100, +(await perms()).disc || 0));
const whoName = u => u.role === 'manager' ? `${u.name} (Manager)` : u.name;
const publicUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const baseUrl = req => publicUrl() || `${req.protocol}://${req.get('host')}`;
const qrSvg = text => QR.toString(text, {type:'svg', margin:0, errorCorrectionLevel:'M'});
const upiLink = (biz, amt, note) => `upi://pay?pa=${encodeURIComponent(biz.upi)}&pn=${encodeURIComponent(biz.name)}&am=${(+amt).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;
const log = (c, jobId, at, msg, userId) => run('INSERT INTO job_log (job_id, at_time, msg, user_id) VALUES (?, ?, ?, ?)', [jobId, at, String(msg).slice(0, 255), userId || null], c);
const docOf = j => { const {id, status, in:_in, token:_t, customerId, log:_l, paid, bal, total, invInfo, ...doc} = j; return doc; };

/* ================= queries ================= */
const getJobRow = (id, c) => one('SELECT * FROM jobs WHERE id = ?', [id], c);
const getInvRow = (no, c) => one('SELECT * FROM invoices WHERE inv_no = ?', [no], c);
const jobsByStatus = (status, limit) => all('SELECT * FROM jobs WHERE status = ? ORDER BY seq DESC LIMIT ?', [status, limit]);
const jobPaid = async (id, c) => Number((await one('SELECT COALESCE(SUM(amt), 0) AS n FROM payments WHERE job_id = ? AND invoice_no IS NULL', [id], c)).n);
const INV_WITH_PAID = 'SELECT i.*, (SELECT COALESCE(SUM(p.amt), 0) FROM payments p WHERE p.invoice_no = i.inv_no) AS paid FROM invoices i';
const userCount = async () => Number((await one('SELECT COUNT(*) AS n FROM users')).n);

/* ================= domain ================= */
async function loadJob(id){
  const j = jobFromRow(await getJobRow(id));
  if (!j) return null;
  j.log = await all('SELECT at_time AS t, msg AS text FROM job_log WHERE job_id = ? ORDER BY at_time DESC, id DESC', [id]);
  if (j.inv){
    const v = await invFromRow(await getInvRow(j.inv));
    j.invInfo = v ? {no:v.no, token:v.token, total:S.invTot(v).total, paid:S.paidOf(v), bal:S.balOf(v), cancelled:v.cancelled} : null;
    j.paid = v ? S.paidOf(v) : 0;
  } else j.paid = await jobPaid(id);
  j.total = S.jobTot(j).total;
  j.bal = j.invInfo ? j.invInfo.bal : j.total - j.paid;
  return j;
}
async function listJobs(rows){
  const out = rows.map(jobFromRow);
  const open = out.filter(j => !j.inv).map(j => j.id);
  const paid = {};
  if (open.length) (await all('SELECT job_id, COALESCE(SUM(amt), 0) AS n FROM payments WHERE invoice_no IS NULL AND job_id IN (?) GROUP BY job_id', [open])).forEach(r => { paid[r.job_id] = Number(r.n); });
  out.forEach(j => { j.total = S.jobTot(j).total; if (!j.inv){ j.paid = paid[j.id] || 0; j.bal = j.total - j.paid; } });
  return out;
}
async function saveUpload(dataUrl, userId, c){
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) fail('Only JPEG, PNG or WebP photos can be uploaded');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) fail('The photo is empty');
  if (buf.length > 4 * 1024 * 1024) fail('The photo is too large (max 4 MB after compression)', 413);
  const isJpg = buf[0] === 0xFF && buf[1] === 0xD8, isPng = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG', isWebp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  if (!(isJpg || isPng || isWebp)) fail('That file is not a valid photo');
  const id = token(12);
  await run('INSERT INTO uploads (id, mime, bytes, bin, created, user_id) VALUES (?, ?, ?, ?, ?, ?)', [id, m[1], buf.length, buf, now(), userId || null], c);
  return id;
}
const validUpload = async id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id) && !!(await one('SELECT id FROM uploads WHERE id = ?', [id]));

async function createJob(user, body, opts = {}){
  const st = await settings(), cat = st.catalog, b = obj(body), f = obj(b.f), at = opts.at || now();
  const name = str(f.name, 80, 'Customer name'); if (!name) fail('Enter the customer name');
  const ph = mobile(f.mob);
  const email = str(f.email, 120, 'Email'); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email or leave it empty');
  const reg = str(f.reg, 20, 'Car number').toUpperCase().replace(/\s+/g, ' '); if (regKey(reg).length < 4) fail('Enter the car number');
  const model = str(f.model, 60, 'Make & model'); if (!model) fail('Enter the make & model');
  const color = str(f.color, 30, 'Colour'), odo = str(f.odo, 12, 'Odometer'), req = str(f.req, 500, 'Customer request');
  if (odo && !/^[\d,]+$/.test(odo)) fail('Odometer should be a number');
  const seg = int(b.seg, 0, 4, 'Car segment');
  const fuel = ['E', '¼', '½', '¾', 'F'].includes(b.fuel) ? b.fuel : '½';
  const dmg = {}; for (const [k, v] of Object.entries(obj(b.dmg))) if (S.PANEL[k] && S.DMG[v]) dmg[k] = v;
  const photos = {}; for (const [k, v] of Object.entries(obj(b.photos))) if (S.SLOTS.includes(k) && await validUpload(v)) photos[k] = v;
  const bel = [...new Set(arr(b.bel).filter(x => S.BEL.includes(x)))];
  const terms = [...new Set(arr(b.terms).filter(x => S.TERMS.some(t => t[0] === x)))];
  const svcs = [...new Set(arr(b.svcs).filter(id => S.svcIn(cat, id)))];
  if (!svcs.length) fail('Pick at least one service');
  if (svcs.filter(x => S.COVER.includes(x)).length > 1) fail('Pick only one PPF coverage (full body, front kit or selected panels)');
  const panels = svcs.includes('ppf-custom') ? [...new Set(arr(b.panels).filter(id => S.PANEL[id] && !S.PANEL[id].glass))] : [];
  if (svcs.includes('ppf-custom') && !panels.length) fail('Pick the panels for “PPF · selected panels”');
  const lines = S.linesFor(svcs, panels, seg, cat);
  const disc = int(b.disc || 0, 0, 100, 'Discount'), lim = opts.discLimit !== undefined ? opts.discLimit : 100;
  if (disc > lim) fail(`You can give up to ${lim}% discount. Ask the owner for more.`, 403);
  const gst = !!st.biz.gst, t = S.totals(lines, disc, gst);
  const adv = int(b.adv || 0, 0, 100000000, 'Advance');
  if (adv > t.total) fail(`Advance can't be more than the estimate (${S.inr(t.total)})`);
  const mode = S.PAY_MODES.includes(b.mode) ? b.mode : 'UPI';
  const bay = b.bay ? str(b.bay, 40, 'Bay') : '';
  if (bay && !st.bays.some(x => x.id === bay)) fail('That bay no longer exists. Pick another.');
  const team = [...new Set(arr(b.team).map(x => String(x)).filter(n => st.staff.some(s => s.n === n)))];
  const due = S.validDT(b.due) ? String(b.due).slice(0, 16) : S.suggestDue(svcs, cat).at;
  const prio = b.prio === 'Urgent' ? 'Urgent' : 'Normal';
  let sig = null;
  if (b.sig) sig = await validUpload(b.sig) ? b.sig : await saveUpload(b.sig, user.id);
  const doc = {cust:name, ph:S.fmtPh(ph), email, car:model, color, reg, seg, odo, fuel, req, dmg, photos, bel, svcs, panels, lines, disc, gst, adv, mode, terms, sig, bay, team, due, prio};
  if (S.hasCatIn(cat, svcs, 'PPF')){ const p = obj(b.ppf); doc.ppf = {finish:p.finish === 'Matte' ? 'Matte' : 'Gloss', film:str(p.film, 60, 'Film'), warr:int(p.warr ?? 5, 0, 15, 'PPF warranty'), notes:str(p.notes, 200, 'PPF notes')}; }
  if (S.hasCatIn(cat, svcs, 'Coating')){ const c = obj(b.coat); doc.coat = {product:str(c.product, 60, 'Coating product'), layers:int(c.layers ?? 2, 1, 5, 'Layers'), warr:int(c.warr ?? 3, 0, 10, 'Coating warranty')}; }
  return tx(async c => {
    // upserts: one statement each, safe when two people save the same customer at once
    const cu = {id:(await run(`INSERT INTO customers (name, phone, email, created) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE name = ?, email = IF(? = '', email, ?), id = LAST_INSERT_ID(id)`, [name, ph, email, at, name, email, email], c)).insertId};
    const k = regKey(reg);
    const v = {id:(await run(`INSERT INTO vehicles (customer_id, reg, reg_key, model, color, seg) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE customer_id = ?, reg = ?, model = ?, color = IF(? = '', color, ?), seg = ?, id = LAST_INSERT_ID(id)`, [cu.id, reg, k, model, color, seg, cu.id, reg, model, color, color, seg], c)).insertId};
    const seq = await nextNum(c, 'job'), id = 'JC-' + pad4(seq);
    await run('INSERT INTO jobs (id, seq, customer_id, vehicle_id, status, created, token, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, seq, cu.id, v.id, 'work', at, token(12), JSON.stringify(doc)], c);
    if (adv > 0) await run('INSERT INTO payments (job_id, invoice_no, amt, pay_mode, paid_at, note, user_id) VALUES (?, NULL, ?, ?, ?, ?, ?)', [id, adv, mode, at, 'Advance', user.id], c);
    await log(c, id, at, `Job card created by ${whoName(user)}${adv ? ` · advance ${S.inr(adv)} by ${mode}` : ''}`, user.id);
    return id;
  });
}
async function markReady(user, id, opts = {}){
  const at = opts.at || now();
  await tx(async c => {
    const j = jobFromRow(await one('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [id], c)); if (!j) fail('Job card not found', 404);
    if (j.status !== 'work') fail('This job card is already marked ready');
    const doc = docOf(j); doc.readyAt = at;
    await run('UPDATE jobs SET status = ?, doc = ? WHERE id = ?', ['ready', JSON.stringify(doc), id], c);
    await log(c, id, at, `Marked ready by ${whoName(user)}`, user.id);
  });
}
async function makeInvoice(user, id, opts = {}){
  const at = opts.at || now(), fy = S.fyOf(at);
  return tx(async c => {
    const row = await one('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [id], c), j = jobFromRow(row); if (!j) fail('Job card not found', 404);
    if (j.inv) fail('This job card already has an invoice');
    if (j.status !== 'ready') fail('Mark the car as ready before making the invoice');
    const seq = await nextNum(c, `inv:${fy}`), no = `INV/${fy}/${pad4(seq)}`;
    const inv = {cust:j.cust, ph:j.ph, car:j.car, reg:j.reg, seg:j.seg, odo:j.odo, lines:j.lines, disc:j.disc, gst:j.gst, warr:S.warrOf(j, at)};
    await run('INSERT INTO invoices (inv_no, fy, seq, inv_date, job_id, customer_id, token, cancelled, total, doc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
      [no, fy, seq, at, id, row.customer_id, token(12), S.totals(j.lines, j.disc, j.gst).total, JSON.stringify(inv)], c);
    await run('UPDATE payments SET invoice_no = ? WHERE job_id = ? AND invoice_no IS NULL', [no, id], c);
    const doc = docOf(j); doc.inv = no; doc.doneAt = at; if (!doc.readyAt) doc.readyAt = at;
    await run('UPDATE jobs SET status = ?, doc = ? WHERE id = ?', ['done', JSON.stringify(doc), id], c);
    await log(c, id, at, `Invoice ${no} made by ${whoName(user)} · car delivered`, user.id);
    return no;
  });
}
async function addPayment(user, no, amt, mode, opts = {}){
  const at = opts.at || now(), m = S.PAY_MODES.includes(mode) ? mode : 'UPI';
  return tx(async c => {
    const v = await invFromRow(await one('SELECT * FROM invoices WHERE inv_no = ? FOR UPDATE', [no], c), c); if (!v) fail('Invoice not found', 404);
    if (v.cancelled) fail('This invoice is cancelled');
    const bal = S.balOf(v); if (bal <= 0) fail('This invoice is already fully paid');
    const a = int(amt, 1, 100000000, 'Amount'), pay = Math.min(a, bal);
    await run('INSERT INTO payments (job_id, invoice_no, amt, pay_mode, paid_at, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [v.jobId || null, no, pay, m, at, '', user.id], c);
    if (v.jobId) await log(c, v.jobId, at, `Payment ${S.inr(pay)} by ${m} recorded by ${whoName(user)}`, user.id);
    return {paid:pay, extra:a - pay};
  });
}

/* ================= app ================= */
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

/* database readiness: the app still starts if MySQL is down, and says why */
let dbReady = false, dbError = 'Connecting to the database…';
const ready = (async function connect(){
  for (;;){
    try { await D.init(); dbReady = true; dbError = null; return; }
    catch (e){ dbError = `Database not connected (${e.code || e.message}). Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD.`; console.error(dbError); if (process.env.DD_NO_RETRY) throw e; await new Promise(r => setTimeout(r, 10000)); }
  }
})();
app.get('/healthz', async (req, res) => {
  if (!dbReady) return res.status(503).json({ok:false, error:dbError});
  await one('SELECT 1 AS ok'); res.json({ok:true});
});
app.use(['/api', '/i', '/j'], (req, res, next) => dbReady ? next() : res.status(503).json({error:dbError}));

app.use(express.json({limit:'8mb'}));
// Same-origin check for state-changing API calls (cookies are SameSite=Lax; this blocks cross-site posts too).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  let originHost = null; try { originHost = origin ? new URL(origin).host : null; } catch (_) { originHost = 'bad'; }
  if (originHost && originHost !== req.get('host') && !(publicUrl() && new URL(publicUrl()).host === originHost)) return res.status(403).json({error:'Request blocked: wrong origin.'});
  if (!req.is('application/json')) return res.status(415).json({error:'Send JSON.'});
  next();
});

/* ---------- auth (no login needed) ---------- */
app.get('/api/session', async (req, res) => res.json({user:await A.currentUser(req), setupNeeded:(await userCount()) === 0, biz:{name:(await getKV('biz', {})).name || ''}}));
app.post('/api/setup', async (req, res) => {
  const b = obj(req.body);
  const bizName = str(b.bizName, 80, 'Business name'); if (!bizName) fail('Enter the business name');
  const name = str(b.name, 60, 'Your name'); if (!name) fail('Enter your name');
  const login = cleanLogin(b.login), pw = String(b.password || '');
  if (pw.length < 6) fail('Password needs at least 6 characters');
  const id = await tx(async c => {
    await c.query("INSERT INTO counters (k, n) VALUES ('setup', 0) ON DUPLICATE KEY UPDATE n = n");
    await c.query("SELECT n FROM counters WHERE k = 'setup' FOR UPDATE");
    if (Number((await one('SELECT COUNT(*) AS n FROM users', [], c)).n) > 0) fail('Setup is already done. Please log in.', 409);
    const r = await run('INSERT INTO users (name, login, pass, role, active, created) VALUES (?, ?, ?, ?, 1, ?)', [name, login, A.hashPassword(pw), 'admin', now()], c);
    const biz = await getKV('biz', {}, c);
    await setKV('biz', {...biz, name:bizName, ph:/^\d{10}$/.test(login) ? S.fmtPh(login) : (biz.ph || '')}, c);
    return r.insertId;
  });
  await A.startSession(req, res, id);
  res.json({ok:true});
});
app.post('/api/login', async (req, res) => {
  const b = obj(req.body); let login;
  try { login = cleanLogin(b.login); } catch (_) { fail('Wrong mobile/username or password', 401); }
  const key = `${login}|${req.ip}`;
  if (A.loginBlocked(key)) fail('Too many wrong tries. Wait 10 minutes and try again.', 429);
  const u = await one('SELECT * FROM users WHERE login = ?', [login]);
  if (!u || !u.active || !A.checkPassword(b.password || '', u.pass)){ A.loginFailed(key); fail('Wrong mobile/username or password', 401); }
  A.loginOk(key);
  await A.startSession(req, res, u.id);
  res.json({ok:true});
});
app.post('/api/logout', async (req, res) => { await A.endSession(req, res); res.json({ok:true}); });

/* ---------- public pages for customers (no login, unguessable token) ---------- */
const pubPage = (title, biz, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${S.esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/styles.css"></head><body class="pub"><main class="pub-main">${inner}</main><p class="pub-foot">${S.esc(biz.name)}${biz.ph ? ' · ' + S.esc(biz.ph) : ''}</p></body></html>`;
app.get('/i/:token', async (req, res) => {
  const v = await invFromRow(await one('SELECT * FROM invoices WHERE token = ?', [String(req.params.token)]));
  if (!v) return res.status(404).send('Invoice not found');
  const biz = await getKV('biz', {}), bal = S.balOf(v);
  const qr = bal > 0 && biz.upi ? await qrSvg(upiLink(biz, bal, v.no)) : '';
  res.setHeader('Cache-Control', 'no-store');
  res.send(pubPage(`Invoice ${v.no}`, biz, `<div class="pub-bar no-print"><b>Invoice ${S.esc(v.no)}</b><span class="spacer"></span>${bal > 0 && biz.upi ? `<a class="btn pri" href="${S.esc(upiLink(biz, bal, v.no))}">Pay ${S.inr(bal)} by UPI</a>` : ''}<button class="btn" onclick="window.print()">Print / Save as PDF</button></div><div class="paper-wrap">${S.invPaper(v, biz, qr)}</div>`));
});
app.get('/j/:token', async (req, res) => {
  const j = jobFromRow(await one('SELECT * FROM jobs WHERE token = ?', [String(req.params.token)]));
  if (!j) return res.status(404).send('Job card not found');
  const biz = await getKV('biz', {}), st = {work:'Work in progress', ready:'Ready for pickup', done:'Delivered'}[j.status];
  res.setHeader('Cache-Control', 'no-store');
  res.send(pubPage(`Job card ${j.id}`, biz, `<div class="pub-bar no-print"><b>${S.esc(j.car)} · ${S.esc(st)}</b><span class="spacer"></span><span class="small">Expected: ${S.esc(S.fDY(j.due))}, ${S.esc(S.fTime(S.parseDT(j.due)))}</span></div><div class="paper-wrap">${S.jobPaper(j, biz, '', '')}</div>`));
});

/* ---------- everything below needs a login ---------- */
app.use('/api', A.requireUser);
const adminOnly = A.requireAdmin;

app.get('/api/boot', async (req, res) => res.json({me:req.user, ...(await settings())}));
app.post('/api/me/password', async (req, res) => {
  const b = obj(req.body), u = await one('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!A.checkPassword(b.current || '', u.pass)) fail('Your current password is wrong', 403);
  if (String(b.next || '').length < 6) fail('New password needs at least 6 characters');
  await run('UPDATE users SET pass = ? WHERE id = ?', [A.hashPassword(b.next), u.id]);
  await A.delUserSessions(u.id); await A.startSession(req, res, u.id);
  res.json({ok:true});
});

/* uploads (photos and signatures are kept in the database) */
app.post('/api/uploads', async (req, res) => res.json({id:await saveUpload(obj(req.body).dataUrl, req.user.id)}));
app.get('/api/uploads/:id', async (req, res) => {
  const id = String(req.params.id), u = /^[a-f0-9]{24}$/.test(id) && await one('SELECT mime, bin FROM uploads WHERE id = ?', [id]);
  if (!u) return res.status(404).json({error:'Photo not found'});
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(u.mime).send(u.bin);
});

/* home */
app.get('/api/home', async (req, res) => {
  const st = await settings(), today = S.todayS(), ym = today.slice(0, 7);
  const work = await listJobs(await jobsByStatus('work', 500)), ready = await listJobs(await jobsByStatus('ready', 500));
  const due = (await all(`${INV_WITH_PAID} WHERE i.cancelled = 0 AND i.total > (SELECT COALESCE(SUM(p.amt), 0) FROM payments p WHERE p.invoice_no = i.inv_no) ORDER BY i.inv_date DESC`))
    .map(r => { const d = JSON.parse(r.doc); return {no:r.inv_no, date:r.inv_date, cust:d.cust, car:d.car, bal:r.total - Number(r.paid)}; });
  const coll = Number((await one('SELECT COALESCE(SUM(amt), 0) AS n FROM payments WHERE paid_at LIKE ?', [today + '%'])).n);
  const out = {work, ready, coll, pending:due.reduce((s, x) => s + x.bal, 0), due:due.slice(0, 30), dueCount:due.length,
    bays:st.bays.map(b => ({...b, jobs:work.filter(j => j.bay === b.id).map(j => ({id:j.id, car:j.car, due:j.due}))}))};
  if (await canSales(req)){
    const month = await all('SELECT total, doc FROM invoices WHERE cancelled = 0 AND inv_date LIKE ?', [ym + '%']), top = {};
    month.forEach(r => JSON.parse(r.doc).lines.forEach(l => { const k = S.shortName(l.name); top[k] = (top[k] || 0) + l.amt; }));
    out.sales = {month:month.reduce((s, r) => s + r.total, 0), count:month.length, tops:Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5)};
  }
  res.json(out);
});

/* jobs */
app.get('/api/jobs', async (req, res) => {
  const tab = ['work', 'ready', 'done', 'all'].includes(req.query.tab) ? req.query.tab : 'work', qs = String(req.query.q || '').trim().slice(0, 60);
  let list;
  if (qs) list = (await listJobs(await all('SELECT * FROM jobs ORDER BY seq DESC LIMIT 5000'))).filter(j => S.hit(qs, j.id, j.reg, j.ph, j.cust, j.car)).slice(0, 200);
  else list = await listJobs(tab === 'all' ? await all('SELECT * FROM jobs ORDER BY seq DESC LIMIT 300') : await jobsByStatus(tab, tab === 'done' ? 300 : 1000));
  const counts = {work:0, ready:0, done:0}; (await all('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status')).forEach(r => { counts[r.status] = Number(r.n); });
  counts.all = counts.work + counts.ready + counts.done;
  res.json({list, counts});
});
app.get('/api/jobs/:id', async (req, res) => {
  const j = await loadJob(String(req.params.id)); if (!j) fail('Job card not found', 404);
  const link = `${baseUrl(req)}/j/${j.token}`;
  res.json({job:j, link, qr:await qrSvg(link)});
});
app.post('/api/jobs', async (req, res) => res.json({id:await createJob(req.user, req.body, {discLimit:await discLimit(req)})}));
app.post('/api/jobs/:id/ready', async (req, res) => { await markReady(req.user, String(req.params.id)); res.json({ok:true}); });
app.post('/api/jobs/:id/invoice', async (req, res) => res.json({no:await makeInvoice(req.user, String(req.params.id))}));
app.post('/api/jobs/:id/log', async (req, res) => {
  const id = String(req.params.id); if (!await getJobRow(id)) fail('Job card not found', 404);
  const text = str(obj(req.body).text, 200, 'Note'); if (!text) fail('Empty note');
  await log(undefined, id, now(), text, req.user.id); res.json({ok:true});
});
app.get('/api/workload', async (req, res) => {
  const work = (await jobsByStatus('work', 1000)).map(jobFromRow), bays = {}, team = {};
  work.forEach(j => { if (j.bay) (bays[j.bay] = bays[j.bay] || []).push({id:j.id, car:j.car, due:j.due}); (j.team || []).forEach(n => { team[n] = (team[n] || 0) + 1; }); });
  res.json({bays, team, nextId:'JC-' + pad4(await peekNum('job') + 1)});
});
app.get('/api/find', async (req, res) => {
  const qs = String(req.query.q || '').trim(); let c = null, carKey = null;
  let d = S.digits(qs); if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 10) c = await one('SELECT * FROM customers WHERE phone = ?', [d]);
  if (!c){ const k = regKey(qs); if (k.length >= 4){ const v = await one('SELECT * FROM vehicles WHERE reg_key = ?', [k]); if (v){ c = await one('SELECT * FROM customers WHERE id = ?', [v.customer_id]); carKey = k; } } }
  if (!c) return res.json({match:null});
  const cars = (await all('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY id DESC', [c.id])).map(v => ({reg:v.reg, model:v.model, color:v.color, seg:v.seg, key:v.reg_key}));
  if (carKey) cars.sort((a, b) => (b.key === carKey) - (a.key === carKey));
  const jobs = await all('SELECT created FROM jobs WHERE customer_id = ?', [c.id]), invs = await all('SELECT inv_date, job_id FROM invoices WHERE customer_id = ?', [c.id]);
  const last = [...jobs.map(r => r.created), ...invs.map(r => r.inv_date)].sort().pop() || c.created;
  res.json({match:{name:c.name, ph:S.fmtPh(c.phone), email:c.email, cars, visits:jobs.length + invs.filter(r => !r.job_id).length, last}});
});

/* invoices */
app.get('/api/invoices', async (req, res) => {
  const tab = req.query.tab === 'unpaid' ? 'unpaid' : 'all', qs = String(req.query.q || '').trim().slice(0, 60);
  const rows = (await all(`${INV_WITH_PAID} ORDER BY i.inv_date DESC, i.inv_no DESC`)).map(r => { const d = JSON.parse(r.doc), paid = Number(r.paid); return {no:r.inv_no, date:r.inv_date, cust:d.cust, ph:d.ph, car:d.car, reg:d.reg, total:r.total, paid, bal:r.cancelled ? 0 : r.total - paid, cancelled:!!r.cancelled}; });
  const unpaid = rows.filter(r => r.bal > 0).length;
  const list = rows.filter(r => (tab === 'all' || r.bal > 0) && S.hit(qs, r.no, r.cust, r.reg, r.ph, r.car)).slice(0, qs ? 200 : 300);
  res.json({list, counts:{all:rows.length, unpaid}});
});
app.get('/api/invoice', async (req, res) => {
  const v = await invFromRow(await getInvRow(String(req.query.no || ''))); if (!v) fail('Invoice not found', 404);
  const biz = await getKV('biz', {}), bal = S.balOf(v);
  res.json({inv:v, link:`${baseUrl(req)}/i/${v.token}`, qr:bal > 0 && biz.upi ? await qrSvg(upiLink(biz, bal, v.no)) : '', canCancel:await canCancel(req)});
});
app.post('/api/invoice/pay', async (req, res) => { const b = obj(req.body); res.json(await addPayment(req.user, String(b.no || ''), b.amt, b.mode)); });
app.post('/api/invoice/cancel', async (req, res) => {
  if (!await canCancel(req)) fail('Only the owner can cancel invoices', 403);
  const no = String(obj(req.body).no || '');
  await tx(async c => {
    const r = await one('SELECT * FROM invoices WHERE inv_no = ? FOR UPDATE', [no], c); if (!r) fail('Invoice not found', 404);
    if (r.cancelled) fail('This invoice is already cancelled');
    await run('UPDATE invoices SET cancelled = 1 WHERE inv_no = ?', [no], c);
    if (r.job_id) await log(c, r.job_id, now(), `Invoice ${no} cancelled by ${whoName(req.user)}`, req.user.id);
  });
  res.json({ok:true});
});

/* customers */
app.get('/api/customers', async (req, res) => {
  const qs = String(req.query.q || '').trim().slice(0, 60), sales = await canSales(req), vehs = {};
  (await all('SELECT id, customer_id, reg, model FROM vehicles ORDER BY id DESC')).forEach(v => (vehs[v.customer_id] = vehs[v.customer_id] || []).push({reg:v.reg, model:v.model}));
  const rows = await all(`SELECT c.id, c.name, c.phone, c.created,
      (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id) + (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.job_id IS NULL) AS visits,
      GREATEST(COALESCE((SELECT MAX(j.created) FROM jobs j WHERE j.customer_id = c.id), ''), COALESCE((SELECT MAX(i.inv_date) FROM invoices i WHERE i.customer_id = c.id), ''), c.created) AS last_visit,
      (SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.customer_id = c.id AND i.cancelled = 0) AS spent
    FROM customers c ORDER BY last_visit DESC`);
  const list = rows.map(c => ({id:c.id, name:c.name, ph:S.fmtPh(c.phone), cars:vehs[c.id] || [], visits:Number(c.visits), last:c.last_visit, ...(sales ? {spent:Number(c.spent)} : {})}))
    .filter(c => S.hit(qs, c.name, c.ph, ...c.cars.map(x => x.reg), ...c.cars.map(x => x.model))).slice(0, 300);
  res.json({list, total:rows.length});
});
app.get('/api/customers/:id', async (req, res) => {
  const c = await one('SELECT * FROM customers WHERE id = ?', [Number(req.params.id) || 0]); if (!c) fail('Customer not found', 404);
  const jobs = await listJobs(await all('SELECT * FROM jobs WHERE customer_id = ? ORDER BY seq DESC', [c.id]));
  const invs = await all(`${INV_WITH_PAID} WHERE i.customer_id = ? ORDER BY i.inv_date DESC`, [c.id]);
  const warr = []; jobs.filter(j => j.status === 'done').forEach(j => S.warrOf(j, j.doneAt || j.in).forEach(w => warr.push(w)));
  const out = {id:c.id, name:c.name, ph:S.fmtPh(c.phone), email:c.email, since:[c.created, ...jobs.map(j => j.in), ...invs.map(r => r.inv_date)].sort()[0],
    cars:(await all('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY id DESC', [c.id])).map(v => ({reg:v.reg, model:v.model, color:v.color, seg:v.seg})),
    jobs:jobs.filter(j => !j.inv).map(j => ({id:j.id, status:j.status, in:j.in, names:j.lines.map(l => S.shortName(l.name)).join(', ')})),
    invs:invs.map(r => { const d = JSON.parse(r.doc); return {no:r.inv_no, date:r.inv_date, total:r.total, bal:r.cancelled ? 0 : r.total - Number(r.paid), cancelled:!!r.cancelled, names:d.lines.map(l => S.shortName(l.name)).join(', ')}; }),
    warr, visits:jobs.length + invs.filter(r => !r.job_id).length};
  if (await canSales(req)) out.spent = invs.filter(r => !r.cancelled).reduce((s, r) => s + r.total, 0);
  res.json(out);
});

/* settings (owner only) */
app.put('/api/settings/biz', adminOnly, async (req, res) => {
  const b = obj(req.body), upi = str(b.upi, 100, 'UPI ID');
  if (upi && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(upi)) fail('Enter a valid UPI ID like name@bank, or leave it empty');
  const gstin = str(b.gstin, 15, 'GSTIN').toUpperCase();
  if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) fail('GSTIN should be 15 characters, like 27ABCDE1234F1Z5');
  const name = str(b.name, 80, 'Business name'); if (!name) fail('Enter the business name');
  await setKV('biz', {name, addr:str(b.addr, 200, 'Address'), ph:str(b.ph, 20, 'Phone'), gstin, gst:bool(b.gst), upi});
  res.json({ok:true, biz:await getKV('biz')});
});
app.put('/api/settings/perms', adminOnly, async (req, res) => {
  const b = obj(req.body);
  await setKV('perms', {sales:bool(b.sales), cancel:bool(b.cancel), disc:int(b.disc, 0, 100, 'Maximum discount')});
  res.json({ok:true, perms:await getKV('perms')});
});
app.put('/api/settings/catalog', adminOnly, async (req, res) => {
  const list = arr(obj(req.body).catalog); if (!list.length) fail('The price list cannot be empty');
  const ids = new Set();
  const clean = list.slice(0, 300).map(s => {
    s = obj(s);
    const id = str(s.id, 40, 'Service id'); if (!/^[a-z0-9-]+$/i.test(id) || ids.has(id)) fail('Bad service id'); ids.add(id);
    const name = str(s.name, 80, 'Service name'); if (!name) fail('Every service needs a name');
    const cat = S.CATS.slice(1).includes(s.cat) ? s.cat : 'Wash & interior';
    const prices = arr(s.perSq || s.p).slice(0, 5).map(x => int(Math.round(+x || 0), 0, 10000000, `Price of ${name}`));
    while (prices.length < 5) prices.push(0);
    const o = {id, cat, name, dur:str(s.dur, 30, 'Duration'), hrs:Math.max(.5, Math.min(200, +s.hrs || 1))};
    if (s.note) o.note = str(s.note, 80, 'Note');
    if (+s.cure) o.cure = Math.max(0, Math.min(96, +s.cure));
    if (id === 'ppf-custom' || s.perSq) o.perSq = prices; else o.p = prices;
    return o;
  });
  await setKV('catalog', clean);
  res.json({ok:true, catalog:clean});
});
app.put('/api/settings/bays', adminOnly, async (req, res) => {
  const list = arr(obj(req.body).bays).slice(0, 50).map(b => ({id:str(obj(b).id, 30, 'Bay name'), type:str(obj(b).type, 30, 'Bay use') || 'General'}));
  if (list.some(b => !b.id)) fail('Every bay needs a name');
  if (new Set(list.map(b => b.id.toLowerCase())).size !== list.length) fail('Two bays have the same name');
  const busy = (await jobsByStatus('work', 1000)).map(jobFromRow).find(j => j.bay && !list.some(b => b.id === j.bay));
  if (busy) fail(`${busy.bay} has a car in it (${busy.id}). Finish or move that job first.`);
  await setKV('bays', list); res.json({ok:true, bays:list});
});
app.put('/api/settings/staff', adminOnly, async (req, res) => {
  const list = arr(obj(req.body).staff).slice(0, 200).map(s => ({n:str(obj(s).n, 60, 'Name'), r:str(obj(s).r, 60, 'Role') || 'Team member'}));
  if (list.some(s => !s.n)) fail('Every team member needs a name');
  if (new Set(list.map(s => s.n.toLowerCase())).size !== list.length) fail('Two team members have the same name');
  await setKV('staff', list); res.json({ok:true, staff:list});
});
app.get('/api/users', adminOnly, async (req, res) => res.json({users:(await all("SELECT id, name, login, role, active, created FROM users ORDER BY role = 'admin' DESC, name")).map(u => ({...u, active:!!u.active, me:u.id === req.user.id}))}));
app.post('/api/users', adminOnly, async (req, res) => {
  const b = obj(req.body), name = str(b.name, 60, 'Name'); if (!name) fail('Enter the name');
  const login = cleanLogin(b.login), pw = String(b.password || '');
  if (pw.length < 6) fail('Password needs at least 6 characters');
  if (await one('SELECT id FROM users WHERE login = ?', [login])) fail('This mobile/username already has a login');
  await run('INSERT INTO users (name, login, pass, role, active, created) VALUES (?, ?, ?, ?, 1, ?)', [name, login, A.hashPassword(pw), 'manager', now()]);
  res.json({ok:true});
});
app.post('/api/users/:id/password', adminOnly, async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', [Number(req.params.id) || 0]); if (!u) fail('Login not found', 404);
  const pw = String(obj(req.body).password || ''); if (pw.length < 6) fail('Password needs at least 6 characters');
  await run('UPDATE users SET pass = ? WHERE id = ?', [A.hashPassword(pw), u.id]); if (u.id !== req.user.id) await A.delUserSessions(u.id);
  res.json({ok:true});
});
app.post('/api/users/:id/active', adminOnly, async (req, res) => {
  const u = await one('SELECT * FROM users WHERE id = ?', [Number(req.params.id) || 0]); if (!u) fail('Login not found', 404);
  if (u.role === 'admin') fail("The owner's login can't be turned off");
  const on = bool(obj(req.body).active); await run('UPDATE users SET active = ? WHERE id = ?', [on ? 1 : 0, u.id]); if (!on) await A.delUserSessions(u.id);
  res.json({ok:true});
});

app.use('/api', (req, res) => res.status(404).json({error:'Not found'}));

/* ---------- static app ---------- */
app.use(express.static(path.join(__dirname, '..', 'public'), {extensions:['html'], setHeaders:res => res.setHeader('Cache-Control', 'no-cache')}));

/* ---------- errors ---------- */
const DB_DOWN = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_CON_COUNT_ERROR', 'ER_USER_LIMIT_REACHED']);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof UserError) return res.status(err.code).json({error:err.message});
  if (err.type === 'entity.too.large') return res.status(413).json({error:'That photo is too large. Try a smaller one.'});
  if (err.type === 'entity.parse.failed') return res.status(400).json({error:'Bad request.'});
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({error:'Someone else just saved the same thing. Please try again.'});
  if (err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') return res.status(503).json({error:'The system is busy. Please try again.'});
  if (DB_DOWN.has(err.code)){ console.error(err.code, err.message); return res.status(503).json({error:'The database is not reachable right now. Please try again in a minute.'}); }
  console.error(err);
  res.status(500).json({error:'Something went wrong on the server. Please try again.'});
});

module.exports = {app, ready, createJob, markReady, makeInvoice, addPayment, saveUpload};
