import { api, html, $, $$, on, store, toastError, qWord } from '../lib.js';

const STATUS = [
  ['unused', 'Неиспользованные'],
  ['incorrect', 'Неверные'],
  ['marked', 'Отмеченные'],
  ['omitted', 'Пропущенные'],
  ['correct', 'Верные'],
];

export default async function create(root, { app, query }) {
  app.setTitle('Создать тест');
  const saved = store.get('createPrefs', {});
  const state = {
    step: saved.step || 'step1',
    mode: saved.mode || 'tutor',
    filters: query.get('filter') ? [query.get('filter')] : (saved.filters || ['unused']),
    subjects: new Set(),
    systems: new Set(),
    count: saved.count || 10,
  };
  let cat = null;
  let reqId = 0;

  async function load() {
    const id = ++reqId;
    const p = new URLSearchParams({
      step: state.step,
      filters: state.filters.join(','),
      subjects: [...state.subjects].join(','),
      systems: [...state.systems].join(','),
    });
    const data = await api(`/api/qbank/catalog?${p}`);
    if (id !== reqId) return;
    cat = data;
    // drop selections that no longer exist in this step
    const sIds = new Set(cat.subjects.map((s) => s.id));
    const yIds = new Set(cat.systems.map((s) => s.id));
    for (const s of state.subjects) if (!sIds.has(s)) state.subjects.delete(s);
    for (const s of state.systems) if (!yIds.has(s)) state.systems.delete(s);
    draw();
  }

  function maxCount() {
    return Math.min(cat.available, cat.maxQuestions);
  }

  function checklist(kind, list) {
    const sel = state[kind];
    const all = list.length > 0 && list.every((x) => sel.has(x.id));
    return html`
      <section class="create-section">
        <header>
          <h2>${kind === 'subjects' ? 'Предметы' : 'Системы'}</h2>
          <label class="check small"><input type="checkbox" data-all="${kind}" ${all ? 'checked' : ''}>Выбрать все</label>
        </header>
        ${list.length ? html`
          <div class="checks">
            ${list.map((x) => html`
              <label class="check ${x.count === 0 ? 'zero' : ''}">
                <span><input type="checkbox" data-kind="${kind}" value="${x.id}" ${sel.has(x.id) ? 'checked' : ''}>${x.name}</span>
                <span class="count">${x.count}</span>
              </label>`)}
          </div>
          <p class="small muted" style="margin:10px 0 0">${sel.size ? '' : 'Ничего не выбрано — в тест попадут вопросы из всех разделов.'}</p>`
          : html`<p class="muted">Для этого Step пока нет вопросов.</p>`}
      </section>`;
  }

  function draw() {
    const max = maxCount();
    if (state.count > max) state.count = max;
    if (state.count < 1 && max > 0) state.count = Math.min(10, max);
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Создать тест</h1><p>Соберите блок из нужных разделов. В одном тесте — до ${cat.maxQuestions} вопросов.</p></div>
      </div>
      ${!cat.fullAccess ? html`<div class="notice warn"><p>Сейчас доступны только пробные вопросы. <a href="/app/account">Открыть полную базу</a></p></div>` : ''}
      <form class="create-grid" id="create-form">
        <section class="create-section">
          <header><h2>Экзамен</h2></header>
          <div class="seg" role="radiogroup" aria-label="Step">
            ${Object.entries(cat.steps).map(([k, v]) => html`<label><input type="radio" name="step" value="${k}" ${state.step === k ? 'checked' : ''}><span>${v}</span></label>`)}
          </div>
        </section>

        <section class="create-section">
          <header><h2>Режим</h2></header>
          <div class="seg" role="radiogroup" aria-label="Режим теста">
            <label><input type="radio" name="mode" value="tutor" ${state.mode === 'tutor' ? 'checked' : ''}><span>Tutor</span></label>
            <label><input type="radio" name="mode" value="timed" ${state.mode === 'timed' ? 'checked' : ''}><span>Timed</span></label>
          </div>
          <p class="mode-help">${state.mode === 'tutor'
            ? 'Правильный ответ и объяснение показываются сразу после каждого вопроса. Время не ограничено.'
            : 'Как на экзамене: 90 секунд на вопрос, разбор — после завершения блока.'}</p>
        </section>

        <section class="create-section">
          <header><h2>Статус вопросов</h2><span class="small muted">Можно выбрать несколько</span></header>
          <div class="checks">
            ${STATUS.map(([k, label]) => html`
              <label class="check ${cat.statusCounts[k] === 0 ? 'zero' : ''}">
                <span><input type="checkbox" name="filter" value="${k}" ${state.filters.includes(k) ? 'checked' : ''}>${label}</span>
                <span class="count">${cat.statusCounts[k]}</span>
              </label>`)}
          </div>
          <p class="small muted" style="margin:10px 0 0">${state.filters.length ? '' : 'Ничего не выбрано — в тест попадут вопросы с любым статусом.'}</p>
        </section>

        ${checklist('subjects', cat.subjects)}
        ${checklist('systems', cat.systems)}

        <div class="create-foot">
          <div class="count-input">
            <label for="count" class="label">Количество вопросов</label>
            <input class="input" id="count" name="count" type="number" min="1" max="${max}" value="${state.count}" ${max ? '' : 'disabled'}>
            <span class="small muted">доступно ${qWord(cat.available)}${cat.available > cat.maxQuestions ? `, максимум ${cat.maxQuestions}` : ''}</span>
          </div>
          <button class="btn primary lg" type="submit" ${max ? '' : 'disabled'}>Начать тест</button>
        </div>
      </form>`);
  }

  const changed = () => {
    store.set('createPrefs', { step: state.step, mode: state.mode, filters: state.filters, count: state.count });
    load().catch(toastError);
  };

  on(root, 'change', 'input', (e, el) => {
    if (el.name === 'step') { state.step = el.value; state.subjects.clear(); state.systems.clear(); changed(); }
    else if (el.name === 'mode') { state.mode = el.value; store.set('createPrefs', { ...store.get('createPrefs', {}), mode: state.mode }); draw(); }
    else if (el.name === 'filter') { state.filters = $$('input[name="filter"]:checked', root).map((x) => x.value); changed(); }
    else if (el.dataset.kind) {
      const set = state[el.dataset.kind];
      const v = Number(el.value);
      if (el.checked) set.add(v); else set.delete(v);
      changed();
    } else if (el.dataset.all) {
      const kind = el.dataset.all;
      const list = cat[kind];
      if (el.checked) list.forEach((x) => state[kind].add(x.id)); else state[kind].clear();
      changed();
    } else if (el.name === 'count') {
      state.count = Number(el.value) || 1;
    }
  });

  on(root, 'submit', '#create-form', async (e) => {
    e.preventDefault();
    const btn = $('button[type="submit"]', root);
    const count = Math.max(1, Math.min(maxCount(), Number($('#count', root).value) || 1));
    state.count = count;
    store.set('createPrefs', { step: state.step, mode: state.mode, filters: state.filters, count });
    btn.disabled = true;
    try {
      const res = await api('/api/tests', {
        method: 'POST',
        body: {
          step: state.step,
          mode: state.mode,
          filters: state.filters,
          subjects: [...state.subjects],
          systems: [...state.systems],
          count,
        },
      });
      app.navigate(`/exam/${res.id}`);
    } catch (ex) {
      btn.disabled = false;
      toastError(ex);
    }
  });

  await load();
}
