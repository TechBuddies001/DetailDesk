// MySQL / MariaDB storage (works with Hostinger "MySQL databases").
// Everything lives in the database, photos and signatures too, so a redeploy never loses data.
const mysql = require('mysql2/promise');
const S = require('../public/shared.js');

function config(){
  if (process.env.DATABASE_URL){
    const u = new URL(process.env.DATABASE_URL);
    return {host:u.hostname, port:+u.port || 3306, user:decodeURIComponent(u.username), password:decodeURIComponent(u.password), database:decodeURIComponent(u.pathname.replace(/^\//, ''))};
  }
  return {host:process.env.DB_HOST || '127.0.0.1', port:+process.env.DB_PORT || 3306, user:process.env.DB_USER || 'root', password:process.env.DB_PASSWORD || '', database:process.env.DB_NAME || 'detaildesk'};
}
const cfg = config();
if (cfg.host === 'localhost') cfg.host = '127.0.0.1'; // Hostinger: "localhost" resolves to IPv6 ::1, which MySQL there refuses
const pool = mysql.createPool({...cfg, charset:'utf8mb4', connectionLimit:+process.env.DB_POOL || 5, waitForConnections:true, decimalNumbers:true, supportBigNumbers:true, dateStrings:true, enableKeepAlive:true, connectTimeout:15000});
// READ COMMITTED: fewer gap locks, so people saving at the same time don't block each other.
pool.pool.on('connection', conn => conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED'));

const all = async (sql, p = [], c = pool) => { const [rows] = await c.query(sql, p); return rows; };
const one = async (sql, p = [], c = pool) => (await all(sql, p, c))[0] || null;
const run = async (sql, p = [], c = pool) => { const [r] = await c.query(sql, p); return r; };
// Runs fn inside a transaction; retries a few times if MySQL reports a deadlock (normal under load).
async function tx(fn, tries = 5){
  for (let i = 1; ; i++){
    const c = await pool.getConnection();
    try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
    catch (e){
      try { await c.rollback(); } catch (_) {}
      if ((e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') && i < tries){ await new Promise(r => setTimeout(r, 15 * i + Math.random() * 40)); continue; }
      throw e;
    }
    finally { c.release(); }
  }
}
// Gap-free running numbers (job cards, invoice series per financial year), safe with several users at once.
async function nextNum(c, key){
  await c.query('INSERT INTO counters (k, n) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE n = LAST_INSERT_ID(n + 1)', [key]);
  const [[r]] = await c.query('SELECT LAST_INSERT_ID() AS n');
  return Number(r.n);
}
const peekNum = async key => { const r = await one('SELECT n FROM counters WHERE k = ?', [key]); return r ? Number(r.n) : 0; };

const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (k VARCHAR(64) NOT NULL PRIMARY KEY, v MEDIUMTEXT NOT NULL) ${T}`,
  `CREATE TABLE IF NOT EXISTS counters (k VARCHAR(32) NOT NULL PRIMARY KEY, n INT NOT NULL) ${T}`,
  `CREATE TABLE IF NOT EXISTS users (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, login VARCHAR(60) NOT NULL UNIQUE, pass VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL, active TINYINT NOT NULL DEFAULT 1, created VARCHAR(16) NOT NULL) ${T}`,
  `CREATE TABLE IF NOT EXISTS sessions (token CHAR(64) NOT NULL PRIMARY KEY, user_id INT NOT NULL, expires BIGINT NOT NULL, KEY sessions_user (user_id),
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ${T}`,
  `CREATE TABLE IF NOT EXISTS customers (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, phone CHAR(10) NOT NULL UNIQUE, email VARCHAR(120) NOT NULL DEFAULT '', created VARCHAR(16) NOT NULL) ${T}`,
  `CREATE TABLE IF NOT EXISTS vehicles (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, customer_id INT NOT NULL, reg VARCHAR(20) NOT NULL, reg_key VARCHAR(20) NOT NULL UNIQUE,
    model VARCHAR(60) NOT NULL, color VARCHAR(30) NOT NULL DEFAULT '', seg TINYINT NULL, KEY vehicles_customer (customer_id),
    CONSTRAINT vehicles_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id)) ${T}`,
  `CREATE TABLE IF NOT EXISTS jobs (id VARCHAR(16) NOT NULL PRIMARY KEY, seq INT NOT NULL UNIQUE, customer_id INT NOT NULL, vehicle_id INT NOT NULL, status VARCHAR(8) NOT NULL,
    created VARCHAR(16) NOT NULL, token CHAR(24) NOT NULL UNIQUE, doc MEDIUMTEXT NOT NULL, KEY jobs_status (status, created), KEY jobs_customer (customer_id),
    CONSTRAINT jobs_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id), CONSTRAINT jobs_vehicle_fk FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)) ${T}`,
  `CREATE TABLE IF NOT EXISTS invoices (inv_no VARCHAR(24) NOT NULL PRIMARY KEY, fy CHAR(5) NOT NULL, seq INT NOT NULL, inv_date VARCHAR(16) NOT NULL, job_id VARCHAR(16) NULL,
    customer_id INT NOT NULL, token CHAR(24) NOT NULL UNIQUE, cancelled TINYINT NOT NULL DEFAULT 0, total INT NOT NULL, doc MEDIUMTEXT NOT NULL,
    UNIQUE KEY invoices_series (fy, seq), KEY invoices_customer (customer_id), KEY invoices_date (inv_date), KEY invoices_job (job_id)) ${T}`,
  `CREATE TABLE IF NOT EXISTS payments (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, job_id VARCHAR(16) NULL, invoice_no VARCHAR(24) NULL, amt INT NOT NULL, pay_mode VARCHAR(8) NOT NULL,
    paid_at VARCHAR(16) NOT NULL, note VARCHAR(40) NOT NULL DEFAULT '', user_id INT NULL, KEY payments_invoice (invoice_no), KEY payments_job (job_id), KEY payments_at (paid_at)) ${T}`,
  `CREATE TABLE IF NOT EXISTS job_log (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, job_id VARCHAR(16) NOT NULL, at_time VARCHAR(16) NOT NULL, msg VARCHAR(255) NOT NULL, user_id INT NULL, KEY job_log_job (job_id)) ${T}`,
  `CREATE TABLE IF NOT EXISTS uploads (id CHAR(24) NOT NULL PRIMARY KEY, mime VARCHAR(20) NOT NULL, bytes INT NOT NULL, bin MEDIUMBLOB NOT NULL, created VARCHAR(16) NOT NULL, user_id INT NULL) ${T}`
];
const DEFAULTS = {
  biz:{name:'My Car Care Studio', addr:'', ph:'', gstin:'', gst:true, upi:''},
  perms:{sales:false, cancel:false, disc:10},
  catalog:S.CATALOG0,
  bays:[{id:'Bay 1', type:'PPF'}, {id:'Bay 2', type:'PPF'}, {id:'Bay 3', type:'Coating'}, {id:'Bay 4', type:'Polish'}, {id:'Wash bay', type:'Wash'}, {id:'Service bay', type:'Mechanical'}],
  staff:[],
  invoice:{prefix:'INV', terms:S.DEFAULT_TERMS},
  cats:S.CATS.slice(1)
};
async function init(){
  for (const s of SCHEMA) await pool.query(s);
  for (const [k, v] of Object.entries(DEFAULTS)) await pool.query('INSERT IGNORE INTO kv (k, v) VALUES (?, ?)', [k, JSON.stringify(v)]);
  // One-time upgrade: the first owner login becomes the Super Admin if there isn't one yet.
  if (!(await one("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1"))){
    const a = await one("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (a) await run("UPDATE users SET role = 'superadmin' WHERE id = ?", [a.id]);
  }
}

/* ---------- settings ---------- */
async function getKV(k, fallback, c = pool){ const r = await one('SELECT v FROM kv WHERE k = ?', [k], c); if (!r) return fallback; try { return JSON.parse(r.v); } catch (_) { return fallback; } }
async function setKV(k, v, c = pool){ const s = JSON.stringify(v); await run('INSERT INTO kv (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = ?', [k, s, s], c); }
async function settings(c = pool){
  const rows = await all('SELECT k, v FROM kv WHERE k IN (?)', [Object.keys(DEFAULTS)], c), m = {};
  rows.forEach(r => { try { m[r.k] = JSON.parse(r.v); } catch (_) {} });
  return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, m[k] ?? DEFAULTS[k]]));
}

/* ---------- row -> object ---------- */
function jobFromRow(r){
  if (!r) return null;
  const j = JSON.parse(r.doc);
  j.id = r.id; j.status = r.status; j.in = r.created; j.token = r.token; j.customerId = r.customer_id;
  return j;
}
async function invFromRow(r, c = pool){
  if (!r) return null;
  const v = JSON.parse(r.doc);
  v.no = r.inv_no; v.date = r.inv_date; v.jobId = r.job_id; v.token = r.token; v.cancelled = !!r.cancelled; v.customerId = r.customer_id;
  v.pays = await all('SELECT amt, pay_mode AS mode, paid_at AS d, note FROM payments WHERE invoice_no = ? ORDER BY paid_at, id', [r.inv_no], c);
  return v;
}

module.exports = {pool, all, one, run, tx, nextNum, peekNum, init, getKV, setKV, settings, jobFromRow, invFromRow, DEFAULTS};
