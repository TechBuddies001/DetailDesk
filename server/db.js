// SQLite storage. One file (data/detaildesk.db) holds everything; photos live in data/uploads/.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const S = require('../public/shared.js');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, {recursive:true});

const db = new Database(path.join(DATA_DIR, 'detaildesk.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE, pass TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager')), active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), reg TEXT NOT NULL, reg_key TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', seg INTEGER);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id), vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  status TEXT NOT NULL CHECK (status IN ('work','ready','done')), created TEXT NOT NULL, token TEXT NOT NULL UNIQUE, doc TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created);
CREATE INDEX IF NOT EXISTS jobs_customer ON jobs(customer_id);
CREATE TABLE IF NOT EXISTS invoices (
  no TEXT PRIMARY KEY, fy TEXT NOT NULL, seq INTEGER NOT NULL, date TEXT NOT NULL, job_id TEXT REFERENCES jobs(id), customer_id INTEGER NOT NULL REFERENCES customers(id),
  token TEXT NOT NULL UNIQUE, cancelled INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, doc TEXT NOT NULL, UNIQUE (fy, seq));
CREATE INDEX IF NOT EXISTS invoices_date ON invoices(date);
CREATE INDEX IF NOT EXISTS invoices_customer ON invoices(customer_id);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, job_id TEXT REFERENCES jobs(id), invoice_no TEXT REFERENCES invoices(no), amt INTEGER NOT NULL CHECK (amt > 0),
  mode TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', user_id INTEGER);
CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_no);
CREATE INDEX IF NOT EXISTS payments_job ON payments(job_id);
CREATE INDEX IF NOT EXISTS payments_at ON payments(at);
CREATE TABLE IF NOT EXISTS job_log (id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), at TEXT NOT NULL, text TEXT NOT NULL, user_id INTEGER);
CREATE INDEX IF NOT EXISTS job_log_job ON job_log(job_id);
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created TEXT NOT NULL, user_id INTEGER);
`);

/* ---------- key/value settings ---------- */
const kvGet = db.prepare('SELECT v FROM kv WHERE k = ?');
const kvSet = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
function getKV(k, fallback){ const r = kvGet.get(k); if (!r) return fallback; try { return JSON.parse(r.v); } catch (_) { return fallback; } }
function setKV(k, v){ kvSet.run(k, JSON.stringify(v)); }

const DEFAULTS = {
  biz:{name:'My Car Care Studio', addr:'', ph:'', gstin:'', gst:true, upi:''},
  perms:{sales:false, cancel:false, disc:10},
  catalog:S.CATALOG0,
  bays:[{id:'Bay 1', type:'PPF'}, {id:'Bay 2', type:'PPF'}, {id:'Bay 3', type:'Coating'}, {id:'Bay 4', type:'Polish'}, {id:'Wash bay', type:'Wash'}, {id:'Service bay', type:'Mechanical'}],
  staff:[]
};
for (const [k, v] of Object.entries(DEFAULTS)) if (!kvGet.get(k)) setKV(k, v);

const settings = () => ({biz:getKV('biz', DEFAULTS.biz), perms:getKV('perms', DEFAULTS.perms), catalog:getKV('catalog', DEFAULTS.catalog), bays:getKV('bays', DEFAULTS.bays), staff:getKV('staff', DEFAULTS.staff)});

/* ---------- row <-> object ---------- */
function jobFromRow(r){
  if (!r) return null;
  const j = JSON.parse(r.doc);
  j.id = r.id; j.status = r.status; j.in = r.created; j.token = r.token; j.customerId = r.customer_id;
  return j;
}
const paysForInv = db.prepare('SELECT amt, mode, at AS d, note FROM payments WHERE invoice_no = ? ORDER BY at, id');
function invFromRow(r){
  if (!r) return null;
  const v = JSON.parse(r.doc);
  v.no = r.no; v.date = r.date; v.jobId = r.job_id; v.token = r.token; v.cancelled = !!r.cancelled; v.customerId = r.customer_id;
  v.pays = paysForInv.all(r.no);
  return v;
}

module.exports = {db, DATA_DIR, UPLOAD_DIR, getKV, setKV, settings, jobFromRow, invFromRow};
