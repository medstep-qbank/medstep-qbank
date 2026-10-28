import { api, html, $, formData } from '../lib.js';
import { brandMark } from '../app.js';

function safeNext(v) {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/app';
}

export default async function auth(root, { app, mode, query }) {
  const next = safeNext(query.get('next'));
  if (app.user) {
    app.navigate(next, { replace: true });
    return;
  }
  const reg = mode === 'register';
  app.setTitle(reg ? 'Регистрация' : 'Вход');
  const nextQ = query.get('next') ? `?next=${encodeURIComponent(next)}` : '';

  root.innerHTML = String(html`
    <div class="auth-page">
      <aside class="auth-side">
        <a href="/" class="brand">${brandMark()}<span>${app.siteName}</span></a>
        <blockquote>Каждая ошибка в тренировочном тесте — это ошибка, которой не будет на экзамене.<small>Решайте, разбирайте, повторяйте.</small></blockquote>
        <span></span>
      </aside>
      <main class="auth-main">
        <form class="auth-card" id="auth-form" novalidate>
          <h1>${reg ? 'Создайте аккаунт' : 'С возвращением'}</h1>
          <p class="muted">${reg ? 'Пробные вопросы откроются сразу после регистрации.' : 'Войдите, чтобы продолжить подготовку.'}</p>
          <div class="notice bad" id="auth-error" hidden></div>
          ${reg ? html`<label class="field"><span>Имя</span><input class="input" name="name" autocomplete="name" required maxlength="80"></label>` : ''}
          <label class="field"><span>Email</span><input class="input" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Пароль</span><input class="input" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="${reg ? 8 : 1}">
            ${reg ? html`<small>Минимум 8 символов</small>` : ''}
          </label>
          <button class="btn primary lg" type="submit">${reg ? 'Зарегистрироваться' : 'Войти'}</button>
          <p class="auth-alt">${reg
            ? html`Уже есть аккаунт? <a href="/login${nextQ}">Войти</a>`
            : html`Нет аккаунта? <a href="/register${nextQ}">Зарегистрироваться</a>`}</p>
          ${reg ? '' : html`<p class="small muted">Забыли пароль? Напишите в поддержку${app.meta.settings.contact_telegram ? html` (${app.meta.settings.contact_telegram})` : ''} — администратор сбросит его.</p>`}
        </form>
      </main>
    </div>`);

  const form = $('#auth-form', root);
  const err = $('#auth-error', root);
  form.querySelector('input').focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = formData(form);
      const res = await api(reg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: data });
      app.user = res.user;
      app.navigate(next, { replace: true });
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
}
