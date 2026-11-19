// Logins: scrypt password hashes, random session tokens in an HTTP-only cookie.
const crypto = require('crypto');
const {one, run} = require('./db');

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

function readCookie(req){
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')){ const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === COOKIE){ try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return null; } } }
  return null;
}
function cookieHeader(req, token, maxAgeSec){
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}
async function startSession(req, res, userId){
  await run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
  const token = crypto.randomBytes(32).toString('hex');
  await run('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)', [token, userId, Date.now() + SESSION_DAYS * 864e5]);
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 86400));
}
async function endSession(req, res){
  const t = readCookie(req); if (t) await run('DELETE FROM sessions WHERE token = ?', [t]);
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
}
async function currentUser(req){
  const t = readCookie(req); if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const u = await one('SELECT u.id, u.name, u.login, u.role, u.active, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [t]);
  if (!u || !u.active || Number(u.expires) < Date.now()) return null;
  return {id:u.id, name:u.name, login:u.login, role:u.role};
}
const delUserSessions = userId => run('DELETE FROM sessions WHERE user_id = ?', [userId]);

/* simple brute-force guard: 5 wrong tries per login+IP locks for 10 minutes */
const tries = new Map();
function loginBlocked(key){ const t = tries.get(key); return !!t && t.n >= 5 && Date.now() - t.at < 10 * 60e3; }
function loginFailed(key){ const t = tries.get(key); if (!t || Date.now() - t.at > 10 * 60e3) tries.set(key, {n:1, at:Date.now()}); else { t.n++; t.at = Date.now(); } }
function loginOk(key){ tries.delete(key); }

async function requireUser(req, res, next){
  const u = await currentUser(req);
  if (!u) return res.status(401).json({error:'Please log in again.'});
  req.user = u; next();
}
function requireAdmin(req, res, next){
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({error:'Only the owner (Admin) can do this.'});
  next();
}

module.exports = {hashPassword, checkPassword, startSession, endSession, currentUser, requireUser, requireAdmin, loginBlocked, loginFailed, loginOk, delUserSessions};
