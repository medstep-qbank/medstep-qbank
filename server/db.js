import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'qbank.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  access_until TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS systems (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  system_id INTEGER REFERENCES systems(id) ON DELETE SET NULL,
  topic TEXT NOT NULL DEFAULT '',
  stem TEXT NOT NULL,
  lead_in TEXT NOT NULL,
  options TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  image TEXT,
  explanation_image TEXT,
  difficulty INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'draft',
  is_free INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_pub ON questions(status, step);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  question_count INTEGER NOT NULL,
  time_limit_sec INTEGER,
  time_used_sec INTEGER NOT NULL DEFAULT 0,
  current_index INTEGER NOT NULL DEFAULT 0,
  settings TEXT,
  score_correct INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS tests_user ON tests(user_id, created_at);

CREATE TABLE IF NOT EXISTS test_items (
  id INTEGER PRIMARY KEY,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_index INTEGER,
  is_correct INTEGER,
  marked INTEGER NOT NULL DEFAULT 0,
  time_spent_sec INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT,
  highlights TEXT,
  strikes TEXT,
  UNIQUE (test_id, position)
);
CREATE INDEX IF NOT EXISTS test_items_q ON test_items(question_id);

CREATE TABLE IF NOT EXISTS user_question (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  last_status TEXT,
  marked INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notes_user_q ON notes(user_id, question_id) WHERE question_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  deck TEXT NOT NULL DEFAULT 'Общая',
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  due_at TEXT NOT NULL,
  interval_days REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS flashcards_due ON flashcards(user_id, due_at);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  days INTEGER NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  plan_name TEXT NOT NULL,
  days INTEGER NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  user_comment TEXT NOT NULL DEFAULT '',
  admin_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Unicode-aware lower() — SQLite's built-in LIKE/lower only fold ASCII, not Cyrillic.
db.function('ulower', { deterministic: true }, (v) => (v == null ? null : String(v).toLowerCase()));

const cache = new Map();
/** Prepared-statement cache. */
export function sql(text) {
  let st = cache.get(text);
  if (!st) {
    if (cache.size > 400) cache.clear(); // dynamic IN-lists produce many variants
    st = db.prepare(text);
    cache.set(text, st);
  }
  return st;
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();

export function getSetting(key, fallback = '') {
  const row = sql('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  sql('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export const DEFAULT_SETTINGS = {
  site_name: process.env.SITE_NAME || 'MedStep',
  contact_telegram: '',
  contact_email: '',
  payment_instructions:
    'Переведите сумму тарифа по реквизитам, которые вы укажете здесь в админке (раздел «Настройки»). ' +
    'После оплаты оставьте в заявке номер транзакции — доступ откроется после проверки.',
  trial_note: 'Бесплатно доступны вопросы с пометкой «пробный». Полная база открывается после оплаты.',
};

export function ensureDefaults() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    sql('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)').run(k, v);
  }
  const planCount = sql('SELECT COUNT(*) AS c FROM plans').get().c;
  if (planCount === 0) {
    const ins = sql('INSERT INTO plans(name, days, price, currency, description, sort) VALUES (?,?,?,?,?,?)');
    ins.run('1 месяц', 30, 15, 'USD', 'Полный доступ ко всем вопросам и статистике', 1);
    ins.run('3 месяца', 90, 35, 'USD', 'Оптимально для подготовки к одному Step', 2);
    ins.run('12 месяцев', 365, 90, 'USD', 'Все Step в течение года', 3);
  }
}
