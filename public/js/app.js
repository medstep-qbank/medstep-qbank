import { api, html, icon, $, applyTheme, toggleTheme, currentTheme, toastError } from './lib.js';

applyTheme();

const routes = [
  { path: '/', load: () => import('./views/landing.js'), layout: 'bare' },
  { path: '/login', load: () => import('./views/auth.js'), layout: 'bare', props: { mode: 'login' } },
  { path: '/register', load: () => import('./views/auth.js'), layout: 'bare', props: { mode: 'register' } },
  { path: '/app', load: () => import('./views/dashboard.js'), auth: true, nav: 'home' },
  { path: '/app/create', load: () => import('./views/create.js'), auth: true, nav: 'create' },
  { path: '/app/tests', load: () => import('./views/tests.js'), auth: true, nav: 'tests' },
  { path: '/app/tests/:id', load: () => import('./views/result.js'), auth: true, nav: 'tests' },
  { path: '/exam/:id', load: () => import('./views/exam.js'), auth: true, layout: 'bare' },
  { path: '/app/stats', load: () => import('./views/stats.js'), auth: true, nav: 'stats' },
  { path: '/app/notes', load: () => import('./views/notes.js'), auth: true, nav: 'notes' },
  { path: '/app/flashcards', load: () => import('./views/flashcards.js'), auth: true, nav: 'cards' },
  { path: '/app/account', load: () => import('./views/account.js'), auth: true, nav: 'account' },
  { path: '/admin', load: () => import('./views/admin.js'), auth: 'author', nav: 'a-home', props: { page: 'overview' } },
  { path: '/admin/questions', load: () => import('./views/admin.js'), auth: 'author', nav: 'a-questions', props: { page: 'questions' } },
  { path: '/admin/questions/new', load: () => import('./views/admin-editor.js'), auth: 'author', nav: 'a-questions' },
  { path: '/admin/questions/:id', load: () => import('./views/admin-editor.js'), auth: 'author', nav: 'a-questions' },
  { path: '/admin/import', load: () => import('./views/admin.js'), auth: 'author', nav: 'a-import', props: { page: 'import' } },
  { path: '/admin/taxonomy', load: () => import('./views/admin.js'), auth: 'author', nav: 'a-taxonomy', props: { page: 'taxonomy' } },
  { path: '/admin/users', load: () => import('./views/admin.js'), auth: 'admin', nav: 'a-users', props: { page: 'users' } },
  { path: '/admin/orders', load: () => import('./views/admin.js'), auth: 'admin', nav: 'a-orders', props: { page: 'orders' } },
  { path: '/admin/settings', load: () => import('./views/admin.js'), auth: 'admin', nav: 'a-settings', props: { page: 'settings' } },
].map((r) => {
  const keys = [];
  const re = new RegExp(`^${r.path.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { ...r, keys, re };
});

const RANK = { student: 1, author: 2, admin: 3 };

export const app = {
  user: null,
  meta: null,
  cleanup: null,
  siteName: 'MedStep',
  async refreshMeta() {
    this.meta = await api('/api/meta');
    this.user = this.meta.user;
    this.siteName = this.meta.settings.site_name || 'MedStep';
    return this.meta;
  },
  navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    render();
  },
  setTitle(t) {
    document.title = t ? `${t} — ${this.siteName}` : this.siteName;
  },
};
window.__app = app;

const NAV = [
  { id: 'home', href: '/app', label: 'Главная', icon: 'home' },
  { id: 'create', href: '/app/create', label: 'Создать тест', icon: 'plus' },
  { id: 'tests', href: '/app/tests', label: 'Мои тесты', icon: 'list' },
  { id: 'stats', href: '/app/stats', label: 'Статистика', icon: 'chart' },
  { id: 'notes', href: '/app/notes', label: 'Заметки', icon: 'note' },
  { id: 'cards', href: '/app/flashcards', label: 'Флеш-карты', icon: 'cards' },
];
const ADMIN_NAV = [
  { id: 'a-home', href: '/admin', label: 'Обзор', role: 'author' },
  { id: 'a-questions', href: '/admin/questions', label: 'Вопросы', role: 'author' },
  { id: 'a-import', href: '/admin/import', label: 'Импорт и экспорт', role: 'author' },
  { id: 'a-taxonomy', href: '/admin/taxonomy', label: 'Предметы и системы', role: 'author' },
  { id: 'a-users', href: '/admin/users', label: 'Пользователи', role: 'admin' },
  { id: 'a-orders', href: '/admin/orders', label: 'Оплаты', role: 'admin' },
  { id: 'a-settings', href: '/admin/settings', label: 'Тарифы и настройки', role: 'admin' },
];

function shell(active) {
  const u = app.user;
  const staff = RANK[u.role] >= RANK.author;
  return html`
    <div class="shell">
      <header class="topbar">
        <button class="icon-btn" id="menu-btn" aria-label="Меню" aria-expanded="false">${icon('menu')}</button>
        <a href="/app" class="brand">${brandMark()}<span>${app.siteName}</span></a>
      </header>
      <aside class="side" id="side">
        <a href="/app" class="brand side-brand">${brandMark()}<span>${app.siteName}</span></a>
        <nav class="side-nav" aria-label="Основное меню">
          ${NAV.map((n) => html`<a href="${n.href}" class="${n.id === active ? 'active' : ''}" ${n.id === active ? html`aria-current="page"` : ''}>${icon(n.icon)}<span>${n.label}</span></a>`)}
        </nav>
        ${staff ? html`
          <nav class="side-nav side-admin" aria-label="Администрирование">
            <p class="side-group">${icon('shield')}<span>Администрирование</span></p>
            ${ADMIN_NAV.filter((n) => RANK[u.role] >= RANK[n.role]).map((n) => html`<a href="${n.href}" class="sub ${n.id === active ? 'active' : ''}">${n.label}</a>`)}
          </nav>` : ''}
        <div class="side-foot">
          ${!u.hasAccess ? html`<a href="/app/account" class="side-upgrade">Пробный доступ<span>Открыть всю базу</span></a>` : ''}
          <a href="/app/account" class="side-user ${active === 'account' ? 'active' : ''}">${icon('user')}<span><b>${u.name}</b><small>${u.email}</small></span></a>
          <div class="side-actions">
            <button class="icon-btn" id="theme-btn" aria-label="Переключить тему">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
            <button class="icon-btn" id="logout-btn" aria-label="Выйти">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <main class="main" id="view" tabindex="-1"></main>
      ${app.meta.demo ? html`<p class="demo-note" role="note">Демо-версия: аккаунты и прогресс периодически сбрасываются.</p>` : ''}
    </div>`;
}

export function brandMark() {
  // A stylised stained cell: hematoxylin nucleus inside an eosin cytoplasm.
  return html`<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><ellipse cx="16" cy="16" rx="14" ry="12" fill="var(--eosin-soft)" stroke="var(--eosin)" stroke-width="2"/><circle cx="13.5" cy="15" r="6" fill="var(--hema)"/><circle cx="12" cy="13.5" r="1.6" fill="var(--paper)"/></svg>`;
}

let renderId = 0;

async function render() {
  const id = ++renderId;
  if (app.cleanup) {
    try { await app.cleanup(); } catch { /* ignore */ }
    app.cleanup = null;
  }
  const url = new URL(location.href);
  let route = null;
  let params = {};
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (m) {
      route = r;
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      break;
    }
  }
  const root = $('#app');
  if (!route) {
    root.innerHTML = String(html`<div class="center-page"><div class="empty"><h1>Страница не найдена</h1><p>Проверьте адрес или вернитесь на главную.</p><a class="btn primary" href="/">На главную</a></div></div>`);
    app.setTitle('Не найдено');
    return;
  }
  if (route.auth && !app.user) {
    app.navigate(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, { replace: true });
    return;
  }
  if (typeof route.auth === 'string' && RANK[app.user.role] < RANK[route.auth]) {
    app.navigate('/app', { replace: true });
    return;
  }

  let target;
  if (route.layout === 'bare') {
    root.innerHTML = '<div id="view" class="bare"></div>';
    target = $('#view');
  } else {
    root.innerHTML = String(shell(route.nav));
    target = $('#view');
    bindShell();
  }
  target.innerHTML = '<div class="loading" aria-busy="true"><span></span></div>';
  try {
    const mod = await route.load();
    if (id !== renderId) return;
    const cleanup = await mod.default(target, { params, query: url.searchParams, app, ...(route.props || {}) });
    if (id !== renderId) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    app.cleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (e) {
    if (id !== renderId) return;
    console.error(e);
    target.innerHTML = String(html`<div class="empty"><h1>Не удалось загрузить страницу</h1><p>${e.message}</p><button class="btn" data-reload>Обновить</button></div>`);
  }
  if (!url.hash) window.scrollTo(0, 0);
}

function bindShell() {
  const side = $('#side');
  const btn = $('#menu-btn');
  btn?.addEventListener('click', () => {
    const open = side.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  side.addEventListener('click', (e) => {
    if (e.target.closest('a')) side.classList.remove('open');
  });
  $('#theme-btn')?.addEventListener('click', (e) => {
    const t = toggleTheme();
    e.currentTarget.innerHTML = String(icon(t === 'dark' ? 'sun' : 'moon'));
  });
  $('#logout-btn')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) { toastError(e); }
    app.user = null;
    app.navigate('/');
  });
}

/* Intercept same-origin links for client-side navigation. */
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/') || href.startsWith('/uploads/')) return;
  e.preventDefault();
  const url = new URL(href, location.href);
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  app.navigate(href);
});

window.addEventListener('popstate', render);
window.addEventListener('auth:lost', () => {
  if (!app.user) return;
  app.user = null;
  const p = location.pathname;
  if (p.startsWith('/app') || p.startsWith('/admin') || p.startsWith('/exam')) {
    app.navigate(`/login?next=${encodeURIComponent(p + location.search)}`, { replace: true });
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-reload]')) location.reload();
});

(async () => {
  try {
    await app.refreshMeta();
  } catch (e) {
    $('#app').innerHTML = String(html`<div class="center-page"><div class="empty"><h1>Сервер недоступен</h1><p>${e.message}</p><button class="btn primary" data-reload>Повторить</button></div></div>`);
    return;
  }
  render();
})();
