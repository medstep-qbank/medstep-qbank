import fs from 'node:fs';
import path from 'node:path';
import { db, sql, now, ensureDefaults, DATA_DIR } from './db.js';
import { hashPassword } from './auth.js';
import { seedDemo, seedTaxonomy } from './seed.js';

const [cmd, ...args] = process.argv.slice(2);
ensureDefaults();

switch (cmd) {
  case 'seed': {
    const n = seedDemo();
    console.log(`Добавлено демо-вопросов: ${n}`);
    break;
  }
  case 'taxonomy': {
    seedTaxonomy();
    console.log('Предметы и системы добавлены');
    break;
  }
  case 'make-admin': {
    const [email, password] = args;
    if (!email) {
      console.log('Использование: npm run make-admin -- email@example.com [пароль]');
      process.exit(1);
    }
    const u = sql('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (u) {
      sql(`UPDATE users SET role = 'admin' WHERE id = ?`).run(u.id);
      if (password) sql('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), u.id);
      console.log(`Пользователь ${email} теперь администратор`);
    } else {
      if (!password || password.length < 8) {
        console.log('Пользователь не найден. Чтобы создать нового, укажите пароль (минимум 8 символов).');
        process.exit(1);
      }
      sql(`INSERT INTO users(email, name, password_hash, role, created_at) VALUES (?, 'Администратор', ?, 'admin', ?)`)
        .run(email.toLowerCase(), hashPassword(password), now());
      console.log(`Создан администратор ${email}`);
    }
    break;
  }
  case 'backup': {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `qbank-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    console.log(`Резервная копия: ${file}`);
    break;
  }
  default:
    console.log('Команды: seed | taxonomy | make-admin <email> [пароль] | backup');
}
db.close();
