// Logins: scrypt password hashes, random session tokens in an HTTP-only cookie.
const crypto = require('crypto');
const {db} = require('./db');

const COOKIE = 'dd_session';
const SESSION_DAYS = 30;

function hashPassword(pw){
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function checkPassword(pw, stored){
  const [kind, saltHex, keyHex] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

const qInsSession = db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)');
const qGetSession = db.prepare('SELECT u.id, u.name, u.login, u.role, u.active, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?');
const qDelSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const qDelUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const qPurge = db.prepare('DELETE FROM sessions WHERE expires < ?');

function readCookie(req){
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')){ const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim()); }
  return null;
}
function cookieHeader(req, token, maxAgeSec){
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
function startSession(req, res, userId){
  qPurge.run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  qInsSession.run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
}
function endSession(req, res){
  const t = readCookie(req); if (t) qDelSession.run(t);
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
}
function currentUser(req){
  const t = readCookie(req); if (!t) return null;
  const u = qGetSession.get(t);
  if (!u || !u.active || u.expires < Date.now()) return null;
  return {id:u.id, name:u.name, login:u.login, role:u.role};
}

/* simple brute-force guard: 5 wrong tries per login+IP locks for 10 minutes */
const tries = new Map();
function loginBlocked(key){ const t = tries.get(key); return !!t && t.n >= 5 && Date.now() - t.at < 10 * 60e3; }
function loginFailed(key){ const t = tries.get(key); if (!t || Date.now() - t.at > 10 * 60e3) tries.set(key, {n:1, at:Date.now()}); else { t.n++; t.at = Date.now(); } }
function loginOk(key){ tries.delete(key); }

function requireUser(req, res, next){
  const u = currentUser(req);
  if (!u) return res.status(401).json({error:'Please log in again.'});
  req.user = u; next();
}
function requireAdmin(req, res, next){
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({error:'Only the owner (Admin) can do this.'});
  next();
}

module.exports = {hashPassword, checkPassword, startSession, endSession, currentUser, requireUser, requireAdmin, loginBlocked, loginFailed, loginOk, qDelUserSessions};
