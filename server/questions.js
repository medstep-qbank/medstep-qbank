import { sql, now } from './db.js';
import { bad } from './http.js';
import { STEPS } from './routes/qbank.js';

const LETTERS = 'ABCDEFGHIJ';

function normStep(v) {
  const s = String(v ?? '').toLowerCase().replace(/\s+/g, '');
  if (STEPS[s]) return s;
  if (s === '1' || s === 'step1') return 'step1';
  if (s === '2' || s === '2ck' || s === 'step2ck' || s === 'step2') return 'step2';
  if (s === '3' || s === 'step3') return 'step3';
  throw bad('Некорректный Step (ожидается step1, step2 или step3)');
}

function findOrCreate(table, name) {
  const n = String(name || '').trim();
  if (!n) return null;
  if (n.length > 80) throw bad(`Слишком длинное название: ${n.slice(0, 30)}…`);
  const row = sql(`SELECT id FROM ${table} WHERE name = ?`).get(n);
  if (row) return row.id;
  const max = sql(`SELECT COALESCE(MAX(sort), 0) AS m FROM ${table}`).get().m;
  return Number(sql(`INSERT INTO ${table}(name, sort) VALUES (?, ?)`).run(n, max + 1).lastInsertRowid);
}

function checkRef(table, id) {
  if (id === null || id === undefined || id === '') return null;
  const n = Number(id);
  if (!Number.isInteger(n) || !sql(`SELECT id FROM ${table} WHERE id = ?`).get(n)) {
    throw bad(table === 'subjects' ? 'Предмет не найден' : 'Система не найдена');
  }
  return n;
}

function text(v, name, max, required = false) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw bad(`Поле «${name}» обязательно`);
  if (s.length > max) throw bad(`Поле «${name}» длиннее ${max} символов`);
  return s;
}

function imagePath(v) {
  const s = text(v, 'Изображение', 500);
  if (!s) return null;
  if (s.startsWith('/uploads/') && /^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]+$/.test(s)) return s;
  throw bad('Изображение: укажите загруженный файл (/uploads/…) или https-ссылку');
}

/**
 * Validates question input. Accepts ids (subjectId/systemId) from the editor,
 * or names (subject/system) from imports — names are created when missing.
 */
export function normalizeQuestion(input) {
  const options = (Array.isArray(input.options) ? input.options : [])
    .map((o) => (typeof o === 'object' && o !== null ? o.text : o))
    .map((o) => text(o, 'Вариант ответа', 3000))
    .filter((o) => o !== '');
  if (options.length < 2) throw bad('Нужно минимум 2 варианта ответа');
  if (options.length > 10) throw bad('Максимум 10 вариантов ответа');

  let correct = input.correct ?? input.correctIndex ?? input.correct_index;
  if (typeof correct === 'string' && /^[A-Ja-j]$/.test(correct.trim())) correct = LETTERS.indexOf(correct.trim().toUpperCase());
  correct = Number(correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw bad('Укажите правильный ответ');

  const status = ['draft', 'published', 'archived'].includes(input.status) ? input.status : 'draft';
  const difficulty = [1, 2, 3].includes(Number(input.difficulty)) ? Number(input.difficulty) : 2;
  const free = input.isFree ?? input.is_free;

  const core = {
    step: normStep(input.step),
    topic: text(input.topic, 'Тема', 200),
    stem: text(input.stem, 'Условие', 20000, true),
    lead_in: text(input.leadIn ?? input.lead_in ?? input.question, 'Вопрос', 2000, true),
    options: JSON.stringify(options),
    correct_index: correct,
    explanation: text(input.explanation, 'Объяснение', 60000),
    objective: text(input.objective, 'Цель обучения', 3000),
    image: imagePath(input.image),
    explanation_image: imagePath(input.explanationImage ?? input.explanation_image),
    difficulty,
    status,
    is_free: free === true || free === 1 || free === '1' || String(free).toLowerCase() === 'true' || String(free).toLowerCase() === 'да' ? 1 : 0,
  };
  // Resolve references last, so a row that fails validation never creates a subject/system.
  core.subject_id = input.subjectId !== undefined ? checkRef('subjects', input.subjectId) : findOrCreate('subjects', input.subject);
  core.system_id = input.systemId !== undefined ? checkRef('systems', input.systemId) : findOrCreate('systems', input.system);
  return core;
}

const COLS = ['step', 'subject_id', 'system_id', 'topic', 'stem', 'lead_in', 'options', 'correct_index', 'explanation',
  'objective', 'image', 'explanation_image', 'difficulty', 'status', 'is_free'];

export function insertQuestion(q, authorId) {
  const t = now();
  const info = sql(`INSERT INTO questions(${COLS.join(',')}, author_id, created_at, updated_at)
                    VALUES (${COLS.map(() => '?').join(',')}, ?, ?, ?)`)
    .run(...COLS.map((c) => q[c]), authorId ?? null, t, t);
  return Number(info.lastInsertRowid);
}

export function updateQuestion(id, q) {
  sql(`UPDATE questions SET ${COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...COLS.map((c) => q[c]), now(), id);
}

/** Minimal RFC 4180 CSV parser (handles quotes, escaped quotes and newlines in fields). */
export function parseCsv(input) {
  const s = input.replace(/^﻿/, '');
  const delim = (() => {
    const first = s.split(/\r?\n/, 1)[0] || '';
    const semi = (first.match(/;/g) || []).length;
    const comma = (first.match(/,/g) || []).length;
    return semi > comma ? ';' : ',';
  })();
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Converts a CSV row (option_a … option_j columns) into the import shape. */
export function csvRowToQuestion(r) {
  const options = [];
  for (const l of 'abcdefghij') {
    const v = r[`option_${l}`];
    if (v !== undefined && String(v).trim() !== '') options.push(v);
  }
  return {
    step: r.step,
    subject: r.subject,
    system: r.system,
    topic: r.topic,
    stem: r.stem,
    leadIn: r.question ?? r.lead_in,
    options,
    correct: r.correct,
    explanation: r.explanation,
    objective: r.objective,
    image: r.image,
    explanationImage: r.explanation_image,
    difficulty: r.difficulty,
    status: r.status,
    isFree: r.is_free,
  };
}

export function exportQuestions() {
  return sql(`
    SELECT q.*, s.name AS subject, y.name AS system FROM questions q
    LEFT JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN systems y ON y.id = q.system_id
    ORDER BY q.id`).all().map((q) => ({
    id: q.id,
    step: q.step,
    subject: q.subject,
    system: q.system,
    topic: q.topic,
    stem: q.stem,
    leadIn: q.lead_in,
    options: JSON.parse(q.options),
    correct: LETTERS[q.correct_index],
    explanation: q.explanation,
    objective: q.objective,
    image: q.image,
    explanationImage: q.explanation_image,
    difficulty: q.difficulty,
    status: q.status,
    isFree: Boolean(q.is_free),
  }));
}
