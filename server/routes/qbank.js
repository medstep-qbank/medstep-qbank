import { sql, tx, now } from '../db.js';
import { hasFullAccess } from '../auth.js';
import { bad, notFound, int, str, intList, HttpError } from '../http.js';

export const STEPS = { step1: 'Step 1', step2: 'Step 2 CK', step3: 'Step 3' };
const FILTERS = {
  unused: '(uq.question_id IS NULL OR uq.last_status IS NULL)',
  incorrect: `uq.last_status = 'incorrect'`,
  correct: `uq.last_status = 'correct'`,
  omitted: `uq.last_status = 'omitted'`,
  marked: 'uq.marked = 1',
};
const SECONDS_PER_QUESTION = 90;
const MAX_QUESTIONS = 40;

function checkStep(step) {
  if (!STEPS[step]) throw bad('Выберите Step');
  return step;
}

function parseFilters(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  for (const f of list) if (!FILTERS[f]) throw bad('Неизвестный фильтр');
  return [...new Set(list)];
}

/** Builds the shared FROM/WHERE for question selection. */
function scope(user, step, { filters = [], subjects = [], systems = [] } = {}) {
  let where = `FROM questions q
    LEFT JOIN user_question uq ON uq.question_id = q.id AND uq.user_id = ?
    WHERE q.status = 'published' AND q.step = ?`;
  const params = [user.id, step];
  if (!hasFullAccess(user)) where += ' AND q.is_free = 1';
  if (filters.length) where += ` AND (${filters.map((f) => FILTERS[f]).join(' OR ')})`;
  if (subjects.length) {
    where += ` AND q.subject_id IN (${subjects.map(() => '?').join(',')})`;
    params.push(...subjects);
  }
  if (systems.length) {
    where += ` AND q.system_id IN (${systems.map(() => '?').join(',')})`;
    params.push(...systems);
  }
  return { where, params };
}

function loadTest(user, id) {
  const t = sql('SELECT * FROM tests WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!t) throw notFound('Тест не найден');
  return t;
}

function getItem(testId, position) {
  const it = sql('SELECT * FROM test_items WHERE test_id = ? AND position = ?').get(testId, position);
  if (!it) throw notFound('Вопрос не найден в тесте');
  return it;
}

export function recordStatus(userId, questionId, status, marked) {
  sql(`INSERT INTO user_question(user_id, question_id, last_status, marked, attempts, updated_at)
       VALUES (?,?,?,?,1,?)
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         last_status = excluded.last_status, marked = excluded.marked,
         attempts = attempts + 1, updated_at = excluded.updated_at`)
    .run(userId, questionId, status, marked ? 1 : 0, now());
}

function setMarked(userId, questionId, marked) {
  sql(`INSERT INTO user_question(user_id, question_id, last_status, marked, attempts, updated_at)
       VALUES (?,?,NULL,?,0,?)
       ON CONFLICT(user_id, question_id) DO UPDATE SET marked = excluded.marked, updated_at = excluded.updated_at`)
    .run(userId, questionId, marked ? 1 : 0, now());
}

function peerStats(questionIds) {
  const map = new Map();
  if (!questionIds.length) return map;
  const rows = sql(`
    SELECT question_id, selected_index, COUNT(*) AS c FROM test_items
    WHERE question_id IN (${questionIds.map(() => '?').join(',')})
      AND answered_at IS NOT NULL AND selected_index IS NOT NULL
    GROUP BY question_id, selected_index`).all(...questionIds);
  for (const r of rows) {
    if (!map.has(r.question_id)) map.set(r.question_id, { total: 0, byOption: {} });
    const m = map.get(r.question_id);
    m.total += r.c;
    m.byOption[r.selected_index] = r.c;
  }
  return map;
}

const parseJson = (s, fb) => {
  try {
    return s ? JSON.parse(s) : fb;
  } catch {
    return fb;
  }
};

function isRevealed(test, item) {
  return test.status === 'completed' || (test.mode === 'tutor' && item.answered_at != null);
}

/** Serialises test items, hiding answers and explanations until they may be shown. */
function serializeItems(user, test, positions = null) {
  let rows = sql(`
    SELECT ti.*, q.stem, q.lead_in, q.options, q.correct_index, q.explanation, q.objective,
           q.image, q.explanation_image, q.topic, q.difficulty,
           s.name AS subject, y.name AS system
    FROM test_items ti
    JOIN questions q ON q.id = ti.question_id
    LEFT JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN systems y ON y.id = q.system_id
    WHERE ti.test_id = ? ORDER BY ti.position`).all(test.id);
  if (positions) rows = rows.filter((r) => positions.includes(r.position));

  const revealedIds = rows.filter((r) => isRevealed(test, r)).map((r) => r.question_id);
  const peers = peerStats(revealedIds);
  const notes = new Map(
    revealedIds.length
      ? sql(`SELECT question_id, body FROM notes WHERE user_id = ? AND question_id IN (${revealedIds.map(() => '?').join(',')})`)
          .all(user.id, ...revealedIds).map((n) => [n.question_id, n.body])
      : [],
  );
  const cards = new Set(
    revealedIds.length
      ? sql(`SELECT DISTINCT question_id FROM flashcards WHERE user_id = ? AND question_id IN (${revealedIds.map(() => '?').join(',')})`)
          .all(user.id, ...revealedIds).map((r) => r.question_id)
      : [],
  );

  return rows.map((r) => {
    const base = {
      position: r.position,
      questionId: r.question_id,
      stem: r.stem,
      leadIn: r.lead_in,
      options: parseJson(r.options, []),
      image: r.image,
      selected: r.selected_index,
      marked: Boolean(r.marked),
      timeSpent: r.time_spent_sec,
      submitted: r.answered_at != null,
      highlights: parseJson(r.highlights, []),
      strikes: parseJson(r.strikes, []),
      revealed: false,
    };
    if (!isRevealed(test, r)) return base;
    const p = peers.get(r.question_id) || { total: 0, byOption: {} };
    return {
      ...base,
      revealed: true,
      correct: r.correct_index,
      isCorrect: r.selected_index == null ? null : r.selected_index === r.correct_index,
      explanation: r.explanation,
      objective: r.objective,
      explanationImage: r.explanation_image,
      subject: r.subject,
      system: r.system,
      topic: r.topic,
      difficulty: r.difficulty,
      peers: p,
      note: notes.get(r.question_id) || '',
      hasFlashcard: cards.has(r.question_id),
    };
  });
}

function serializeTest(t) {
  return {
    id: t.id,
    name: t.name,
    mode: t.mode,
    step: t.step,
    stepLabel: STEPS[t.step],
    status: t.status,
    questionCount: t.question_count,
    timeLimit: t.time_limit_sec,
    timeUsed: t.time_used_sec,
    currentIndex: t.current_index,
    settings: parseJson(t.settings, {}),
    scoreCorrect: t.score_correct,
    createdAt: t.created_at,
    completedAt: t.completed_at,
  };
}

export default [
  {
    method: 'GET',
    path: '/api/qbank/catalog',
    auth: 'user',
    handler: ({ user, query }) => {
      const step = checkStep(query.get('step') || 'step1');
      const filters = parseFilters(query.get('filters'));
      const subjects = intList(query.get('subjects'));
      const systems = intList(query.get('systems'));

      const all = scope(user, step);
      const statusCounts = {};
      for (const [k, cond] of Object.entries(FILTERS)) {
        statusCounts[k] = sql(`SELECT COUNT(*) AS c ${all.where} AND ${cond}`).get(...all.params).c;
      }
      const total = sql(`SELECT COUNT(*) AS c ${all.where}`).get(...all.params).c;

      const subjList = sql(`SELECT DISTINCT s.id, s.name, s.sort ${all.where.replace('FROM questions q', 'FROM questions q JOIN subjects s ON s.id = q.subject_id')} ORDER BY s.sort, s.name`).all(...all.params);
      const sysList = sql(`SELECT DISTINCT y.id, y.name, y.sort ${all.where.replace('FROM questions q', 'FROM questions q JOIN systems y ON y.id = q.system_id')} ORDER BY y.sort, y.name`).all(...all.params);

      const bySubj = scope(user, step, { filters, systems });
      const subjCounts = new Map(sql(`SELECT q.subject_id AS id, COUNT(*) AS c ${bySubj.where} GROUP BY q.subject_id`).all(...bySubj.params).map((r) => [r.id, r.c]));
      const bySys = scope(user, step, { filters, subjects });
      const sysCounts = new Map(sql(`SELECT q.system_id AS id, COUNT(*) AS c ${bySys.where} GROUP BY q.system_id`).all(...bySys.params).map((r) => [r.id, r.c]));

      const sel = scope(user, step, { filters, subjects, systems });
      const available = sql(`SELECT COUNT(*) AS c ${sel.where}`).get(...sel.params).c;

      return {
        step,
        steps: STEPS,
        total,
        available,
        maxQuestions: MAX_QUESTIONS,
        statusCounts,
        fullAccess: hasFullAccess(user),
        subjects: subjList.map((s) => ({ id: s.id, name: s.name, count: subjCounts.get(s.id) || 0 })),
        systems: sysList.map((s) => ({ id: s.id, name: s.name, count: sysCounts.get(s.id) || 0 })),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/tests',
    auth: 'user',
    handler: ({ user, body }) => {
      const step = checkStep(body.step);
      const mode = body.mode === 'timed' ? 'timed' : 'tutor';
      const filters = parseFilters(body.filters);
      const subjects = intList(body.subjects);
      const systems = intList(body.systems);
      const count = int(body.count, { name: 'Количество вопросов', min: 1, max: MAX_QUESTIONS });

      const sel = scope(user, step, { filters, subjects, systems });
      const ids = sql(`SELECT q.id ${sel.where} ORDER BY random() LIMIT ?`).all(...sel.params, count).map((r) => r.id);
      if (!ids.length) throw bad('По выбранным фильтрам нет вопросов. Измените предметы, системы или статус вопросов.');

      const subjNames = subjects.length
        ? sql(`SELECT name FROM subjects WHERE id IN (${subjects.map(() => '?').join(',')})`).all(...subjects).map((r) => r.name)
        : [];
      const sysNames = systems.length
        ? sql(`SELECT name FROM systems WHERE id IN (${systems.map(() => '?').join(',')})`).all(...systems).map((r) => r.name)
        : [];
      const n = sql('SELECT COUNT(*) AS c FROM tests WHERE user_id = ?').get(user.id).c + 1;
      const t = now();

      const testId = tx(() => {
        const info = sql(`INSERT INTO tests(user_id, name, mode, step, question_count, time_limit_sec, settings, created_at, updated_at)
                          VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(user.id, `Тест ${n}`, mode, step, ids.length,
            mode === 'timed' ? ids.length * SECONDS_PER_QUESTION : null,
            JSON.stringify({ filters, subjects: subjNames, systems: sysNames }), t, t);
        const id = Number(info.lastInsertRowid);
        const ins = sql('INSERT INTO test_items(test_id, position, question_id) VALUES (?,?,?)');
        ids.forEach((qid, i) => ins.run(id, i, qid));
        return id;
      });
      return { id: testId };
    },
  },
  {
    method: 'GET',
    path: '/api/tests',
    auth: 'user',
    handler: ({ user }) => {
      const rows = sql(`
        SELECT t.*,
          (SELECT COUNT(*) FROM test_items ti WHERE ti.test_id = t.id AND ti.selected_index IS NOT NULL) AS answered
        FROM tests t WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 500`).all(user.id);
      return rows.map((r) => ({ ...serializeTest(r), answered: r.answered }));
    },
  },
  {
    method: 'GET',
    path: '/api/tests/:id',
    auth: 'user',
    handler: ({ user, params }) => {
      const t = loadTest(user, int(params.id, { name: 'id' }));
      return { test: serializeTest(t), items: serializeItems(user, t) };
    },
  },
  {
    method: 'PUT',
    path: '/api/tests/:id',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const t = loadTest(user, int(params.id, { name: 'id' }));
      const name = str(body.name, { name: 'Название', required: true, max: 80 });
      sql('UPDATE tests SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), t.id);
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/api/tests/:id/answer',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const t = loadTest(user, int(params.id, { name: 'id' }));
      if (t.status === 'completed') throw new HttpError(409, 'Тест уже завершён');
      const position = int(body.position, { name: 'Позиция', min: 0 });
      const item = getItem(t.id, position);
      const q = sql('SELECT options, correct_index FROM questions WHERE id = ?').get(item.question_id);
      const optionCount = parseJson(q.options, []).length;
      const selected = body.selected === null ? null : int(body.selected, { name: 'Ответ', min: 0, max: optionCount - 1 });
      const timeSpent = int(body.timeSpent, { name: 'Время', min: 0, max: 86400, fallback: item.time_spent_sec });

      if (t.mode === 'tutor') {
        if (item.answered_at) throw new HttpError(409, 'Ответ на этот вопрос уже принят');
        if (selected === null) throw bad('Выберите вариант ответа');
        const ok = selected === q.correct_index;
        tx(() => {
          sql('UPDATE test_items SET selected_index = ?, is_correct = ?, answered_at = ?, time_spent_sec = ? WHERE id = ?')
            .run(selected, ok ? 1 : 0, now(), timeSpent, item.id);
          recordStatus(user.id, item.question_id, ok ? 'correct' : 'incorrect', item.marked);
          sql(`UPDATE tests SET status = 'active', current_index = ?, updated_at = ? WHERE id = ?`).run(position, now(), t.id);
        });
        const fresh = sql('SELECT * FROM tests WHERE id = ?').get(t.id);
        return { item: serializeItems(user, fresh, [position])[0] };
      }

      sql('UPDATE test_items SET selected_index = ?, time_spent_sec = ? WHERE id = ?').run(selected, timeSpent, item.id);
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/api/tests/:id/items/:pos',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const t = loadTest(user, int(params.id, { name: 'id' }));
      const item = getItem(t.id, int(params.pos, { name: 'Позиция', min: 0 }));
      if (body.marked !== undefined) {
        const m = body.marked ? 1 : 0;
        sql('UPDATE test_items SET marked = ? WHERE id = ?').run(m, item.id);
        setMarked(user.id, item.question_id, m);
      }
      if (body.highlights !== undefined) {
        if (!Array.isArray(body.highlights) || body.highlights.length > 300) throw bad('Некорректные выделения');
        const hl = body.highlights
          .filter((r) => Array.isArray(r) && r.length === 2)
          .map(([a, b]) => [Math.max(0, Math.floor(a)), Math.max(0, Math.floor(b))])
          .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a && b < 1e6);
        sql('UPDATE test_items SET highlights = ? WHERE id = ?').run(JSON.stringify(hl), item.id);
      }
      if (body.strikes !== undefined) {
        if (!Array.isArray(body.strikes)) throw bad('Некорректные зачёркивания');
        const st = [...new Set(body.strikes.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 26))];
        sql('UPDATE test_items SET strikes = ? WHERE id = ?').run(JSON.stringify(st), item.id);
      }
      if (body.timeSpent !== undefined && t.status !== 'completed') {
        const ts = int(body.timeSpent, { name: 'Время', min: 0, max: 86400 });
        sql('UPDATE test_items SET time_spent_sec = ? WHERE id = ?').run(Math.max(ts, item.time_spent_sec), item.id);
      }
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/api/tests/:id/state',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const t = loadTest(user, int(params.id, { name: 'id' }));
      const idx = int(body.currentIndex, { name: 'Позиция', min: 0, max: t.question_count - 1, fallback: t.current_index });
      if (t.status === 'completed') {
        sql('UPDATE tests SET current_index = ? WHERE id = ?').run(idx, t.id);
        return { ok: true };
      }
      let used = int(body.timeUsed, { name: 'Время', min: 0, max: 7 * 86400, fallback: t.time_used_sec });
      used = Math.max(used, t.time_used_sec);
      if (t.time_limit_sec) used = Math.min(used, t.time_limit_sec);
      const status = body.suspend ? 'suspended' : 'active';
      sql('UPDATE tests SET current_index = ?, time_used_sec = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(idx, used, status, now(), t.id);
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/api/tests/:id/finish',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const t = loadTest(user, int(params.id, { name: 'id' }));
      if (t.status === 'completed') return { ok: true };
      let used = int(body.timeUsed, { name: 'Время', min: 0, max: 7 * 86400, fallback: t.time_used_sec });
      used = Math.max(used, t.time_used_sec);
      if (t.time_limit_sec) used = Math.min(used, t.time_limit_sec);
      tx(() => {
        const items = sql(`SELECT ti.*, q.correct_index FROM test_items ti JOIN questions q ON q.id = ti.question_id
                           WHERE ti.test_id = ? AND ti.answered_at IS NULL`).all(t.id);
        const stamp = now();
        for (const it of items) {
          if (it.selected_index == null) {
            sql('UPDATE test_items SET is_correct = NULL WHERE id = ?').run(it.id);
            recordStatus(user.id, it.question_id, 'omitted', it.marked);
          } else {
            const ok = it.selected_index === it.correct_index;
            sql('UPDATE test_items SET is_correct = ?, answered_at = ? WHERE id = ?').run(ok ? 1 : 0, stamp, it.id);
            recordStatus(user.id, it.question_id, ok ? 'correct' : 'incorrect', it.marked);
          }
        }
        const score = sql('SELECT COUNT(*) AS c FROM test_items WHERE test_id = ? AND is_correct = 1').get(t.id).c;
        sql(`UPDATE tests SET status = 'completed', score_correct = ?, completed_at = ?, updated_at = ?, time_used_sec = ?, current_index = 0
             WHERE id = ?`).run(score, stamp, stamp, used, t.id);
      });
      return { ok: true };
    },
  },
];
