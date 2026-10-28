import { api, html, raw, on, $, $$, fmtDate, toast, toastError, modal, confirmDialog, formData, icon } from '../lib.js';

const STEP = { step1: 'Step 1', step2: 'Step 2 CK', step3: 'Step 3' };
const QSTATUS = { published: ['Опубликован', 'ok'], draft: ['Черновик', 'warn'], archived: ['В архиве', ''] };
const ROLES = { student: 'Студент', author: 'Автор', admin: 'Администратор' };

export default async function admin(root, ctx) {
  const pages = { overview, questions, import: importPage, taxonomy, users, orders, settings };
  return pages[ctx.page](root, ctx);
}

/* ---------- overview ---------- */
async function overview(root, { app }) {
  app.setTitle('Администрирование');
  const o = await api('/api/admin/overview');
  const isAdmin = app.user.role === 'admin';
  root.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Администрирование</h1><p>Состояние базы вопросов и пользователей.</p></div>
      <a class="btn primary" href="/admin/questions/new">Новый вопрос</a>
    </div>
    ${isAdmin && o.pendingOrders ? html`<div class="notice warn"><p>Заявок на оплату ждут проверки: <b>${o.pendingOrders}</b>. <a href="/admin/orders">Перейти к оплатам</a></p></div>` : ''}
    <section class="panel">
      <div class="panel-head"><h2>Вопросы</h2><a class="small" href="/admin/questions">Все вопросы</a></div>
      <div class="kpis">
        <div class="kpi"><b>${o.questions.published || 0}</b><span>опубликовано</span></div>
        <div class="kpi"><b>${o.questions.draft || 0}</b><span>черновиков</span></div>
        <div class="kpi"><b>${o.questions.archived || 0}</b><span>в архиве</span></div>
        ${Object.entries(STEP).map(([k, v]) => html`<div class="kpi"><b>${o.publishedByStep[k] || 0}</b><span>${v}</span></div>`)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Пользователи</h2>${isAdmin ? html`<a class="small" href="/admin/users">Все пользователи</a>` : ''}</div>
      <div class="kpis">
        <div class="kpi"><b>${o.users}</b><span>всего</span></div>
        <div class="kpi"><b>${o.subscribers}</b><span>с оплаченным доступом</span></div>
        <div class="kpi"><b>${o.newUsers24h}</b><span>новых за сутки</span></div>
        <div class="kpi"><b>${o.tests24h}</b><span>тестов за сутки</span></div>
      </div>
    </section>`);
}

/* ---------- questions list ---------- */
async function questions(root, { app, query }) {
  app.setTitle('Вопросы');
  const [subjects, systems] = await Promise.all([api('/api/admin/subjects'), api('/api/admin/systems')]);
  const f = {
    q: query.get('q') || '',
    status: query.get('status') || '',
    step: query.get('step') || '',
    subject: query.get('subject') || '',
    system: query.get('system') || '',
    page: Number(query.get('page')) || 1,
  };
  const selected = new Set();
  let data;

  async function load() {
    const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null));
    history.replaceState(null, '', `/admin/questions${p.toString() ? `?${p}` : ''}`);
    data = await api(`/api/admin/questions?${p}`);
    selected.clear();
    drawTable();
  }

  root.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Вопросы</h1><p>Создание, редактирование и публикация вопросов.</p></div>
      <div class="row">
        <a class="btn" href="/admin/import">${icon('upload')}Импорт</a>
        <a class="btn primary" href="/admin/questions/new">Новый вопрос</a>
      </div>
    </div>
    <form class="filters" id="qf">
      <input class="input" type="search" name="q" placeholder="Поиск по тексту или ID" value="${f.q}">
      <select class="select" name="step"><option value="">Все Step</option>${Object.entries(STEP).map(([k, v]) => html`<option value="${k}" ${f.step === k ? 'selected' : ''}>${v}</option>`)}</select>
      <select class="select" name="status"><option value="">Любой статус</option>${Object.entries(QSTATUS).map(([k, v]) => html`<option value="${k}" ${f.status === k ? 'selected' : ''}>${v[0]}</option>`)}</select>
      <select class="select" name="subject"><option value="">Все предметы</option>${subjects.map((s) => html`<option value="${s.id}" ${String(s.id) === f.subject ? 'selected' : ''}>${s.name}</option>`)}</select>
      <select class="select" name="system"><option value="">Все системы</option>${systems.map((s) => html`<option value="${s.id}" ${String(s.id) === f.system ? 'selected' : ''}>${s.name}</option>`)}</select>
    </form>
    <div id="qtable"></div>`);

  function drawTable() {
    const box = $('#qtable', root);
    box.innerHTML = String(html`
      <div class="bulk" ${selected.size ? '' : 'hidden'} id="bulk">
        <b>Выбрано: <span id="selcount">${selected.size}</span></b>
        <button class="btn sm" data-bulk="published">Опубликовать</button>
        <button class="btn sm" data-bulk="draft">В черновики</button>
        <button class="btn sm" data-bulk="archived">В архив</button>
        <button class="btn sm" data-bulk="free">Сделать пробными</button>
        <button class="btn sm" data-bulk="unfree">Убрать из пробных</button>
      </div>
      <p class="small muted">Найдено: ${data.total}</p>
      ${data.items.length ? html`
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th><input type="checkbox" id="selall" aria-label="Выбрать все на странице"></th>
              <th>ID</th><th>Вопрос</th><th>Step</th><th>Предмет / система</th><th>Статус</th><th class="r">Ответов</th><th class="r">Верно</th>
            </tr></thead>
            <tbody>
              ${data.items.map((q) => html`
                <tr>
                  <td><input type="checkbox" data-sel="${q.id}" aria-label="Выбрать вопрос ${q.id}"></td>
                  <td class="num"><a href="/admin/questions/${q.id}">${q.id}</a></td>
                  <td class="clip" style="max-width:360px"><a href="/admin/questions/${q.id}">${q.topic || q.lead_in}</a><br><span class="small muted">${q.stem}</span></td>
                  <td class="nowrap">${STEP[q.step]}</td>
                  <td>${q.subject || '—'}<br><span class="small muted">${q.system || '—'}</span></td>
                  <td><span class="tag ${QSTATUS[q.status][1]}">${QSTATUS[q.status][0]}</span>${q.is_free ? html` <span class="tag eosin">Пробный</span>` : ''}</td>
                  <td class="r num">${q.answered}</td>
                  <td class="r num">${q.pct == null ? '—' : `${q.pct}%`}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Назад</button>
          <span class="small">Страница ${data.page} из ${data.pages}</span>
          <button class="btn sm" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Вперёд</button>
        </div>` : html`<div class="panel empty"><h2>Вопросов не найдено</h2><p>Измените фильтры или создайте новый вопрос.</p></div>`}`);
  }

  const syncBulk = () => {
    const b = $('#bulk', root);
    b.hidden = selected.size === 0;
    $('#selcount', root).textContent = selected.size;
  };

  let t = null;
  on(root, 'input', '#qf [name="q"]', (_, el) => {
    clearTimeout(t);
    t = setTimeout(() => { f.q = el.value; f.page = 1; load().catch(toastError); }, 300);
  });
  on(root, 'change', '#qf select', (_, el) => { f[el.name] = el.value; f.page = 1; load().catch(toastError); });
  on(root, 'submit', '#qf', (e) => e.preventDefault());
  on(root, 'click', '[data-page]', (_, el) => { f.page = Number(el.dataset.page); load().catch(toastError); });
  on(root, 'change', '[data-sel]', (_, el) => {
    const id = Number(el.dataset.sel);
    if (el.checked) selected.add(id); else selected.delete(id);
    syncBulk();
  });
  on(root, 'change', '#selall', (_, el) => {
    $$('[data-sel]', root).forEach((c) => { c.checked = el.checked; if (el.checked) selected.add(Number(c.dataset.sel)); else selected.delete(Number(c.dataset.sel)); });
    syncBulk();
  });
  on(root, 'click', '[data-bulk]', async (_, el) => {
    try {
      const r = await api('/api/admin/questions/bulk', { method: 'POST', body: { ids: [...selected], action: el.dataset.bulk } });
      toast(`Обновлено вопросов: ${r.count}`, 'ok');
      await load();
    } catch (e) { toastError(e); }
  });

  await load();
}

/* ---------- import / export ---------- */
async function importPage(root, { app }) {
  app.setTitle('Импорт вопросов');
  root.innerHTML = String(html`
    <div class="page-head">
      <div><h1>Импорт и экспорт</h1><p>Загрузка вопросов пачкой из JSON или CSV и выгрузка всей базы для резервной копии.</p></div>
      <a class="btn" href="/api/admin/export" download>${icon('download')}Экспорт всех вопросов (JSON)</a>
    </div>
    <div class="grid-2">
      <section class="panel">
        <h2>Загрузить файл</h2>
        <form id="imp">
          <label class="field"><span>Файл JSON или CSV</span><input class="input" type="file" name="file" accept=".json,.csv,text/csv,application/json"></label>
          <label class="field"><span>…или вставьте содержимое</span><textarea class="textarea code" name="text" rows="8" placeholder='[{"step":"step1","subject":"Патология", ...}]'></textarea></label>
          <label class="field"><span>Статус загруженных вопросов</span>
            <select class="select" name="status">
              <option value="draft">Черновик — проверю перед публикацией</option>
              <option value="published">Сразу опубликовать</option>
              <option value="">Как указано в файле</option>
            </select>
          </label>
          <button class="btn primary" type="submit">${icon('upload')}Импортировать</button>
        </form>
        <div id="imp-result" style="margin-top:16px"></div>
      </section>
      <section class="panel" style="margin-top:0">
        <h2>Формат</h2>
        <p>Шаблоны: <a href="/templates/questions-template.csv" download>CSV</a>, <a href="/templates/questions-template.json" download>JSON</a>. CSV сохраняйте в UTF-8; разделитель — запятая или точка с запятой.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Поле</th><th>Описание</th></tr></thead>
            <tbody>
              <tr><td><code>step</code></td><td>step1, step2 или step3</td></tr>
              <tr><td><code>subject</code>, <code>system</code></td><td>Названия; новые создаются автоматически</td></tr>
              <tr><td><code>topic</code></td><td>Тема (необязательно)</td></tr>
              <tr><td><code>stem</code></td><td>Условие задачи (поддерживает разметку)</td></tr>
              <tr><td><code>question</code></td><td>Сам вопрос (в JSON — <code>leadIn</code>)</td></tr>
              <tr><td><code>option_a</code>…<code>option_j</code></td><td>Варианты ответа (в JSON — массив <code>options</code>)</td></tr>
              <tr><td><code>correct</code></td><td>Буква правильного ответа: A, B, C…</td></tr>
              <tr><td><code>explanation</code>, <code>objective</code></td><td>Объяснение и цель обучения</td></tr>
              <tr><td><code>difficulty</code></td><td>1 — лёгкий, 2 — средний, 3 — сложный</td></tr>
              <tr><td><code>is_free</code></td><td>1 — пробный вопрос, доступен без оплаты</td></tr>
            </tbody>
          </table>
        </div>
        <p class="small muted" style="margin-top:12px">Разметка текста: <code>**жирный**</code>, <code>*курсив*</code>, списки через «- », таблицы через «|», изображения <code>![](/uploads/файл.png)</code>.</p>
      </section>
    </div>`);

  on(root, 'submit', '#imp', async (e) => {
    e.preventDefault();
    const form = e.target;
    const file = form.file.files[0];
    let text = form.text.value;
    let format = 'json';
    if (file) {
      text = await file.text();
      format = /\.csv$/i.test(file.name) ? 'csv' : 'json';
    } else if (text.trim() && !/^\s*[[{]/.test(text)) format = 'csv';
    if (!text.trim()) { toast('Выберите файл или вставьте содержимое', 'error'); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await api('/api/admin/import', { method: 'POST', body: { format, data: text, status: form.status.value } });
      $('#imp-result', root).innerHTML = String(html`
        <div class="notice ${r.errorCount ? 'warn' : ''}">
          <p><b>Импортировано: ${r.imported}.</b> ${r.errorCount ? `Ошибок: ${r.errorCount}.` : ''}</p>
          ${r.errors.length ? html`<ul class="small">${r.errors.map((er) => html`<li>Строка ${er.row}: ${er.message}</li>`)}</ul>` : ''}
          ${r.imported ? html`<p><a href="/admin/questions">Открыть список вопросов</a></p>` : ''}
        </div>`);
    } catch (ex) { toastError(ex); } finally { btn.disabled = false; }
  });
}

/* ---------- subjects & systems ---------- */
async function taxonomy(root, { app }) {
  app.setTitle('Предметы и системы');
  async function draw() {
    const [subjects, systems] = await Promise.all([api('/api/admin/subjects'), api('/api/admin/systems')]);
    const block = (kind, title, list) => html`
      <section class="panel" style="margin-top:0">
        <h2>${title}</h2>
        <form class="row" data-add="${kind}" style="margin-bottom:12px">
          <input class="input" name="name" placeholder="Новое название" maxlength="80" required style="flex:1">
          <button class="btn" type="submit">Добавить</button>
        </form>
        <ul class="list-plain tax-list">
          ${list.map((x) => html`
            <li>
              <input class="input" value="${x.name}" data-rename="${kind}:${x.id}" data-sort="${x.sort}" aria-label="Название">
              <span class="small muted nowrap">${x.questions} вопр.</span>
              <button class="icon-btn" data-delete="${kind}:${x.id}" aria-label="Удалить" ${x.questions ? raw('disabled title="Есть вопросы"') : ''}>${icon('trash')}</button>
            </li>`)}
        </ul>
      </section>`;
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Предметы и системы</h1><p>Названия видны студентам при создании теста и в статистике. Изменения сохраняются при выходе из поля.</p></div></div>
      <div class="grid-2">${block('subjects', 'Предметы', subjects)}${block('systems', 'Системы', systems)}</div>`);
  }
  await draw();

  on(root, 'submit', '[data-add]', async (e, form) => {
    e.preventDefault();
    try {
      await api(`/api/admin/${form.dataset.add}`, { method: 'POST', body: { name: form.name.value } });
      await draw();
    } catch (ex) { toastError(ex); }
  });
  on(root, 'change', '[data-rename]', async (_, el) => {
    const [kind, id] = el.dataset.rename.split(':');
    try {
      await api(`/api/admin/${kind}/${id}`, { method: 'PUT', body: { name: el.value, sort: Number(el.dataset.sort) } });
      toast('Сохранено', 'ok');
    } catch (ex) { toastError(ex); }
  });
  on(root, 'click', '[data-delete]', async (_, el) => {
    const [kind, id] = el.dataset.delete.split(':');
    if (!(await confirmDialog('Удалить этот раздел?', { ok: 'Удалить', danger: true }))) return;
    try {
      await api(`/api/admin/${kind}/${id}`, { method: 'DELETE' });
      await draw();
    } catch (ex) { toastError(ex); }
  });
}

/* ---------- users ---------- */
async function users(root, { app }) {
  app.setTitle('Пользователи');
  const f = { q: '', filter: '', page: 1 };
  let data;
  root.innerHTML = String(html`
    <div class="page-head"><div><h1>Пользователи</h1><p>Выдача доступа, роли и сброс пароля.</p></div></div>
    <form class="filters" id="uf">
      <input class="input" type="search" name="q" placeholder="Поиск по имени или email">
      <select class="select" name="filter"><option value="">Все</option><option value="subscribers">С оплаченным доступом</option><option value="staff">Авторы и администраторы</option></select>
    </form>
    <div id="utable"></div>`);

  async function load() {
    data = await api(`/api/admin/users?${new URLSearchParams(f)}`);
    $('#utable', root).innerHTML = String(html`
      <p class="small muted">Найдено: ${data.total}</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Пользователь</th><th>Роль</th><th>Доступ до</th><th class="r">Тестов</th><th class="r">Ответов</th><th>Регистрация</th><th></th></tr></thead>
          <tbody>
            ${data.items.map((u) => html`
              <tr>
                <td><b>${u.name}</b>${u.blocked ? html` <span class="tag bad">Заблокирован</span>` : ''}<br><span class="small muted">${u.email}</span></td>
                <td>${ROLES[u.role]}</td>
                <td class="nowrap">${u.access_until && u.access_until > new Date().toISOString() ? fmtDate(u.access_until) : html`<span class="muted">нет</span>`}</td>
                <td class="r num">${u.tests}</td>
                <td class="r num">${u.answered}</td>
                <td class="nowrap">${fmtDate(u.created_at)}</td>
                <td class="r"><button class="btn sm" data-user="${u.id}">Управлять</button></td>
              </tr>`)}
          </tbody>
        </table>
      </div>
      <div class="pager">
        <button class="btn sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Назад</button>
        <span class="small">Страница ${data.page} из ${data.pages}</span>
        <button class="btn sm" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Вперёд</button>
      </div>`);
  }

  let t;
  on(root, 'input', '#uf [name="q"]', (_, el) => { clearTimeout(t); t = setTimeout(() => { f.q = el.value; f.page = 1; load(); }, 300); });
  on(root, 'change', '#uf select', (_, el) => { f.filter = el.value; f.page = 1; load(); });
  on(root, 'submit', '#uf', (e) => e.preventDefault());
  on(root, 'click', '[data-page]', (_, el) => { f.page = Number(el.dataset.page); load(); });
  on(root, 'click', '[data-user]', (_, el) => {
    const u = data.items.find((x) => x.id === Number(el.dataset.user));
    const self = u.id === app.user.id;
    modal({
      title: u.name,
      wide: true,
      body: html`
        <p class="muted">${u.email}${u.last_login_at ? `, последний вход ${fmtDate(u.last_login_at, true)}` : ''}</p>
        <form id="uform">
          <div class="grid-2">
            <label class="field"><span>Продлить доступ на, дней</span>
              <input class="input" type="number" name="extendDays" placeholder="например, 30" min="-3650" max="3650">
              <small>Прибавится к текущему сроку. Отрицательное число сокращает доступ.</small>
            </label>
            <label class="field"><span>Или задать дату окончания</span>
              <input class="input" type="date" name="accessUntil" value="${u.access_until ? u.access_until.slice(0, 10) : ''}">
            </label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Роль</span>
              <select class="select" name="role" ${self ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, v]) => html`<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`)}</select>
              <small>Автор управляет вопросами, администратор — всем сайтом.</small>
            </label>
            <label class="field"><span>Новый пароль</span>
              <input class="input" type="text" name="newPassword" minlength="8" autocomplete="off" placeholder="оставьте пустым, чтобы не менять">
            </label>
          </div>
          ${self ? '' : html`<label class="check"><input type="checkbox" name="blocked" ${u.blocked ? 'checked' : ''}>Заблокировать вход</label>`}
        </form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сохранить',
          kind: 'primary',
          onClick: async (m) => {
            const d = formData(m.querySelector('#uform'));
            const body = {};
            if (d.extendDays) body.extendDays = Number(d.extendDays);
            else {
              const cur = u.access_until ? u.access_until.slice(0, 10) : '';
              if (d.accessUntil !== cur) body.accessUntil = d.accessUntil ? `${d.accessUntil}T23:59:59.000Z` : null;
            }
            if (!self && d.role && d.role !== u.role) body.role = d.role;
            if (d.newPassword) body.newPassword = d.newPassword;
            if (!self && Boolean(d.blocked) !== Boolean(u.blocked)) body.blocked = Boolean(d.blocked);
            await api(`/api/admin/users/${u.id}`, { method: 'PUT', body });
            toast('Изменения сохранены', 'ok');
            await load();
          },
        },
      ],
    });
  });
  await load();
}

/* ---------- orders ---------- */
async function orders(root, { app }) {
  app.setTitle('Оплаты');
  let status = 'pending';
  async function load() {
    const list = await api(`/api/admin/orders${status ? `?status=${status}` : ''}`);
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Оплаты</h1><p>Сверьте платёж по данным пользователя и подтвердите заявку — доступ продлится автоматически.</p></div>
        <div class="seg">
          ${[['pending', 'На проверке'], ['paid', 'Оплачено'], ['rejected', 'Отклонено'], ['', 'Все']].map(([k, v]) => html`<button data-status="${k}" class="${status === k ? 'on' : ''}">${v}</button>`)}
        </div>
      </div>
      ${list.length ? html`
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Дата</th><th>Пользователь</th><th>Тариф</th><th class="r">Сумма</th><th>Данные платежа</th><th></th></tr></thead>
            <tbody>
              ${list.map((o) => html`
                <tr>
                  <td class="nowrap">${fmtDate(o.created_at, true)}</td>
                  <td><b>${o.user_name}</b><br><span class="small muted">${o.email}</span></td>
                  <td>${o.plan_name}<br><span class="small muted">${o.days} дн.</span></td>
                  <td class="r num nowrap">${o.amount} ${o.currency}</td>
                  <td>${o.user_comment}${o.admin_comment ? html`<br><span class="small muted">Ответ: ${o.admin_comment}</span>` : ''}</td>
                  <td class="r nowrap">${o.status === 'pending'
                    ? html`<button class="btn sm primary" data-decide="${o.id}:1">Подтвердить</button> <button class="btn sm danger" data-decide="${o.id}:0">Отклонить</button>`
                    : html`<span class="tag ${o.status === 'paid' ? 'ok' : 'bad'}">${o.status === 'paid' ? 'Оплачено' : 'Отклонено'}</span>`}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : html`<div class="panel empty"><h2>Заявок нет</h2><p>Новые заявки появятся здесь, когда пользователи выберут тариф.</p></div>`}`);
  }
  on(root, 'click', '[data-status]', (_, el) => { status = el.dataset.status; load(); });
  on(root, 'click', '[data-decide]', (_, el) => {
    const [id, approve] = el.dataset.decide.split(':');
    modal({
      title: approve === '1' ? 'Подтвердить оплату' : 'Отклонить заявку',
      body: html`<form id="dec"><label class="field"><span>Комментарий для пользователя</span><input class="input" name="comment" maxlength="500" placeholder="${approve === '1' ? 'необязательно' : 'например: платёж не найден'}"></label></form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: approve === '1' ? 'Подтвердить и открыть доступ' : 'Отклонить',
          kind: approve === '1' ? 'primary' : 'danger',
          onClick: async (m) => {
            const { comment } = formData(m.querySelector('#dec'));
            await api(`/api/admin/orders/${id}/decide`, { method: 'POST', body: { approve: approve === '1', comment } });
            toast(approve === '1' ? 'Доступ открыт' : 'Заявка отклонена', 'ok');
            await load();
          },
        },
      ],
    });
  });
  await load();
}

/* ---------- plans & settings ---------- */
async function settings(root, { app }) {
  app.setTitle('Тарифы и настройки');
  async function load() {
    const [s, plans] = await Promise.all([api('/api/admin/settings'), api('/api/admin/plans')]);
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Тарифы и настройки</h1></div></div>
      <section class="panel">
        <h2>Сайт</h2>
        <form id="sf" style="max-width:720px">
          <label class="field"><span>Название сайта</span><input class="input" name="site_name" value="${s.site_name}" maxlength="60"></label>
          <div class="grid-2">
            <label class="field"><span>Telegram для связи</span><input class="input" name="contact_telegram" value="${s.contact_telegram}" placeholder="@username"></label>
            <label class="field"><span>Email для связи</span><input class="input" name="contact_email" value="${s.contact_email}" placeholder="support@example.com"></label>
          </div>
          <label class="field"><span>Текст о пробном доступе</span><textarea class="textarea" name="trial_note" rows="2">${s.trial_note}</textarea></label>
          <label class="field"><span>Инструкция по оплате</span><textarea class="textarea" name="payment_instructions" rows="6">${s.payment_instructions}</textarea>
            <small>Показывается пользователю при выборе тарифа: реквизиты, номер карты или кошелька, куда писать после оплаты. Поддерживает разметку.</small></label>
          <button class="btn primary" type="submit">Сохранить настройки</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Тарифы</h2><button class="btn" data-plan="new">Добавить тариф</button></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Название</th><th class="r">Дней</th><th class="r">Цена</th><th>Описание</th><th>Показан</th><th></th></tr></thead>
            <tbody>${plans.map((p) => html`
              <tr>
                <td><b>${p.name}</b></td><td class="r num">${p.days}</td><td class="r num nowrap">${p.price} ${p.currency}</td>
                <td>${p.description}</td><td>${p.active ? 'Да' : html`<span class="muted">Скрыт</span>`}</td>
                <td class="r"><button class="btn sm" data-plan="${p.id}">Изменить</button></td>
              </tr>`)}</tbody>
          </table>
        </div>
      </section>`);
    root._plans = plans;
  }

  on(root, 'submit', '#sf', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PUT', body: formData(e.target) });
      await app.refreshMeta();
      toast('Настройки сохранены', 'ok');
    } catch (ex) { toastError(ex); }
  });

  on(root, 'click', '[data-plan]', (_, el) => {
    const p = el.dataset.plan === 'new' ? null : root._plans.find((x) => x.id === Number(el.dataset.plan));
    modal({
      title: p ? 'Изменить тариф' : 'Новый тариф',
      body: html`
        <form id="pf">
          <label class="field"><span>Название</span><input class="input" name="name" value="${p?.name || ''}" required maxlength="80"></label>
          <div class="grid-2">
            <label class="field"><span>Срок, дней</span><input class="input" type="number" name="days" value="${p?.days || 30}" min="1" max="3650"></label>
            <label class="field"><span>Порядок</span><input class="input" type="number" name="sort" value="${p?.sort || 0}" min="0"></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Цена</span><input class="input" type="number" step="0.01" name="price" value="${p?.price ?? ''}" min="0" required></label>
            <label class="field"><span>Валюта</span><input class="input" name="currency" value="${p?.currency || 'USD'}" maxlength="8"></label>
          </div>
          <label class="field"><span>Описание</span><input class="input" name="description" value="${p?.description || ''}" maxlength="300"></label>
          <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}>Показывать пользователям</label>
        </form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сохранить',
          kind: 'primary',
          onClick: async (m) => {
            const d = formData(m.querySelector('#pf'));
            const body = { ...d, days: Number(d.days), price: Number(d.price), sort: Number(d.sort) };
            if (p) await api(`/api/admin/plans/${p.id}`, { method: 'PUT', body });
            else await api('/api/admin/plans', { method: 'POST', body });
            await load();
            await app.refreshMeta();
            toast('Тариф сохранён', 'ok');
          },
        },
      ],
    });
  });
  await load();
}
