import { sql, tx, now } from '../db.js';
import { hasFullAccess } from '../auth.js';
import { bad, notFound, int, str } from '../http.js';
import { STEPS } from './qbank.js';

const DAY = 86400_000;

function breakdown(userId, column, table, step) {
  return sql(`
    SELECT g.id, g.name,
      COUNT(uq.question_id) AS used,
      SUM(CASE WHEN uq.last_status = 'correct' THEN 1 ELSE 0 END) AS correct,
      SUM(CASE WHEN uq.last_status = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
      SUM(CASE WHEN uq.last_status = 'omitted' THEN 1 ELSE 0 END) AS omitted
    FROM user_question uq
    JOIN questions q ON q.id = uq.question_id
    JOIN ${table} g ON g.id = q.${column}
    WHERE uq.user_id = ? AND uq.last_status IS NOT NULL ${step ? 'AND q.step = ?' : ''}
    GROUP BY g.id ORDER BY g.sort, g.name`).all(...(step ? [userId, step] : [userId]));
}

export default [
  {
    method: 'GET',
    path: '/api/stats',
    auth: 'user',
    handler: ({ user, query }) => {
      const step = STEPS[query.get('step')] ? query.get('step') : null;
      const stepCond = step ? 'AND q.step = ?' : '';
      const sp = step ? [step] : [];
      const accessCond = hasFullAccess(user) ? '' : 'AND q.is_free = 1';

      const totalQuestions = sql(`SELECT COUNT(*) AS c FROM questions q WHERE q.status = 'published' ${accessCond} ${stepCond}`).get(...sp).c;
      const s = sql(`
        SELECT
          SUM(CASE WHEN uq.last_status = 'correct' THEN 1 ELSE 0 END) AS correct,
          SUM(CASE WHEN uq.last_status = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
          SUM(CASE WHEN uq.last_status = 'omitted' THEN 1 ELSE 0 END) AS omitted,
          SUM(CASE WHEN uq.marked = 1 THEN 1 ELSE 0 END) AS marked
        FROM user_question uq JOIN questions q ON q.id = uq.question_id
        WHERE uq.user_id = ? ${stepCond}`).get(user.id, ...sp);
      const correct = s.correct || 0;
      const incorrect = s.incorrect || 0;
      const omitted = s.omitted || 0;
      const used = correct + incorrect + omitted;

      const testRows = sql(`
        SELECT t.id, t.name, t.mode, t.step, t.question_count, t.score_correct, t.completed_at, t.time_used_sec
        FROM tests t WHERE t.user_id = ? AND t.status = 'completed' ${step ? 'AND t.step = ?' : ''}
        ORDER BY t.completed_at`).all(user.id, ...sp);

      const avgTime = sql(`
        SELECT AVG(ti.time_spent_sec) AS a FROM test_items ti JOIN tests t ON t.id = ti.test_id
        WHERE t.user_id = ? AND ti.answered_at IS NOT NULL AND ti.time_spent_sec > 0 ${step ? 'AND t.step = ?' : ''}`).get(user.id, ...sp).a;

      // Change of answer analysis is impossible without history; instead give peer average.
      const peer = sql(`
        SELECT AVG(ti.is_correct) AS a FROM test_items ti WHERE ti.answered_at IS NOT NULL AND ti.is_correct IS NOT NULL`).get().a;

      return {
        step,
        totalQuestions,
        used,
        unused: Math.max(0, totalQuestions - used),
        correct,
        incorrect,
        omitted,
        marked: s.marked || 0,
        percentCorrect: used ? Math.round((correct / used) * 1000) / 10 : null,
        peerAverage: peer == null ? null : Math.round(peer * 1000) / 10,
        avgTimePerQuestion: avgTime == null ? null : Math.round(avgTime),
        testsCompleted: testRows.length,
        tests: testRows.map((t) => ({
          id: t.id,
          name: t.name,
          mode: t.mode,
          step: t.step,
          total: t.question_count,
          correct: t.score_correct,
          percent: t.question_count ? Math.round((t.score_correct / t.question_count) * 100) : 0,
          completedAt: t.completed_at,
        })),
        subjects: breakdown(user.id, 'subject_id', 'subjects', step),
        systems: breakdown(user.id, 'system_id', 'systems', step),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/progress/reset',
    auth: 'user',
    handler: ({ user, body }) => {
      if (body.confirm !== 'СБРОСИТЬ') throw bad('Для сброса введите слово СБРОСИТЬ');
      tx(() => {
        sql('DELETE FROM tests WHERE user_id = ?').run(user.id);
        sql('DELETE FROM user_question WHERE user_id = ?').run(user.id);
      });
      return { ok: true };
    },
  },

  /* ---------- notes ---------- */
  {
    method: 'GET',
    path: '/api/notes',
    auth: 'user',
    handler: ({ user }) =>
      sql(`SELECT n.id, n.question_id AS questionId, n.body, n.updated_at AS updatedAt,
                  substr(q.stem, 1, 160) AS stemExcerpt, q.lead_in AS leadIn, s.name AS subject, y.name AS system,
                  (SELECT ti.test_id || ':' || ti.position FROM test_items ti JOIN tests t ON t.id = ti.test_id
                    WHERE t.user_id = n.user_id AND ti.question_id = n.question_id
                      AND (t.status = 'completed' OR ti.answered_at IS NOT NULL)
                    ORDER BY ti.id DESC LIMIT 1) AS reviewRef
           FROM notes n
           LEFT JOIN questions q ON q.id = n.question_id
           LEFT JOIN subjects s ON s.id = q.subject_id
           LEFT JOIN systems y ON y.id = q.system_id
           WHERE n.user_id = ? ORDER BY n.updated_at DESC`).all(user.id),
  },
  {
    method: 'PUT',
    path: '/api/notes/question/:qid',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const qid = int(params.qid, { name: 'Вопрос', min: 1 });
      // A user may only annotate questions they have seen in a test.
      const seen = sql(`SELECT 1 FROM test_items ti JOIN tests t ON t.id = ti.test_id WHERE t.user_id = ? AND ti.question_id = ? LIMIT 1`).get(user.id, qid);
      if (!seen) throw notFound('Вопрос не найден');
      const text = str(body.body, { name: 'Заметка', max: 20000 });
      if (!text) {
        sql('DELETE FROM notes WHERE user_id = ? AND question_id = ?').run(user.id, qid);
        return { ok: true, deleted: true };
      }
      const t = now();
      sql(`INSERT INTO notes(user_id, question_id, body, created_at, updated_at) VALUES (?,?,?,?,?)
           ON CONFLICT(user_id, question_id) WHERE question_id IS NOT NULL DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`)
        .run(user.id, qid, text, t, t);
      return { ok: true };
    },
  },
  {
    method: 'DELETE',
    path: '/api/notes/:id',
    auth: 'user',
    handler: ({ user, params }) => {
      sql('DELETE FROM notes WHERE id = ? AND user_id = ?').run(int(params.id, { name: 'id' }), user.id);
      return { ok: true };
    },
  },

  /* ---------- flashcards (simplified SM-2) ---------- */
  {
    method: 'GET',
    path: '/api/flashcards',
    auth: 'user',
    handler: ({ user, query }) => {
      const due = query.get('due') === '1';
      const deck = query.get('deck');
      const conds = ['user_id = ?'];
      const p = [user.id];
      if (due) { conds.push('due_at <= ?'); p.push(now()); }
      if (deck) { conds.push('deck = ?'); p.push(deck); }
      const cards = sql(`SELECT id, question_id AS questionId, deck, front, back, due_at AS dueAt, interval_days AS intervalDays, reps, lapses
                         FROM flashcards WHERE ${conds.join(' AND ')} ORDER BY due_at LIMIT 1000`).all(...p);
      const decks = sql(`SELECT deck, COUNT(*) AS total, SUM(CASE WHEN due_at <= ? THEN 1 ELSE 0 END) AS due
                         FROM flashcards WHERE user_id = ? GROUP BY deck ORDER BY deck`).all(now(), user.id);
      return { cards, decks };
    },
  },
  {
    method: 'POST',
    path: '/api/flashcards',
    auth: 'user',
    handler: ({ user, body }) => {
      const count = sql('SELECT COUNT(*) AS c FROM flashcards WHERE user_id = ?').get(user.id).c;
      if (count >= 5000) throw bad('Достигнут лимит в 5000 карточек');
      const front = str(body.front, { name: 'Лицевая сторона', required: true, max: 4000 });
      const back = str(body.back, { name: 'Оборот', required: true, max: 8000 });
      const deck = str(body.deck, { name: 'Колода', max: 60 }) || 'Общая';
      let qid = null;
      if (body.questionId) {
        qid = int(body.questionId, { name: 'Вопрос', min: 1 });
        const seen = sql(`SELECT 1 FROM test_items ti JOIN tests t ON t.id = ti.test_id WHERE t.user_id = ? AND ti.question_id = ? LIMIT 1`).get(user.id, qid);
        if (!seen) qid = null;
      }
      const t = now();
      const info = sql(`INSERT INTO flashcards(user_id, question_id, deck, front, back, due_at, created_at, updated_at)
                        VALUES (?,?,?,?,?,?,?,?)`).run(user.id, qid, deck, front, back, t, t, t);
      return { id: Number(info.lastInsertRowid) };
    },
  },
  {
    method: 'PUT',
    path: '/api/flashcards/:id',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const id = int(params.id, { name: 'id' });
      const front = str(body.front, { name: 'Лицевая сторона', required: true, max: 4000 });
      const back = str(body.back, { name: 'Оборот', required: true, max: 8000 });
      const deck = str(body.deck, { name: 'Колода', max: 60 }) || 'Общая';
      const r = sql('UPDATE flashcards SET front = ?, back = ?, deck = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(front, back, deck, now(), id, user.id);
      if (!r.changes) throw notFound('Карточка не найдена');
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: '/api/flashcards/:id/review',
    auth: 'user',
    handler: ({ user, params, body }) => {
      const id = int(params.id, { name: 'id' });
      const grade = int(body.grade, { name: 'Оценка', min: 0, max: 3 });
      const c = sql('SELECT * FROM flashcards WHERE id = ? AND user_id = ?').get(id, user.id);
      if (!c) throw notFound('Карточка не найдена');
      let { ease, interval_days: interval, reps, lapses } = c;
      let dueMs;
      if (grade === 0) {
        lapses += 1;
        reps = 0;
        interval = 0;
        ease = Math.max(1.3, ease - 0.2);
        dueMs = 10 * 60_000; // again in 10 minutes
      } else {
        reps += 1;
        if (reps === 1) interval = grade === 3 ? 4 : 1;
        else if (reps === 2) interval = grade === 1 ? 3 : 6;
        else interval = interval * (grade === 1 ? 1.2 : grade === 2 ? ease : ease * 1.3);
        if (grade === 1) ease = Math.max(1.3, ease - 0.15);
        if (grade === 3) ease += 0.15;
        interval = Math.min(Math.round(interval * 10) / 10, 3650);
        dueMs = interval * DAY;
      }
      const due = new Date(Date.now() + dueMs).toISOString();
      sql('UPDATE flashcards SET ease = ?, interval_days = ?, reps = ?, lapses = ?, due_at = ?, updated_at = ? WHERE id = ?')
        .run(ease, interval, reps, lapses, due, now(), id);
      return { dueAt: due, intervalDays: interval };
    },
  },
  {
    method: 'DELETE',
    path: '/api/flashcards/:id',
    auth: 'user',
    handler: ({ user, params }) => {
      sql('DELETE FROM flashcards WHERE id = ? AND user_id = ?').run(int(params.id, { name: 'id' }), user.id);
      return { ok: true };
    },
  },
];
