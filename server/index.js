// DetailDesk server: JSON API + static app + public invoice / job card pages.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const QR = require('qrcode');
const S = require('../public/shared.js');
const {db, UPLOAD_DIR, getKV, setKV, settings, jobFromRow, invFromRow} = require('./db');
const A = require('./auth');

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
const canSales = req => isAdmin(req) || !!perms().sales;
const canCancel = req => isAdmin(req) || !!perms().cancel;
const discLimit = req => isAdmin(req) ? 100 : Math.max(0, Math.min(100, +perms().disc || 0));
const whoName = u => u.role === 'manager' ? `${u.name} (Manager)` : u.name;
const baseUrl = req => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const qrSvg = text => QR.toString(text, {type:'svg', margin:0, errorCorrectionLevel:'M'});
const upiLink = (biz, amt, note) => `upi://pay?pa=${encodeURIComponent(biz.upi)}&pn=${encodeURIComponent(biz.name)}&am=${(+amt).toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`;

/* ================= statements ================= */
const q = {
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
  userByLogin: db.prepare('SELECT * FROM users WHERE login = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  users: db.prepare('SELECT id, name, login, role, active, created FROM users ORDER BY role, name'),
  insUser: db.prepare('INSERT INTO users (name, login, pass, role, active, created) VALUES (?, ?, ?, ?, 1, ?)'),
  setPass: db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
  setActive: db.prepare('UPDATE users SET active = ? WHERE id = ?'),
  custByPhone: db.prepare('SELECT * FROM customers WHERE phone = ?'),
  custById: db.prepare('SELECT * FROM customers WHERE id = ?'),
  insCust: db.prepare('INSERT INTO customers (name, phone, email, created) VALUES (?, ?, ?, ?)'),
  updCust: db.prepare('UPDATE customers SET name = ?, email = ? WHERE id = ?'),
  vehByKey: db.prepare('SELECT * FROM vehicles WHERE reg_key = ?'),
  vehsOf: db.prepare('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY id DESC'),
  allVehs: db.prepare('SELECT * FROM vehicles'),
  insVeh: db.prepare('INSERT INTO vehicles (customer_id, reg, reg_key, model, color, seg) VALUES (?, ?, ?, ?, ?, ?)'),
  updVeh: db.prepare('UPDATE vehicles SET customer_id = ?, reg = ?, model = ?, color = ?, seg = ? WHERE id = ?'),
  maxJobSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM jobs'),
  insJob: db.prepare('INSERT INTO jobs (id, seq, customer_id, vehicle_id, status, created, token, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updJob: db.prepare('UPDATE jobs SET status = ?, doc = ? WHERE id = ?'),
  job: db.prepare('SELECT * FROM jobs WHERE id = ?'),
  jobByToken: db.prepare('SELECT * FROM jobs WHERE token = ?'),
  jobsByStatus: db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY seq DESC LIMIT ?'),
  jobsAll: db.prepare('SELECT * FROM jobs ORDER BY seq DESC LIMIT ?'),
  jobsOfCust: db.prepare('SELECT * FROM jobs WHERE customer_id = ? ORDER BY seq DESC'),
  jobCounts: db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status'),
  jobPaid: db.prepare('SELECT COALESCE(SUM(amt), 0) AS n FROM payments WHERE job_id = ? AND invoice_no IS NULL'),
  log: db.prepare('INSERT INTO job_log (job_id, at, text, user_id) VALUES (?, ?, ?, ?)'),
  logsOf: db.prepare('SELECT at AS t, text FROM job_log WHERE job_id = ? ORDER BY at DESC, id DESC'),
  maxInvSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM invoices WHERE fy = ?'),
  insInv: db.prepare('INSERT INTO invoices (no, fy, seq, date, job_id, customer_id, token, cancelled, total, doc) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'),
  inv: db.prepare('SELECT * FROM invoices WHERE no = ?'),
  invByToken: db.prepare('SELECT * FROM invoices WHERE token = ?'),
  invsWithPaid: db.prepare(`SELECT i.*, (SELECT COALESCE(SUM(amt), 0) FROM payments p WHERE p.invoice_no = i.no) AS paid FROM invoices i ORDER BY i.date DESC, i.no DESC`),
  invsOfCust: db.prepare(`SELECT i.*, (SELECT COALESCE(SUM(amt), 0) FROM payments p WHERE p.invoice_no = i.no) AS paid FROM invoices i WHERE customer_id = ? ORDER BY i.date DESC`),
  cancelInv: db.prepare('UPDATE invoices SET cancelled = 1 WHERE no = ?'),
  insPay: db.prepare('INSERT INTO payments (job_id, invoice_no, amt, mode, at, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  linkPays: db.prepare('UPDATE payments SET invoice_no = ? WHERE job_id = ? AND invoice_no IS NULL'),
  collToday: db.prepare('SELECT COALESCE(SUM(amt), 0) AS n FROM payments WHERE substr(at, 1, 10) = ?'),
  insUpload: db.prepare('INSERT INTO uploads (id, mime, bytes, created, user_id) VALUES (?, ?, ?, ?, ?)'),
  upload: db.prepare('SELECT * FROM uploads WHERE id = ?'),
  customersList: db.prepare(`SELECT c.id, c.name, c.phone, c.created,
      (SELECT COUNT(*) FROM jobs j WHERE j.customer_id = c.id) + (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.job_id IS NULL) AS visits,
      MAX(COALESCE((SELECT MAX(created) FROM jobs j WHERE j.customer_id = c.id), ''), COALESCE((SELECT MAX(date) FROM invoices i WHERE i.customer_id = c.id), ''), c.created) AS last,
      (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.customer_id = c.id AND i.cancelled = 0) AS spent
    FROM customers c ORDER BY last DESC`)
};

/* ================= domain ================= */
function loadJob(id){
  const j = jobFromRow(q.job.get(id));
  if (!j) return null;
  j.log = q.logsOf.all(id);
  if (j.inv){ const v = invFromRow(q.inv.get(j.inv)); j.invInfo = v ? {no:v.no, token:v.token, total:S.invTot(v).total, paid:S.paidOf(v), bal:S.balOf(v), cancelled:v.cancelled} : null; j.paid = v ? S.paidOf(v) : 0; }
  else j.paid = q.jobPaid.get(id).n;
  j.total = S.jobTot(j).total;
  j.bal = j.invInfo ? j.invInfo.bal : j.total - j.paid;
  return j;
}
function listJob(row){ const j = jobFromRow(row); j.total = S.jobTot(j).total; if (!j.inv){ j.paid = q.jobPaid.get(j.id).n; j.bal = j.total - j.paid; } return j; }
function saveUpload(dataUrl, userId){
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) fail('Only JPEG, PNG or WebP photos can be uploaded');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) fail('The photo is empty');
  if (buf.length > 4 * 1024 * 1024) fail('The photo is too large (max 4 MB after compression)', 413);
  const isJpg = buf[0] === 0xFF && buf[1] === 0xD8, isPng = buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG', isWebp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  if (!(isJpg || isPng || isWebp)) fail('That file is not a valid photo');
  const id = token(12);
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
  q.insUpload.run(id, m[1], buf.length, now(), userId || null);
  return id;
}
const validUpload = id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id) && !!q.upload.get(id);

function createJob(user, body, opts = {}){
  const st = settings(), cat = st.catalog, b = obj(body), f = obj(b.f), at = opts.at || now();
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
  const photos = {}; for (const [k, v] of Object.entries(obj(b.photos))) if (S.SLOTS.includes(k) && validUpload(v)) photos[k] = v;
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
  let sig = null;
  if (b.sig) sig = validUpload(b.sig) ? b.sig : saveUpload(b.sig, user.id);
  const bay = b.bay ? str(b.bay, 40, 'Bay') : '';
  if (bay && !st.bays.some(x => x.id === bay)) fail('That bay no longer exists. Pick another.');
  const team = [...new Set(arr(b.team).map(x => String(x)).filter(n => st.staff.some(s => s.n === n)))];
  const due = S.validDT(b.due) ? String(b.due).slice(0, 16) : S.suggestDue(svcs, cat).at;
  const prio = b.prio === 'Urgent' ? 'Urgent' : 'Normal';
  const doc = {cust:name, ph:S.fmtPh(ph), email, car:model, color, reg, seg, odo, fuel, req, dmg, photos, bel, svcs, panels, lines, disc, gst, adv, mode, terms, sig, bay, team, due, prio};
  if (S.hasCatIn(cat, svcs, 'PPF')){ const p = obj(b.ppf); doc.ppf = {finish:p.finish === 'Matte' ? 'Matte' : 'Gloss', film:str(p.film, 60, 'Film'), warr:int(p.warr ?? 5, 0, 15, 'PPF warranty'), notes:str(p.notes, 200, 'PPF notes')}; }
  if (S.hasCatIn(cat, svcs, 'Coating')){ const c = obj(b.coat); doc.coat = {product:str(c.product, 60, 'Coating product'), layers:int(c.layers ?? 2, 1, 5, 'Layers'), warr:int(c.warr ?? 3, 0, 10, 'Coating warranty')}; }
  return db.transaction(() => {
    let c = q.custByPhone.get(ph);
    if (c){ q.updCust.run(name, email || c.email, c.id); }
    else c = {id:q.insCust.run(name, ph, email, at).lastInsertRowid};
    const k = regKey(reg); let v = q.vehByKey.get(k);
    if (v) q.updVeh.run(c.id, reg, model, color || v.color, seg, v.id);
    else v = {id:q.insVeh.run(c.id, reg, k, model, color, seg).lastInsertRowid};
    const seq = q.maxJobSeq.get().n + 1, id = 'JC-' + pad4(seq);
    q.insJob.run(id, seq, c.id, v.id, 'work', at, token(12), JSON.stringify(doc));
    if (adv > 0) q.insPay.run(id, null, adv, mode, at, 'Advance', user.id);
    q.log.run(id, at, `Job card created by ${whoName(user)}${adv ? ` · advance ${S.inr(adv)} by ${mode}` : ''}`, user.id);
    return id;
  })();
}
function markReady(user, id, opts = {}){
  const j = jobFromRow(q.job.get(id)); if (!j) fail('Job card not found', 404);
  if (j.status !== 'work') fail('This job card is already marked ready');
  const at = opts.at || now(), {id:_i, status:_s, in:_in, token:_t, customerId:_c, ...doc} = j;
  doc.readyAt = at;
  db.transaction(() => { q.updJob.run('ready', JSON.stringify(doc), id); q.log.run(id, at, `Marked ready by ${whoName(user)}`, user.id); })();
}
function makeInvoice(user, id, opts = {}){
  const row = q.job.get(id), j = jobFromRow(row); if (!j) fail('Job card not found', 404);
  if (j.inv) fail('This job card already has an invoice');
  if (j.status !== 'ready') fail('Mark the car as ready before making the invoice');
  const at = opts.at || now(), fy = S.fyOf(at);
  const {id:_i, status:_s, in:_in, token:_t, customerId:_c, ...doc} = j;
  return db.transaction(() => {
    const seq = q.maxInvSeq.get(fy).n + 1, no = `INV/${fy}/${pad4(seq)}`;
    const inv = {cust:j.cust, ph:j.ph, car:j.car, reg:j.reg, seg:j.seg, odo:j.odo, lines:j.lines, disc:j.disc, gst:j.gst, warr:S.warrOf(j, at)};
    q.insInv.run(no, fy, seq, at, id, row.customer_id, token(12), S.totals(j.lines, j.disc, j.gst).total, JSON.stringify(inv));
    q.linkPays.run(no, id);
    doc.inv = no; doc.doneAt = at; if (!doc.readyAt) doc.readyAt = at;
    q.updJob.run('done', JSON.stringify(doc), id);
    q.log.run(id, at, `Invoice ${no} made by ${whoName(user)} · car delivered`, user.id);
    return no;
  })();
}
function addPayment(user, no, amt, mode, opts = {}){
  const v = invFromRow(q.inv.get(no)); if (!v) fail('Invoice not found', 404);
  if (v.cancelled) fail('This invoice is cancelled');
  const bal = S.balOf(v); if (bal <= 0) fail('This invoice is already fully paid');
  const a = int(amt, 1, 100000000, 'Amount'), pay = Math.min(a, bal), m = S.PAY_MODES.includes(mode) ? mode : 'UPI', at = opts.at || now();
  db.transaction(() => {
    q.insPay.run(v.jobId || null, no, pay, m, at, '', user.id);
    if (v.jobId) q.log.run(v.jobId, at, `Payment ${S.inr(pay)} by ${m} recorded by ${whoName(user)}`, user.id);
  })();
  return {paid:pay, extra:a - pay};
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
app.use(express.json({limit:'8mb'}));
// Same-origin check for state-changing API calls (cookies are SameSite=Lax; this blocks cross-site form posts too).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  let originHost = null; try { originHost = origin ? new URL(origin).host : null; } catch (_) { originHost = 'bad'; }
  if (originHost && originHost !== req.get('host') && ![process.env.PUBLIC_URL, process.env.RENDER_EXTERNAL_URL].filter(Boolean).map(u => u.replace(/\/+$/, '')).includes(origin.replace(/\/+$/, ''))) return res.status(403).json({error:'Request blocked: wrong origin.'});
  if (!req.is('application/json')) return res.status(415).json({error:'Send JSON.'});
  next();
});

/* ---------- health check for the host (no login needed) ---------- */
app.get('/healthz', (req, res) => { q.userCount.get(); res.json({ok:true}); });

/* ---------- auth (no login needed) ---------- */
app.get('/api/session', (req, res) => res.json({user:A.currentUser(req), setupNeeded:q.userCount.get().n === 0, biz:{name:getKV('biz', {}).name || ''}}));
app.post('/api/setup', (req, res) => {
  if (q.userCount.get().n > 0) fail('Setup is already done. Please log in.', 409);
  const b = obj(req.body);
  const bizName = str(b.bizName, 80, 'Business name'); if (!bizName) fail('Enter the business name');
  const name = str(b.name, 60, 'Your name'); if (!name) fail('Enter your name');
  const login = cleanLogin(b.login), pw = String(b.password || '');
  if (pw.length < 6) fail('Password needs at least 6 characters');
  const id = db.transaction(() => {
    const r = q.insUser.run(name, login, A.hashPassword(pw), 'admin', now());
    setKV('biz', {...getKV('biz', {}), name:bizName, ph:/^\d{10}$/.test(login) ? S.fmtPh(login) : (getKV('biz', {}).ph || '')});
    return r.lastInsertRowid;
  })();
  A.startSession(req, res, id);
  res.json({ok:true});
});
app.post('/api/login', (req, res) => {
  const b = obj(req.body); let login;
  try { login = cleanLogin(b.login); } catch (_) { fail('Wrong mobile/username or password', 401); }
  const key = `${login}|${req.ip}`;
  if (A.loginBlocked(key)) fail('Too many wrong tries. Wait 10 minutes and try again.', 429);
  const u = q.userByLogin.get(login);
  if (!u || !u.active || !A.checkPassword(b.password || '', u.pass)){ A.loginFailed(key); fail('Wrong mobile/username or password', 401); }
  A.loginOk(key);
  A.startSession(req, res, u.id);
  res.json({ok:true});
});
app.post('/api/logout', (req, res) => { A.endSession(req, res); res.json({ok:true}); });

/* ---------- public pages for customers (no login, unguessable token) ---------- */
const pubPage = (title, biz, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${S.esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/styles.css"></head><body class="pub"><main class="pub-main">${inner}</main><p class="pub-foot">${S.esc(biz.name)}${biz.ph ? ' · ' + S.esc(biz.ph) : ''}</p></body></html>`;
app.get('/i/:token', async (req, res) => {
  const v = invFromRow(q.invByToken.get(String(req.params.token)));
  if (!v) return res.status(404).send('Invoice not found');
  const biz = getKV('biz', {}), bal = S.balOf(v);
  const qr = bal > 0 && biz.upi ? await qrSvg(upiLink(biz, bal, v.no)) : '';
  res.setHeader('Cache-Control', 'no-store');
  res.send(pubPage(`Invoice ${v.no}`, biz, `<div class="pub-bar no-print"><b>Invoice ${S.esc(v.no)}</b><span class="spacer"></span>${bal > 0 && biz.upi ? `<a class="btn pri" href="${S.esc(upiLink(biz, bal, v.no))}">Pay ${S.inr(bal)} by UPI</a>` : ''}<button class="btn" onclick="window.print()">Print / Save as PDF</button></div><div class="paper-wrap">${S.invPaper(v, biz, qr)}</div>`));
});
app.get('/j/:token', async (req, res) => {
  const row = q.jobByToken.get(String(req.params.token)), j = jobFromRow(row);
  if (!j) return res.status(404).send('Job card not found');
  const biz = getKV('biz', {}), st = {work:'Work in progress', ready:'Ready for pickup', done:'Delivered'}[j.status];
  res.setHeader('Cache-Control', 'no-store');
  res.send(pubPage(`Job card ${j.id}`, biz, `<div class="pub-bar no-print"><b>${S.esc(j.car)} · ${S.esc(st)}</b><span class="spacer"></span><span class="small">Expected: ${S.esc(S.fDY(j.due))}, ${S.esc(S.fTime(S.parseDT(j.due)))}</span></div><div class="paper-wrap">${S.jobPaper(j, biz, '', '')}</div>`));
});

/* ---------- everything below needs a login ---------- */
app.use('/api', A.requireUser);
const adminOnly = A.requireAdmin;

app.get('/api/boot', (req, res) => res.json({me:req.user, ...settings()}));
app.post('/api/me/password', (req, res) => {
  const b = obj(req.body), u = q.userById.get(req.user.id);
  if (!A.checkPassword(b.current || '', u.pass)) fail('Your current password is wrong', 403);
  if (String(b.next || '').length < 6) fail('New password needs at least 6 characters');
  q.setPass.run(A.hashPassword(b.next), u.id);
  A.qDelUserSessions.run(u.id); A.startSession(req, res, u.id);
  res.json({ok:true});
});

/* uploads */
app.post('/api/uploads', (req, res) => res.json({id:saveUpload(obj(req.body).dataUrl, req.user.id)}));
app.get('/api/uploads/:id', (req, res) => {
  const id = String(req.params.id), u = /^[a-f0-9]{24}$/.test(id) && q.upload.get(id);
  if (!u) return res.status(404).json({error:'Photo not found'});
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type(u.mime).sendFile(path.join(UPLOAD_DIR, id));
});

/* home */
app.get('/api/home', (req, res) => {
  const st = settings(), today = S.todayS(), ym = today.slice(0, 7);
  const work = q.jobsByStatus.all('work', 500).map(listJob), ready = q.jobsByStatus.all('ready', 500).map(listJob);
  const invs = q.invsWithPaid.all();
  const due = invs.filter(r => !r.cancelled && r.total - r.paid > 0).map(r => { const d = JSON.parse(r.doc); return {no:r.no, date:r.date, cust:d.cust, car:d.car, bal:r.total - r.paid}; });
  const out = {work, ready, coll:q.collToday.get(today).n, pending:due.reduce((s, x) => s + x.bal, 0), due:due.slice(0, 30), dueCount:due.length,
    bays:st.bays.map(b => ({...b, jobs:work.filter(j => j.bay === b.id).map(j => ({id:j.id, car:j.car, due:j.due}))}))};
  if (canSales(req)){
    const month = invs.filter(r => !r.cancelled && r.date.slice(0, 7) === ym), top = {};
    month.forEach(r => JSON.parse(r.doc).lines.forEach(l => { const k = S.shortName(l.name); top[k] = (top[k] || 0) + l.amt; }));
    out.sales = {month:month.reduce((s, r) => s + r.total, 0), count:month.length, tops:Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5)};
  }
  res.json(out);
});

/* jobs */
app.get('/api/jobs', (req, res) => {
  const tab = ['work', 'ready', 'done', 'all'].includes(req.query.tab) ? req.query.tab : 'work', qs = String(req.query.q || '').trim().slice(0, 60);
  let list;
  if (qs) list = q.jobsAll.all(5000).map(listJob).filter(j => S.hit(qs, j.id, j.reg, j.ph, j.cust, j.car)).slice(0, 200);
  else list = (tab === 'all' ? q.jobsAll.all(300) : q.jobsByStatus.all(tab, tab === 'done' ? 300 : 1000)).map(listJob);
  const counts = {work:0, ready:0, done:0}; q.jobCounts.all().forEach(r => { counts[r.status] = r.n; });
  counts.all = counts.work + counts.ready + counts.done;
  res.json({list, counts});
});
app.get('/api/jobs/:id', async (req, res) => {
  const j = loadJob(String(req.params.id)); if (!j) fail('Job card not found', 404);
  const link = `${baseUrl(req)}/j/${j.token}`;
  res.json({job:j, link, qr:await qrSvg(link)});
});
app.post('/api/jobs', (req, res) => { const id = createJob(req.user, req.body, {discLimit:discLimit(req)}); res.json({id}); });
app.post('/api/jobs/:id/ready', (req, res) => { markReady(req.user, String(req.params.id)); res.json({ok:true}); });
app.post('/api/jobs/:id/invoice', (req, res) => res.json({no:makeInvoice(req.user, String(req.params.id))}));
app.post('/api/jobs/:id/log', (req, res) => {
  const id = String(req.params.id); if (!q.job.get(id)) fail('Job card not found', 404);
  const text = str(obj(req.body).text, 200, 'Note'); if (!text) fail('Empty note');
  q.log.run(id, now(), text, req.user.id); res.json({ok:true});
});
app.get('/api/workload', (req, res) => {
  const work = q.jobsByStatus.all('work', 1000).map(listJob), bays = {}, team = {};
  work.forEach(j => { if (j.bay) (bays[j.bay] = bays[j.bay] || []).push({id:j.id, car:j.car, due:j.due}); (j.team || []).forEach(n => { team[n] = (team[n] || 0) + 1; }); });
  res.json({bays, team, nextId:'JC-' + pad4(q.maxJobSeq.get().n + 1)});
});
app.get('/api/find', (req, res) => {
  const qs = String(req.query.q || '').trim(); let c = null, carKey = null;
  let d = S.digits(qs); if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 10) c = q.custByPhone.get(d);
  if (!c){ const k = regKey(qs); if (k.length >= 4){ const v = q.vehByKey.get(k); if (v){ c = q.custById.get(v.customer_id); carKey = k; } } }
  if (!c) return res.json({match:null});
  const cars = q.vehsOf.all(c.id).map(v => ({reg:v.reg, model:v.model, color:v.color, seg:v.seg, key:v.reg_key}));
  if (carKey) cars.sort((a, b) => (b.key === carKey) - (a.key === carKey));
  const jobs = q.jobsOfCust.all(c.id), invs = q.invsOfCust.all(c.id);
  const last = [...jobs.map(r => r.created), ...invs.map(r => r.date)].sort().pop() || c.created;
  res.json({match:{name:c.name, ph:S.fmtPh(c.phone), email:c.email, cars, visits:jobs.length + invs.filter(r => !r.job_id).length, last}});
});

/* invoices */
app.get('/api/invoices', (req, res) => {
  const tab = req.query.tab === 'unpaid' ? 'unpaid' : 'all', qs = String(req.query.q || '').trim().slice(0, 60);
  const rows = q.invsWithPaid.all().map(r => { const d = JSON.parse(r.doc); return {no:r.no, date:r.date, cust:d.cust, ph:d.ph, car:d.car, reg:d.reg, total:r.total, paid:r.paid, bal:r.cancelled ? 0 : r.total - r.paid, cancelled:!!r.cancelled}; });
  const unpaid = rows.filter(r => r.bal > 0).length;
  const list = rows.filter(r => (tab === 'all' || r.bal > 0) && S.hit(qs, r.no, r.cust, r.reg, r.ph, r.car)).slice(0, qs ? 200 : 300);
  res.json({list, counts:{all:rows.length, unpaid}});
});
app.get('/api/invoice', async (req, res) => {
  const v = invFromRow(q.inv.get(String(req.query.no || ''))); if (!v) fail('Invoice not found', 404);
  const biz = getKV('biz', {}), bal = S.balOf(v);
  res.json({inv:v, link:`${baseUrl(req)}/i/${v.token}`, qr:bal > 0 && biz.upi ? await qrSvg(upiLink(biz, bal, v.no)) : '', canCancel:canCancel(req)});
});
app.post('/api/invoice/pay', (req, res) => { const b = obj(req.body); res.json(addPayment(req.user, String(b.no || ''), b.amt, b.mode)); });
app.post('/api/invoice/cancel', (req, res) => {
  if (!canCancel(req)) fail('Only the owner can cancel invoices', 403);
  const no = String(obj(req.body).no || ''), v = invFromRow(q.inv.get(no)); if (!v) fail('Invoice not found', 404);
  if (v.cancelled) fail('This invoice is already cancelled');
  db.transaction(() => { q.cancelInv.run(no); if (v.jobId) q.log.run(v.jobId, now(), `Invoice ${no} cancelled by ${whoName(req.user)}`, req.user.id); })();
  res.json({ok:true});
});

/* customers */
app.get('/api/customers', (req, res) => {
  const qs = String(req.query.q || '').trim().slice(0, 60), sales = canSales(req), vehs = {};
  q.allVehs.all().forEach(v => (vehs[v.customer_id] = vehs[v.customer_id] || []).push(v));
  const all = q.customersList.all();
  const list = all.map(c => ({id:c.id, name:c.name, ph:S.fmtPh(c.phone), cars:(vehs[c.id] || []).sort((a, b) => b.id - a.id).map(v => ({reg:v.reg, model:v.model})), visits:c.visits, last:c.last, ...(sales ? {spent:c.spent} : {})}))
    .filter(c => S.hit(qs, c.name, c.ph, ...c.cars.map(x => x.reg), ...c.cars.map(x => x.model))).slice(0, 300);
  res.json({list, total:all.length});
});
app.get('/api/customers/:id', (req, res) => {
  const c = q.custById.get(Number(req.params.id)); if (!c) fail('Customer not found', 404);
  const jobs = q.jobsOfCust.all(c.id).map(listJob), invs = q.invsOfCust.all(c.id);
  const warr = []; jobs.filter(j => j.status === 'done').forEach(j => S.warrOf(j, j.doneAt || j.in).forEach(w => warr.push(w)));
  const out = {id:c.id, name:c.name, ph:S.fmtPh(c.phone), email:c.email, since:[c.created, ...jobs.map(j => j.in), ...invs.map(r => r.date)].sort()[0],
    cars:q.vehsOf.all(c.id).map(v => ({reg:v.reg, model:v.model, color:v.color, seg:v.seg})),
    jobs:jobs.filter(j => !j.inv).map(j => ({id:j.id, status:j.status, in:j.in, names:j.lines.map(l => S.shortName(l.name)).join(', ')})),
    invs:invs.map(r => { const d = JSON.parse(r.doc); return {no:r.no, date:r.date, total:r.total, bal:r.cancelled ? 0 : r.total - r.paid, cancelled:!!r.cancelled, names:d.lines.map(l => S.shortName(l.name)).join(', ')}; }),
    warr, visits:jobs.length + invs.filter(r => !r.job_id).length};
  if (canSales(req)) out.spent = invs.filter(r => !r.cancelled).reduce((s, r) => s + r.total, 0);
  res.json(out);
});

/* settings (owner only) */
app.put('/api/settings/biz', adminOnly, (req, res) => {
  const b = obj(req.body), upi = str(b.upi, 100, 'UPI ID');
  if (upi && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(upi)) fail('Enter a valid UPI ID like name@bank, or leave it empty');
  const gstin = str(b.gstin, 15, 'GSTIN').toUpperCase();
  if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) fail('GSTIN should be 15 characters, like 27ABCDE1234F1Z5');
  const name = str(b.name, 80, 'Business name'); if (!name) fail('Enter the business name');
  setKV('biz', {name, addr:str(b.addr, 200, 'Address'), ph:str(b.ph, 20, 'Phone'), gstin, gst:bool(b.gst), upi});
  res.json({ok:true, biz:getKV('biz')});
});
app.put('/api/settings/perms', adminOnly, (req, res) => {
  const b = obj(req.body);
  setKV('perms', {sales:bool(b.sales), cancel:bool(b.cancel), disc:int(b.disc, 0, 100, 'Maximum discount')});
  res.json({ok:true, perms:getKV('perms')});
});
app.put('/api/settings/catalog', adminOnly, (req, res) => {
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
  setKV('catalog', clean);
  res.json({ok:true, catalog:clean});
});
app.put('/api/settings/bays', adminOnly, (req, res) => {
  const list = arr(obj(req.body).bays).slice(0, 50).map(b => ({id:str(obj(b).id, 30, 'Bay name'), type:str(obj(b).type, 30, 'Bay use') || 'General'}));
  if (list.some(b => !b.id)) fail('Every bay needs a name');
  if (new Set(list.map(b => b.id.toLowerCase())).size !== list.length) fail('Two bays have the same name');
  const busy = q.jobsByStatus.all('work', 1000).map(listJob).find(j => j.bay && !list.some(b => b.id === j.bay));
  if (busy) fail(`${busy.bay} has a car in it (${busy.id}). Finish or move that job first.`);
  setKV('bays', list); res.json({ok:true, bays:list});
});
app.put('/api/settings/staff', adminOnly, (req, res) => {
  const list = arr(obj(req.body).staff).slice(0, 200).map(s => ({n:str(obj(s).n, 60, 'Name'), r:str(obj(s).r, 60, 'Role') || 'Team member'}));
  if (list.some(s => !s.n)) fail('Every team member needs a name');
  if (new Set(list.map(s => s.n.toLowerCase())).size !== list.length) fail('Two team members have the same name');
  setKV('staff', list); res.json({ok:true, staff:list});
});
app.get('/api/users', adminOnly, (req, res) => res.json({users:q.users.all().map(u => ({...u, active:!!u.active, me:u.id === req.user.id}))}));
app.post('/api/users', adminOnly, (req, res) => {
  const b = obj(req.body), name = str(b.name, 60, 'Name'); if (!name) fail('Enter the name');
  const login = cleanLogin(b.login), pw = String(b.password || '');
  if (pw.length < 6) fail('Password needs at least 6 characters');
  if (q.userByLogin.get(login)) fail('This mobile/username already has a login');
  q.insUser.run(name, login, A.hashPassword(pw), 'manager', now());
  res.json({ok:true});
});
app.post('/api/users/:id/password', adminOnly, (req, res) => {
  const u = q.userById.get(Number(req.params.id)); if (!u) fail('Login not found', 404);
  const pw = String(obj(req.body).password || ''); if (pw.length < 6) fail('Password needs at least 6 characters');
  q.setPass.run(A.hashPassword(pw), u.id); if (u.id !== req.user.id) A.qDelUserSessions.run(u.id);
  res.json({ok:true});
});
app.post('/api/users/:id/active', adminOnly, (req, res) => {
  const u = q.userById.get(Number(req.params.id)); if (!u) fail('Login not found', 404);
  if (u.role === 'admin') fail("The owner's login can't be turned off");
  const on = bool(obj(req.body).active); q.setActive.run(on ? 1 : 0, u.id); if (!on) A.qDelUserSessions.run(u.id);
  res.json({ok:true});
});

app.use('/api', (req, res) => res.status(404).json({error:'Not found'}));

/* ---------- static app ---------- */
app.use(express.static(path.join(__dirname, '..', 'public'), {extensions:['html'], setHeaders:res => res.setHeader('Cache-Control', 'no-cache')}));

/* ---------- errors ---------- */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof UserError) return res.status(err.code).json({error:err.message});
  if (err.type === 'entity.too.large') return res.status(413).json({error:'That photo is too large. Try a smaller one.'});
  if (err.type === 'entity.parse.failed') return res.status(400).json({error:'Bad request.'});
  console.error(err);
  res.status(500).json({error:'Something went wrong on the server. Please try again.'});
});

module.exports = {app, createJob, markReady, makeInvoice, addPayment, saveUpload};

if (require.main === module){
  const port = +process.env.PORT || 3000;
  app.listen(port, () => console.log(`DetailDesk running on http://localhost:${port}`));
}
