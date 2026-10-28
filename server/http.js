export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Не найдено') => new HttpError(404, msg);
export const forbidden = (msg = 'Недостаточно прав') => new HttpError(403, msg);

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 2 * 1024 * 1024) {
  const ct = req.headers['content-type'] || '';
  const buf = await readBody(req, limit);
  if (buf.length === 0) return {};
  if (!ct.includes('application/json')) throw new HttpError(415, 'Ожидается JSON');
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw bad('Некорректный JSON');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function isHttps(req) {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') return true;
  return Boolean(req.socket.encrypted);
}

/* ---------- validation helpers ---------- */

export function str(v, { name, min = 0, max = 10000, required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') v = String(v);
  v = v.trim();
  if (required && !v) throw bad(`Поле «${name}» обязательно`);
  if (v.length < min) throw bad(`Поле «${name}»: минимум ${min} символов`);
  if (v.length > max) throw bad(`Поле «${name}»: максимум ${max} символов`);
  return v;
}

export function int(v, { name, min = -Infinity, max = Infinity, fallback } = {}) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`Поле «${name}» должно быть целым числом`);
  if (n < min || n > max) throw bad(`Поле «${name}» вне допустимого диапазона`);
  return n;
}

export function intList(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/* ---------- simple in-memory rate limiter ---------- */
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) {
    b = { count: 0, reset: t + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (b.count > max) {
    const wait = Math.ceil((b.reset - t) / 60000);
    throw new HttpError(429, `Слишком много попыток. Попробуйте через ${wait} мин.`);
  }
}
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
}, 60_000).unref();
