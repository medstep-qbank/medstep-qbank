import crypto from 'node:crypto';
import { sql, now } from './db.js';
import { parseCookies, isHttps } from './http.js';

const SESSION_DAYS = 30;
export const COOKIE = 'sid';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: 16384, r: 8, p: 1,
  });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  sql('INSERT INTO sessions(token_hash, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)')
    .run(sha256(token), userId, now(), expires.toISOString(), String(req.headers['user-agent'] || '').slice(0, 300));
  sql('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
  setCookie(res, req, token, SESSION_DAYS * 86400);
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) sql('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  setCookie(res, req, '', 0);
}

function setCookie(res, req, value, maxAge) {
  const parts = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function getSessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = sql(`
    SELECT u.id, u.email, u.name, u.role, u.access_until, u.blocked, u.created_at, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < now() || row.blocked) {
    sql('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    return null;
  }
  return row;
}

export function hasFullAccess(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'author') return true;
  return Boolean(user.access_until && user.access_until > now());
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    accessUntil: u.access_until,
    hasAccess: hasFullAccess(u),
    createdAt: u.created_at,
  };
}

export function cleanupSessions() {
  sql('DELETE FROM sessions WHERE expires_at < ?').run(now());
}
