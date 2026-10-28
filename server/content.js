import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, tx } from './db.js';
import { normalizeQuestion, insertQuestion } from './questions.js';

const CONTENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'content');

/**
 * Loads question packs from server/content/*.json at startup.
 * Each question carries a stable `key`; questions already in the database
 * (by key) are left untouched, so edits made in the admin panel survive.
 * Packs are part of the code, so on hosting without a persistent disk the
 * questions come back after every restart.
 */
export function loadContentPacks() {
  if (process.env.CONTENT_PACKS === '0' || !fs.existsSync(CONTENT_DIR)) return 0;
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort();
  let added = 0;
  for (const file of files) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf8'));
    } catch (e) {
      console.error(`Не удалось прочитать ${file}: ${e.message}`);
      continue;
    }
    tx(() => {
      for (const q of list) {
        if (!q.key) { console.error(`${file}: вопрос без key пропущен`); continue; }
        if (sql('SELECT 1 FROM questions WHERE ext_id = ?').get(q.key)) continue;
        try {
          const id = insertQuestion(normalizeQuestion({ status: 'published', ...q }), null);
          sql('UPDATE questions SET ext_id = ? WHERE id = ?').run(q.key, id);
          added += 1;
        } catch (e) {
          console.error(`${file} / ${q.key}: ${e.message}`);
        }
      }
    });
  }
  if (added) console.log(`Добавлено вопросов из наборов: ${added}`);
  return added;
}
