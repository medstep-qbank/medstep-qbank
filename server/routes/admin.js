import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sql, tx, now, UPLOAD_DIR, getSetting, setSetting, DEFAULT_SETTINGS } from '../db.js';
import { hashPassword } from '../auth.js';
import { bad, notFound, forbidden, int, str, readBody } from '../http.js';
import { normalizeQuestion, insertQuestion, updateQuestion, parseCsv, csvRowToQuestion, exportQuestions } from '../questions.js';

const PAGE = 50;

function questionOut(q) {
  return {
    id: q.id,
    step: q.step,
    subjectId: q.subject_id,
    systemId: q.system_id,
    topic: q.topic,
    stem: q.stem,
    leadIn: q.lead_in,
    options: JSON.parse(q.options),
    correct: q.correct_index,
    explanation: q.explanation,
    objective: q.objective,
    image: q.image,
    explanationImage: q.explanation_image,
    difficulty: q.difficulty,
    status: q.status,
    isFree: Boolean(q.is_free),
    createdAt: q.created_at,
    updatedAt: q.updated_at,
  };
}

function taxonomyRoutes(kind) {
  const table = kind; // 'subjects' | 'systems'
  const col = kind === 'subjects' ? 'subject_id' : 'system_id';
  const label = kind === 'subjects' ? 'Предмет' : 'Система';
  return [
    {
      method: 'GET',
      path: `/api/admin/${kind}`,
      auth: 'author',
      handler: () => sql(`SELECT g.id, g.name, g.sort, (SELECT COUNT(*) FROM questions q WHERE q.${col} = g.id) AS questions
                         FROM ${table} g ORDER BY g.sort, g.name`).all(),
    },
    {
      method: 'POST',
      path: `/api/admin/${kind}`,
      auth: 'author',
      handler: ({ body }) => {
        const name = str(body.name, { name: label, required: true, max: 80 });
        if (sql(`SELECT id FROM ${table} WHERE name = ?`).get(name)) throw bad(`${label} с таким названием уже есть`);
        const max = sql(`SELECT COALESCE(MAX(sort), 0) AS m FROM ${table}`).get().m;
        const info = sql(`INSERT INTO ${table}(name, sort) VALUES (?, ?)`).run(name, max + 1);
        return { id: Number(info.lastInsertRowid) };
      },
    },
    {
      method: 'PUT',
      path: `/api/admin/${kind}/:id`,
      auth: 'author',
      handler: ({ params, body }) => {
        const id = int(params.id, { name: 'id' });
        const name = str(body.name, { name: label, required: true, max: 80 });
        const sort = int(body.sort, { name: 'Порядок', min: 0, max: 100000, fallback: 0 });
        const dupe = sql(`SELECT id FROM ${table} WHERE name = ? AND id != ?`).get(name, id);
        if (dupe) throw bad(`${label} с таким названием уже есть`);
        const r = sql(`UPDATE ${table} SET name = ?, sort = ? WHERE id = ?`).run(name, sort, id);
        if (!r.changes) throw notFound();
        return { ok: true };
      },
    },
    {
      method: 'DELETE',
      path: `/api/admin/${kind}/:id`,
      auth: 'author',
      handler: ({ params }) => {
        const id = int(params.id, { name: 'id' });
        const used = sql(`SELECT COUNT(*) AS c FROM questions WHERE ${col} = ?`).get(id).c;
        if (used) throw bad(`Нельзя удалить: используется в ${used} вопросах. Сначала перенесите вопросы.`);
        sql(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return { ok: true };
      },
    },
  ];
}

const IMAGE_TYPES = [
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', test: (b) => b.slice(0, 4).toString('ascii') === 'GIF8' },
  { ext: 'webp', test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

export default [
  {
    method: 'GET',
    path: '/api/admin/overview',
    auth: 'author',
    handler: () => {
      const byStatus = Object.fromEntries(sql('SELECT status, COUNT(*) AS c FROM questions GROUP BY status').all().map((r) => [r.status, r.c]));
      const byStep = Object.fromEntries(sql(`SELECT step, COUNT(*) AS c FROM questions WHERE status = 'published' GROUP BY step`).all().map((r) => [r.step, r.c]));
      const dayAgo = new Date(Date.now() - 86400_000).toISOString();
      return {
        questions: byStatus,
        publishedByStep: byStep,
        users: sql('SELECT COUNT(*) AS c FROM users').get().c,
        subscribers: sql('SELECT COUNT(*) AS c FROM users WHERE access_until > ?').get(now()).c,
        newUsers24h: sql('SELECT COUNT(*) AS c FROM users WHERE created_at > ?').get(dayAgo).c,
        tests24h: sql('SELECT COUNT(*) AS c FROM tests WHERE created_at > ?').get(dayAgo).c,
        pendingOrders: sql(`SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'`).get().c,
      };
    },
  },

  /* ---------- questions ---------- */
  {
    method: 'GET',
    path: '/api/admin/questions',
    auth: 'author',
    handler: ({ query }) => {
      const conds = ['1=1'];
      const p = [];
      const qtext = (query.get('q') || '').trim();
      if (qtext) {
        if (/^#?\d+$/.test(qtext)) { conds.push('q.id = ?'); p.push(Number(qtext.replace('#', ''))); }
        else {
          conds.push('(ulower(q.stem) LIKE ? OR ulower(q.lead_in) LIKE ? OR ulower(q.topic) LIKE ? OR ulower(q.explanation) LIKE ?)');
          const like = `%${qtext.replace(/[%_]/g, '').toLowerCase()}%`;
          p.push(like, like, like, like);
        }
      }
      for (const [param, col] of [['status', 'q.status'], ['step', 'q.step']]) {
        const v = query.get(param);
        if (v) { conds.push(`${col} = ?`); p.push(v); }
      }
      for (const [param, col] of [['subject', 'q.subject_id'], ['system', 'q.system_id']]) {
        const v = query.get(param);
        if (v) { conds.push(`${col} = ?`); p.push(Number(v)); }
      }
      if (query.get('free') === '1') conds.push('q.is_free = 1');
      const page = Math.max(1, Number(query.get('page')) || 1);
      const where = conds.join(' AND ');
      const total = sql(`SELECT COUNT(*) AS c FROM questions q WHERE ${where}`).get(...p).c;
      const rows = sql(`
        SELECT q.id, q.step, q.topic, q.status, q.is_free, q.difficulty, q.updated_at,
               substr(q.lead_in, 1, 200) AS lead_in, substr(q.stem, 1, 200) AS stem,
               s.name AS subject, y.name AS system,
               (SELECT COUNT(*) FROM test_items ti WHERE ti.question_id = q.id AND ti.answered_at IS NOT NULL) AS answered,
               (SELECT AVG(ti.is_correct) FROM test_items ti WHERE ti.question_id = q.id AND ti.answered_at IS NOT NULL) AS pct
        FROM questions q
        LEFT JOIN subjects s ON s.id = q.subject_id
        LEFT JOIN systems y ON y.id = q.system_id
        WHERE ${where} ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...p, PAGE, (page - 1) * PAGE);
      return {
        total,
        page,
        pages: Math.max(1, Math.ceil(total / PAGE)),
        items: rows.map((r) => ({
          ...r,
          is_free: Boolean(r.is_free),
          pct: r.pct == null ? null : Math.round(r.pct * 100),
        })),
      };
    },
  },
  {
    method: 'GET',
    path: '/api/admin/questions/:id',
    auth: 'author',
    handler: ({ params }) => {
      const q = sql('SELECT * FROM questions WHERE id = ?').get(int(params.id, { name: 'id' }));
      if (!q) throw notFound('Вопрос не найден');
      return questionOut(q);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/questions',
    auth: 'author',
    handler: ({ body, user }) => tx(() => ({ id: insertQuestion(normalizeQuestion(body), user.id) })),
  },
  {
    method: 'PUT',
    path: '/api/admin/questions/:id',
    auth: 'author',
    handler: ({ params, body }) => {
      const id = int(params.id, { name: 'id' });
      if (!sql('SELECT id FROM questions WHERE id = ?').get(id)) throw notFound('Вопрос не найден');
      tx(() => updateQuestion(id, normalizeQuestion(body)));
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    path: '/api/admin/questions/:id',
    auth: 'author',
    handler: ({ params }) => {
      const id = int(params.id, { name: 'id' });
      const used = sql('SELECT COUNT(*) AS c FROM test_items WHERE question_id = ?').get(id).c;
      if (used) {
        sql(`UPDATE questions SET status = 'archived', updated_at = ? WHERE id = ?`).run(now(), id);
        return { archived: true };
      }
      sql('DELETE FROM questions WHERE id = ?').run(id);
      return { deleted: true };
    },
  },
  {
    method: 'POST',
    path: '/api/admin/questions/bulk',
    auth: 'author',
    handler: ({ body }) => {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 1000);
      if (!ids.length) throw bad('Не выбраны вопросы');
      const action = body.action;
      const ph = ids.map(() => '?').join(',');
      const t = now();
      if (['published', 'draft', 'archived'].includes(action)) {
        sql(`UPDATE questions SET status = ?, updated_at = ? WHERE id IN (${ph})`).run(action, t, ...ids);
      } else if (action === 'free' || action === 'unfree') {
        sql(`UPDATE questions SET is_free = ?, updated_at = ? WHERE id IN (${ph})`).run(action === 'free' ? 1 : 0, t, ...ids);
      } else throw bad('Неизвестное действие');
      return { ok: true, count: ids.length };
    },
  },
  {
    method: 'POST',
    path: '/api/admin/import',
    auth: 'author',
    limit: 25 * 1024 * 1024,
    handler: ({ body, user }) => {
      const format = body.format === 'csv' ? 'csv' : 'json';
      const raw = String(body.data || '');
      if (!raw.trim()) throw bad('Файл пустой');
      let rows;
      if (format === 'csv') rows = parseCsv(raw).map(csvRowToQuestion);
      else {
        try {
          const parsed = JSON.parse(raw);
          rows = Array.isArray(parsed) ? parsed : parsed.questions;
        } catch {
          throw bad('Не удалось прочитать JSON');
        }
        if (!Array.isArray(rows)) throw bad('JSON должен быть массивом вопросов');
      }
      if (rows.length > 20000) throw bad('За один раз можно загрузить до 20 000 вопросов');
      const status = ['draft', 'published'].includes(body.status) ? body.status : null;
      const errors = [];
      let imported = 0;
      tx(() => {
        rows.forEach((r, i) => {
          try {
            const q = normalizeQuestion({ ...r, ...(status ? { status } : {}) });
            insertQuestion(q, user.id);
            imported += 1;
          } catch (e) {
            errors.push({ row: i + 1, message: e.message });
          }
        });
      });
      return { imported, errors: errors.slice(0, 200), errorCount: errors.length };
    },
  },
  {
    method: 'GET',
    path: '/api/admin/export',
    auth: 'author',
    handler: ({ res }) => {
      const body = JSON.stringify(exportQuestions(), null, 2);
      const date = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="questions-${date}.json"`,
        'Cache-Control': 'no-store',
      });
      res.end(body);
    },
  },
  {
    method: 'POST',
    path: '/api/admin/upload',
    auth: 'author',
    raw: true,
    handler: async ({ req }) => {
      const buf = await readBody(req, 8 * 1024 * 1024);
      const type = IMAGE_TYPES.find((t) => t.test(buf));
      if (!type) throw bad('Поддерживаются PNG, JPEG, GIF и WebP до 8 МБ');
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${type.ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
      return { url: `/uploads/${name}` };
    },
  },

  ...taxonomyRoutes('subjects'),
  ...taxonomyRoutes('systems'),

  /* ---------- users (admin only) ---------- */
  {
    method: 'GET',
    path: '/api/admin/users',
    auth: 'admin',
    handler: ({ query }) => {
      const qtext = (query.get('q') || '').trim().replace(/[%_]/g, '').toLowerCase();
      const page = Math.max(1, Number(query.get('page')) || 1);
      const filter = query.get('filter');
      const conds = ['1=1'];
      const p = [];
      if (qtext) { conds.push('(ulower(u.email) LIKE ? OR ulower(u.name) LIKE ?)'); p.push(`%${qtext}%`, `%${qtext}%`); }
      if (filter === 'subscribers') { conds.push('u.access_until > ?'); p.push(now()); }
      if (filter === 'staff') conds.push(`u.role IN ('admin','author')`);
      const where = conds.join(' AND ');
      const total = sql(`SELECT COUNT(*) AS c FROM users u WHERE ${where}`).get(...p).c;
      const items = sql(`
        SELECT u.id, u.email, u.name, u.role, u.access_until, u.blocked, u.created_at, u.last_login_at,
          (SELECT COUNT(*) FROM tests t WHERE t.user_id = u.id) AS tests,
          (SELECT COUNT(*) FROM user_question uq WHERE uq.user_id = u.id AND uq.last_status IS NOT NULL) AS answered
        FROM users u WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`).all(...p, PAGE, (page - 1) * PAGE);
      return { total, page, pages: Math.max(1, Math.ceil(total / PAGE)), items };
    },
  },
  {
    method: 'PUT',
    path: '/api/admin/users/:id',
    auth: 'admin',
    handler: ({ params, body, user }) => {
      const id = int(params.id, { name: 'id' });
      const u = sql('SELECT * FROM users WHERE id = ?').get(id);
      if (!u) throw notFound('Пользователь не найден');
      if (body.role !== undefined) {
        if (!['student', 'author', 'admin'].includes(body.role)) throw bad('Некорректная роль');
        if (id === user.id && body.role !== 'admin') throw forbidden('Нельзя снять права администратора с самого себя');
        sql('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
      }
      if (body.blocked !== undefined) {
        if (id === user.id) throw forbidden('Нельзя заблокировать самого себя');
        sql('UPDATE users SET blocked = ? WHERE id = ?').run(body.blocked ? 1 : 0, id);
        if (body.blocked) sql('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      if (body.extendDays !== undefined) {
        const days = int(body.extendDays, { name: 'Дни', min: -3650, max: 3650 });
        const base = u.access_until && u.access_until > now() ? new Date(u.access_until) : new Date();
        const until = new Date(base.getTime() + days * 86400_000).toISOString();
        sql('UPDATE users SET access_until = ? WHERE id = ?').run(until, id);
      }
      if (body.accessUntil !== undefined) {
        const v = body.accessUntil ? new Date(body.accessUntil) : null;
        if (v && Number.isNaN(v.getTime())) throw bad('Некорректная дата');
        sql('UPDATE users SET access_until = ? WHERE id = ?').run(v ? v.toISOString() : null, id);
      }
      if (body.newPassword) {
        const np = String(body.newPassword);
        if (np.length < 8) throw bad('Пароль должен быть не короче 8 символов');
        sql('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), id);
        sql('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      return { ok: true };
    },
  },

  /* ---------- orders ---------- */
  {
    method: 'GET',
    path: '/api/admin/orders',
    auth: 'admin',
    handler: ({ query }) => {
      const status = query.get('status');
      const rows = sql(`
        SELECT o.*, u.email, u.name AS user_name, u.access_until FROM orders o JOIN users u ON u.id = o.user_id
        ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.id DESC LIMIT 300`).all(...(status ? [status] : []));
      return rows;
    },
  },
  {
    method: 'POST',
    path: '/api/admin/orders/:id/decide',
    auth: 'admin',
    handler: ({ params, body }) => {
      const id = int(params.id, { name: 'id' });
      const o = sql('SELECT * FROM orders WHERE id = ?').get(id);
      if (!o) throw notFound('Заявка не найдена');
      if (o.status !== 'pending') throw bad('Заявка уже обработана');
      const comment = str(body.comment, { name: 'Комментарий', max: 500 });
      tx(() => {
        if (body.approve) {
          const u = sql('SELECT access_until FROM users WHERE id = ?').get(o.user_id);
          const base = u.access_until && u.access_until > now() ? new Date(u.access_until) : new Date();
          const until = new Date(base.getTime() + o.days * 86400_000).toISOString();
          sql('UPDATE users SET access_until = ? WHERE id = ?').run(until, o.user_id);
        }
        sql('UPDATE orders SET status = ?, admin_comment = ?, decided_at = ? WHERE id = ?')
          .run(body.approve ? 'paid' : 'rejected', comment, now(), id);
      });
      return { ok: true };
    },
  },

  /* ---------- plans & settings ---------- */
  {
    method: 'GET',
    path: '/api/admin/plans',
    auth: 'admin',
    handler: () => sql('SELECT * FROM plans ORDER BY sort, id').all(),
  },
  {
    method: 'POST',
    path: '/api/admin/plans',
    auth: 'admin',
    handler: ({ body }) => {
      const p = planInput(body);
      const info = sql('INSERT INTO plans(name, days, price, currency, description, active, sort) VALUES (?,?,?,?,?,?,?)')
        .run(p.name, p.days, p.price, p.currency, p.description, p.active, p.sort);
      return { id: Number(info.lastInsertRowid) };
    },
  },
  {
    method: 'PUT',
    path: '/api/admin/plans/:id',
    auth: 'admin',
    handler: ({ params, body }) => {
      const p = planInput(body);
      const r = sql('UPDATE plans SET name = ?, days = ?, price = ?, currency = ?, description = ?, active = ?, sort = ? WHERE id = ?')
        .run(p.name, p.days, p.price, p.currency, p.description, p.active, p.sort, int(params.id, { name: 'id' }));
      if (!r.changes) throw notFound('Тариф не найден');
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/admin/settings',
    auth: 'admin',
    handler: () => Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, getSetting(k, DEFAULT_SETTINGS[k])])),
  },
  {
    method: 'PUT',
    path: '/api/admin/settings',
    auth: 'admin',
    handler: ({ body }) => {
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (body[k] !== undefined) setSetting(k, str(body[k], { name: k, max: 5000 }));
      }
      return { ok: true };
    },
  },
];

function planInput(body) {
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0 || price > 1e7) throw bad('Некорректная цена');
  return {
    name: str(body.name, { name: 'Название', required: true, max: 80 }),
    days: int(body.days, { name: 'Дни', min: 1, max: 3650 }),
    price,
    currency: str(body.currency, { name: 'Валюта', required: true, max: 8 }).toUpperCase(),
    description: str(body.description, { name: 'Описание', max: 300 }),
    active: body.active === false ? 0 : 1,
    sort: int(body.sort, { name: 'Порядок', min: 0, max: 1000, fallback: 0 }),
  };
}
