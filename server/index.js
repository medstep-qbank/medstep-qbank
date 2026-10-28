import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, sql, now, ensureDefaults, UPLOAD_DIR } from './db.js';
import { getSessionUser, hashPassword, cleanupSessions } from './auth.js';
import { HttpError, sendJson, readJson } from './http.js';
import accountRoutes from './routes/account.js';
import qbankRoutes from './routes/qbank.js';
import studyRoutes from './routes/study.js';
import adminRoutes from './routes/admin.js';
import { seedDemo } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

/* ---------- startup ---------- */
ensureDefaults();

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.toLowerCase();
  const u = sql('SELECT id, role FROM users WHERE email = ?').get(email);
  if (!u) {
    sql(`INSERT INTO users(email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)`)
      .run(email, 'Администратор', hashPassword(process.env.ADMIN_PASSWORD), now());
    console.log(`Создан администратор ${email}`);
  } else if (u.role !== 'admin') {
    sql(`UPDATE users SET role = 'admin' WHERE id = ?`).run(u.id);
  }
}

if (process.env.SEED_DEMO !== '0' && sql('SELECT COUNT(*) AS c FROM questions').get().c === 0) {
  const n = seedDemo();
  console.log(`Добавлено демо-вопросов: ${n} (отключить: SEED_DEMO=0)`);
}

cleanupSessions();
setInterval(cleanupSessions, 6 * 3600_000).unref();

/* ---------- routing ---------- */
const ROLE_RANK = { student: 1, author: 2, admin: 3 };

const routes = [...accountRoutes, ...qbankRoutes, ...studyRoutes, ...adminRoutes].map((r) => {
  const keys = [];
  const pattern = r.path.replace(/:([a-z]+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { ...r, keys, re: new RegExp(`^${pattern}$`) };
});

function match(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { route: r, params };
  }
  return pathMatched ? 'method' : null;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients and same-origin GET-like navigations
  try {
    const o = new URL(origin);
    const host = (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-host']) || req.headers.host;
    return o.host === host;
  } catch {
    return false;
  }
}

async function handleApi(req, res, url) {
  const m = match(req.method, url.pathname);
  if (!m) throw new HttpError(404, 'Метод API не найден');
  if (m === 'method') throw new HttpError(405, 'Метод не поддерживается');
  const { route, params } = m;

  if (req.method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Запрос с чужого сайта отклонён');

  const user = getSessionUser(req);
  if (route.auth) {
    if (!user) throw new HttpError(401, 'Войдите в аккаунт');
    if (ROLE_RANK[user.role] < ROLE_RANK[route.auth === 'user' ? 'student' : route.auth]) {
      throw new HttpError(403, 'Недостаточно прав');
    }
  }
  const body = req.method === 'GET' || route.raw ? {} : await readJson(req, route.limit);
  const result = await route.handler({ req, res, url, query: url.searchParams, params, user, body });
  if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
}

/* ---------- static files ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function sendFile(req, res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не найдено');
      return;
    }
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      ETag: etag,
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname.startsWith('/uploads/')) {
    const file = path.join(UPLOAD_DIR, path.basename(pathname));
    return sendFile(req, res, file, 'public, max-age=31536000, immutable');
  }
  const file = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (path.extname(pathname)) return sendFile(req, res, file, 'no-cache');
  // SPA fallback: every route without an extension renders the app shell.
  return sendFile(req, res, path.join(PUBLIC_DIR, 'index.html'), 'no-cache');
}

/* ---------- server ---------- */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) {
      if (!res.headersSent) sendJson(res, e.status, { error: e.message, ...e.extra });
    } else {
      console.error(new Date().toISOString(), req.method, url.pathname, e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера. Попробуйте ещё раз.' });
    }
  }
});

server.requestTimeout = 60_000;
server.listen(PORT, HOST, () => {
  console.log(`Сайт запущен: http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
