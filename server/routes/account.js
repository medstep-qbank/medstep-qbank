import { sql, now, getSetting, DEFAULT_SETTINGS } from '../db.js';
import { hashPassword, verifyPassword, createSession, destroySession, publicUser } from '../auth.js';
import { bad, str, int, rateLimit, clientIp, HttpError } from '../http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function siteMeta() {
  const s = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k === 'payment_instructions') continue;
    s[k] = getSetting(k, DEFAULT_SETTINGS[k]);
  }
  return s;
}

export default [
  {
    method: 'GET',
    path: '/api/meta',
    handler: ({ user }) => {
      const plans = sql('SELECT id, name, days, price, currency, description FROM plans WHERE active = 1 ORDER BY sort, id').all();
      const counts = sql(`
        SELECT step, COUNT(*) AS c FROM questions WHERE status = 'published' GROUP BY step`).all();
      const free = sql(`SELECT COUNT(*) AS c FROM questions WHERE status = 'published' AND is_free = 1`).get().c;
      return {
        settings: siteMeta(),
        demo: process.env.DEMO_MODE === '1',
        plans,
        questionCounts: Object.fromEntries(counts.map((r) => [r.step, r.c])),
        freeQuestions: free,
        user: publicUser(user),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/health',
    handler: () => {
      sql('SELECT 1').get();
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/sample',
    handler: () => {
      // A single free question for the landing page demo (full reveal is fine — it is public by design).
      const q = sql(`
        SELECT q.id, q.stem, q.lead_in, q.options, q.correct_index, q.explanation, q.objective,
               s.name AS subject, y.name AS system
        FROM questions q
        LEFT JOIN subjects s ON s.id = q.subject_id
        LEFT JOIN systems y ON y.id = q.system_id
        WHERE q.status = 'published' AND q.is_free = 1
        ORDER BY q.id LIMIT 1`).get();
      if (!q) return null;
      return { ...q, options: JSON.parse(q.options) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/register',
    handler: ({ body, req, res }) => {
      rateLimit(`reg:${clientIp(req)}`, 10, 60 * 60_000);
      const name = str(body.name, { name: 'Имя', required: true, max: 80 });
      const email = str(body.email, { name: 'Email', required: true, max: 160 }).toLowerCase();
      const password = String(body.password || '');
      if (!EMAIL_RE.test(email)) throw bad('Проверьте адрес email');
      if (password.length < 8) throw bad('Пароль должен быть не короче 8 символов');
      if (password.length > 200) throw bad('Слишком длинный пароль');
      const exists = sql('SELECT id FROM users WHERE email = ?').get(email);
      if (exists) throw bad('Этот email уже зарегистрирован. Войдите или восстановите пароль у администратора.');
      const info = sql('INSERT INTO users(email, name, password_hash, created_at) VALUES (?,?,?,?)')
        .run(email, name, hashPassword(password), now());
      createSession(res, req, Number(info.lastInsertRowid));
      return { user: publicUser(sql('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    handler: ({ body, req, res }) => {
      const email = str(body.email, { name: 'Email', required: true, max: 160 }).toLowerCase();
      rateLimit(`login:${clientIp(req)}`, 20, 15 * 60_000);
      rateLimit(`login-email:${email}`, 10, 15 * 60_000);
      const u = sql('SELECT * FROM users WHERE email = ?').get(email);
      if (!u || !verifyPassword(String(body.password || ''), u.password_hash)) {
        throw bad('Неверный email или пароль');
      }
      if (u.blocked) throw new HttpError(403, 'Аккаунт заблокирован. Свяжитесь с поддержкой.');
      createSession(res, req, u.id);
      return { user: publicUser(u) };
    },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    handler: ({ req, res }) => {
      destroySession(req, res);
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    auth: 'user',
    handler: ({ user }) => ({ user: publicUser(user) }),
  },
  {
    method: 'PUT',
    path: '/api/me',
    auth: 'user',
    handler: ({ user, body }) => {
      const name = str(body.name, { name: 'Имя', required: true, max: 80 });
      sql('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
      if (body.newPassword) {
        const full = sql('SELECT password_hash FROM users WHERE id = ?').get(user.id);
        if (!verifyPassword(String(body.currentPassword || ''), full.password_hash)) {
          throw bad('Текущий пароль указан неверно');
        }
        const np = String(body.newPassword);
        if (np.length < 8 || np.length > 200) throw bad('Новый пароль должен быть не короче 8 символов');
        sql('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), user.id);
      }
      return { user: publicUser({ ...user, name }) };
    },
  },

  /* ---------- billing (manual confirmation) ---------- */
  {
    method: 'GET',
    path: '/api/billing',
    auth: 'user',
    handler: ({ user }) => ({
      instructions: getSetting('payment_instructions', DEFAULT_SETTINGS.payment_instructions),
      plans: sql('SELECT id, name, days, price, currency, description FROM plans WHERE active = 1 ORDER BY sort, id').all(),
      orders: sql('SELECT id, plan_name, days, amount, currency, status, user_comment, admin_comment, created_at, decided_at FROM orders WHERE user_id = ? ORDER BY id DESC').all(user.id),
      user: publicUser(user),
    }),
  },
  {
    method: 'POST',
    path: '/api/orders',
    auth: 'user',
    handler: ({ user, body }) => {
      rateLimit(`order:${user.id}`, 10, 60 * 60_000);
      const planId = int(body.planId, { name: 'Тариф', min: 1 });
      const plan = sql('SELECT * FROM plans WHERE id = ? AND active = 1').get(planId);
      if (!plan) throw bad('Тариф не найден');
      const pending = sql(`SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND status = 'pending'`).get(user.id).c;
      if (pending >= 3) throw bad('У вас уже есть заявки на проверке. Дождитесь ответа администратора.');
      const comment = str(body.comment, { name: 'Комментарий', max: 500 });
      if (!comment) throw bad('Укажите номер транзакции или другие данные платежа');
      sql(`INSERT INTO orders(user_id, plan_id, plan_name, days, amount, currency, user_comment, created_at)
           VALUES (?,?,?,?,?,?,?,?)`)
        .run(user.id, plan.id, plan.name, plan.days, plan.price, plan.currency, comment, now());
      return { ok: true };
    },
  },
];

