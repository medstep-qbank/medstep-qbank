import { api, html, icon, $, on, store, toast, toastError, modal, confirmDialog, fmtClock, LETTERS, toggleTheme, currentTheme, formData } from '../lib.js';
import { questionHtml, resultBanner, explanationHtml, applyHighlights, selectionOffsets, mergeRanges } from './question.js';
import { LABS } from '../labs.js';

const FONT_SIZES = [15, 17, 19, 21];
const SAVE_EVERY_MS = 20_000;

export default async function exam(root, { params, query, app }) {
  const id = Number(params.id);
  const { test, items } = await api(`/api/tests/${id}`);
  const n = items.length;
  const isDone = () => test.status === 'completed';
  const clamp = (i) => Math.min(n - 1, Math.max(0, Number.isFinite(i) ? i : 0));

  let idx = clamp(query.get('q') != null ? Number(query.get('q')) : test.currentIndex);
  const draft = new Map(); // tutor: chosen but not yet submitted
  let sessionStart = performance.now();
  let itemStart = performance.now();
  let finishing = false;
  let fontStep = store.get('examFont', 1);
  let hlOn = store.get('examHl', true);
  let drawer = null;
  let calc = null;

  app.setTitle(`${test.name} — вопрос ${idx + 1}`);
  if (test.status === 'suspended') {
    test.status = 'active';
    api(`/api/tests/${id}/state`, { method: 'POST', body: { currentIndex: idx, timeUsed: test.timeUsed } }).catch(() => {});
  }

  /* ---------- time ---------- */
  const elapsed = () => (isDone() ? test.timeUsed : test.timeUsed + (performance.now() - sessionStart) / 1000);
  const countsTime = (it) => !isDone() && !(test.mode === 'tutor' && it.submitted);

  function commitItemTime() {
    const it = items[idx];
    const now = performance.now();
    if (countsTime(it)) {
      const delta = Math.round((now - itemStart) / 1000);
      if (delta > 0) {
        it.timeSpent += delta;
        api(`/api/tests/${id}/items/${it.position}`, { method: 'POST', body: { timeSpent: it.timeSpent } }).catch(() => {});
      }
    }
    itemStart = now;
  }

  function saveState(extra = {}, opts = {}) {
    if (isDone()) {
      return api(`/api/tests/${id}/state`, { method: 'POST', body: { currentIndex: idx }, ...opts }).catch(() => {});
    }
    return api(`/api/tests/${id}/state`, {
      method: 'POST',
      body: { currentIndex: idx, timeUsed: Math.floor(elapsed()), ...extra },
      ...opts,
    });
  }

  /* ---------- frame ---------- */
  root.innerHTML = String(html`
    <div class="exam" id="exam" data-mode="${test.mode}">
      <header class="exam-top" id="exam-top"></header>
      <nav class="exam-nav" aria-label="Вопросы блока"><ol id="exam-nav"></ol></nav>
      <main class="exam-main" id="exam-main" tabindex="-1"></main>
      <footer class="exam-bottom">
        <div class="row">
          ${isDone()
            ? html`<a class="btn sm" href="/app/tests/${id}">К результатам теста</a>`
            : html`<button class="btn sm" data-action="suspend">${icon('pause')}Прервать</button>`}
        </div>
        <div class="row">
          ${app.meta.demo ? html`<span class="small" style="opacity:.8">Демо</span>` : ''}
          <span class="small" id="exam-mode">${test.mode === 'timed' ? 'Режим Timed' : 'Режим Tutor'}${isDone() ? ', разбор' : ''}</span>
          ${isDone() ? '' : html`<button class="btn sm" data-action="end">${icon('stop')}Завершить блок</button>`}
        </div>
      </footer>
    </div>`);

  const examEl = $('#exam', root);
  const top = $('#exam-top', root);
  const nav = $('#exam-nav', root);
  const main = $('#exam-main', root);
  const applyFont = () => examEl.style.setProperty('--exam-size', `${FONT_SIZES[fontStep]}px`);
  applyFont();

  const currentSelected = (it) => (test.mode === 'tutor' && !it.submitted && !isDone() ? (draft.get(it.position) ?? null) : it.selected);

  function renderTop() {
    const it = items[idx];
    top.innerHTML = String(html`
      <div class="exam-pos"><b><span class="pos-long">Вопрос ${idx + 1} из ${n}</span><span class="pos-short">${idx + 1}/${n}</span></b><small>ID ${it.questionId}</small></div>
      <button class="exam-mark ${it.marked ? 'on' : ''}" data-action="mark" aria-pressed="${it.marked ? 'true' : 'false'}" title="Отметить (M)">${icon('flag')}<span>${it.marked ? 'Отмечен' : 'Отметить'}</span></button>
      <div class="exam-arrows">
        <button class="icon-btn" data-action="prev" aria-label="Предыдущий вопрос" ${idx === 0 ? 'disabled' : ''}>${icon('left')}</button>
        <button class="icon-btn" data-action="next" aria-label="Следующий вопрос" ${idx === n - 1 ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <div class="exam-tools">
        <button class="exam-tool opt-hide ${hlOn ? 'on' : ''}" data-action="hl" aria-pressed="${hlOn ? 'true' : 'false'}" title="Выделяйте текст условия мышью">${icon('highlighter')}<span>Маркер</span></button>
        <button class="exam-tool" data-action="labs">${icon('flask')}<span>Нормы</span></button>
        <button class="exam-tool opt-hide" data-action="calc">${icon('calc')}<span>Калькулятор</span></button>
        <button class="exam-tool opt-hide" data-action="font" title="Размер шрифта">${icon('textsize')}<span>Шрифт</span></button>
        <button class="exam-tool" data-action="theme">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}<span>Тема</span></button>
      </div>
      <div class="exam-timer" id="exam-timer" aria-live="off"></div>`);
    tick();
  }

  function renderNav() {
    nav.innerHTML = String(html`${items.map((it, i) => {
      const cls = [];
      if (i === idx) cls.push('current');
      const sel = currentSelected(it);
      if (it.revealed) cls.push(it.selected == null ? '' : it.selected === it.correct ? 'is-ok' : 'is-bad');
      else if (sel != null) cls.push('answered');
      const state = it.revealed
        ? (it.selected == null ? 'без ответа' : it.selected === it.correct ? 'верно' : 'неверно')
        : (sel != null ? 'ответ выбран' : 'без ответа');
      return html`<li><button data-go="${i}" class="${cls.join(' ')}" aria-label="Вопрос ${i + 1}, ${state}${it.marked ? ', отмечен' : ''}" ${i === idx ? html`aria-current="true"` : ''}>${i + 1}${it.marked ? html`<span class="nav-flag">${icon('flag')}</span>` : ''}</button></li>`;
    })}`);
    nav.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }

  function renderMain({ keepScroll = false } = {}) {
    const it = items[idx];
    const scroll = main.scrollTop;
    const sel = currentSelected(it);
    const locked = it.revealed || isDone();
    main.innerHTML = String(html`
      <article class="exam-q">
        ${questionHtml(it, { selected: sel, strikes: it.strikes, locked })}
        ${!locked && test.mode === 'tutor' ? html`
          <div class="exam-actions">
            <button class="btn primary" data-action="submit" ${sel == null ? 'disabled' : ''}>Ответить</button>
            <span class="exam-hint">Клавиши A–${LETTERS[it.options.length - 1]} выбирают ответ, Enter — ответить. Правый клик по варианту зачёркивает его.</span>
          </div>` : ''}
        ${!locked && test.mode === 'timed' ? html`
          <div class="exam-actions"><span class="exam-hint">Ответ сохраняется сразу. Разбор будет доступен после завершения блока. Правый клик по варианту зачёркивает его.</span></div>` : ''}
        ${it.revealed ? html`${resultBanner(it, it)}${explanationHtml(it)}` : ''}
      </article>`);
    const hlRoot = main.querySelector('[data-hl-root]');
    applyHighlights(hlRoot, it.highlights);
    main.scrollTop = keepScroll ? scroll : 0;
  }

  function renderAll(opts) {
    renderTop();
    renderNav();
    renderMain(opts);
    app.setTitle(`${test.name} — вопрос ${idx + 1}`);
  }

  function go(i) {
    i = clamp(i);
    if (i === idx) return;
    commitItemTime();
    idx = i;
    history.replaceState(null, '', `/exam/${id}?q=${idx}`);
    renderAll();
    main.focus({ preventScroll: true });
    saveStateSoon();
  }

  let saveTimer = null;
  function saveStateSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState().catch(() => {}), 800);
  }

  /* ---------- actions ---------- */
  async function select(i) {
    const it = items[idx];
    if (it.revealed || isDone()) return;
    if (test.mode === 'tutor') {
      draft.set(it.position, i);
      renderMain({ keepScroll: true });
      renderNav();
      return;
    }
    const prev = it.selected;
    it.selected = i;
    renderMain({ keepScroll: true });
    renderNav();
    try {
      await api(`/api/tests/${id}/answer`, { method: 'POST', body: { position: it.position, selected: i, timeSpent: it.timeSpent } });
    } catch (e) {
      it.selected = prev;
      renderMain({ keepScroll: true });
      renderNav();
      toastError(e);
    }
  }

  async function submit() {
    const it = items[idx];
    const sel = draft.get(it.position);
    if (sel == null) { toast('Сначала выберите вариант ответа'); return; }
    commitItemTime();
    const btn = main.querySelector('[data-action="submit"]');
    if (btn) btn.disabled = true;
    try {
      const res = await api(`/api/tests/${id}/answer`, { method: 'POST', body: { position: it.position, selected: sel, timeSpent: it.timeSpent } });
      Object.assign(it, res.item);
      draft.delete(it.position);
      renderMain({ keepScroll: true });
      renderNav();
      main.querySelector('.q-result')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (e) {
      if (btn) btn.disabled = false;
      toastError(e);
    }
  }

  function toggleStrike(i) {
    const it = items[idx];
    const s = new Set(it.strikes);
    if (s.has(i)) s.delete(i); else s.add(i);
    it.strikes = [...s];
    renderMain({ keepScroll: true });
    api(`/api/tests/${id}/items/${it.position}`, { method: 'POST', body: { strikes: it.strikes } }).catch(toastError);
  }

  function toggleMark() {
    const it = items[idx];
    it.marked = !it.marked;
    renderTop();
    renderNav();
    api(`/api/tests/${id}/items/${it.position}`, { method: 'POST', body: { marked: it.marked } }).catch(toastError);
  }

  function saveHighlights() {
    const it = items[idx];
    api(`/api/tests/${id}/items/${it.position}`, { method: 'POST', body: { highlights: it.highlights } }).catch(toastError);
  }

  async function finish(auto = false) {
    if (finishing) return;
    finishing = true;
    commitItemTime();
    try {
      await api(`/api/tests/${id}/finish`, { method: 'POST', body: { timeUsed: Math.floor(elapsed()) } });
      test.status = 'completed';
      if (auto) toast('Время блока вышло — тест завершён');
      app.navigate(`/app/tests/${id}`);
    } catch (e) {
      finishing = false;
      toastError(e);
    }
  }

  async function endBlock() {
    const unanswered = items.filter((it) => (test.mode === 'tutor' ? !it.submitted : currentSelected(it) == null)).length;
    const marked = items.filter((it) => it.marked).length;
    const parts = [];
    if (unanswered) parts.push(`без ответа: ${unanswered}`);
    if (marked) parts.push(`отмечено: ${marked}`);
    const ok = await confirmDialog(
      `${parts.length ? `Вопросов ${parts.join(', ')}. ` : ''}После завершения ответы изменить нельзя, откроется разбор.`,
      { title: 'Завершить блок?', ok: 'Завершить блок' },
    );
    if (ok) finish();
  }

  async function suspend() {
    commitItemTime();
    try {
      await saveState({ suspend: true });
      test.status = 'suspended';
      finishing = true;
      toast('Тест сохранён. Продолжите его из раздела «Мои тесты».');
      app.navigate('/app/tests');
    } catch (e) {
      toastError(e);
    }
  }

  /* ---------- drawers ---------- */
  function closeDrawer() {
    drawer?.remove();
    drawer = null;
  }

  function openDrawer(title, body, onMount) {
    closeDrawer();
    drawer = document.createElement('aside');
    drawer.className = 'drawer';
    drawer.setAttribute('aria-label', title);
    drawer.innerHTML = String(html`
      <header class="drawer-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Закрыть">${icon('x')}</button></header>
      <div class="drawer-body">${body}</div>`);
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer);
    document.body.append(drawer);
    onMount?.(drawer);
    drawer.querySelector('input, textarea, button:not([data-close])')?.focus();
  }

  function openLabs(tab = LABS[0].id) {
    if (drawer?.dataset.kind === 'labs' && drawer.dataset.tab === tab) { closeDrawer(); return; }
    const t = LABS.find((l) => l.id === tab) || LABS[0];
    openDrawer('Лабораторные нормы', html`
      <div class="labs-tabs seg" role="tablist">
        ${LABS.map((l) => html`<button role="tab" data-tab="${l.id}" class="${l.id === t.id ? 'on' : ''}" aria-selected="${l.id === t.id ? 'true' : 'false'}">${l.title}</button>`)}
      </div>
      <input class="input" type="search" placeholder="Поиск показателя" id="labs-q" style="margin-bottom:8px">
      <table class="labs-table"><tbody>
        ${t.rows.map((r) => (typeof r === 'string'
          ? html`<tr class="group"><td colspan="2">${r}</td></tr>`
          : html`<tr data-name="${r[0].toLowerCase()}"><td>${r[0]}</td><td>${r[1]}</td></tr>`))}
      </tbody></table>`, (d) => {
      d.dataset.kind = 'labs';
      d.dataset.tab = t.id;
      d.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { closeDrawer(); openLabs(b.dataset.tab); }));
      const q = d.querySelector('#labs-q');
      q.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        d.querySelectorAll('tr[data-name]').forEach((tr) => { tr.hidden = v && !tr.dataset.name.includes(v); });
        d.querySelectorAll('tr.group').forEach((tr) => { tr.hidden = Boolean(v); });
      });
    });
  }

  function openNote() {
    const it = items[idx];
    openDrawer(`Заметка к вопросу ${it.questionId}`, html`
      <form id="note-form">
        <label class="field"><span>Текст заметки</span>
          <textarea class="textarea" name="body" rows="12" maxlength="20000" placeholder="Ключевые выводы, ассоциации, что запомнить">${it.note || ''}</textarea>
        </label>
        <div class="row end">
          <button class="btn primary" type="submit">Сохранить заметку</button>
        </div>
        <p class="small muted">Все заметки собраны в разделе «Заметки». Чтобы удалить заметку, очистите текст и сохраните.</p>
      </form>`, (d) => {
      d.querySelector('#note-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = formData(e.target).body;
        try {
          await api(`/api/notes/question/${it.questionId}`, { method: 'PUT', body: { body } });
          it.note = body.trim();
          toast(it.note ? 'Заметка сохранена' : 'Заметка удалена', 'ok');
          closeDrawer();
          renderMain({ keepScroll: true });
        } catch (ex) { toastError(ex); }
      });
    });
  }

  function openFlashcard() {
    const it = items[idx];
    const front = it.topic ? `${it.topic}: ключевой вывод?` : it.leadIn;
    modal({
      title: 'Новая флеш-карта',
      wide: true,
      body: html`
        <form id="fc-form">
          <label class="field"><span>Вопрос (лицевая сторона)</span><textarea class="textarea" name="front" rows="3" required>${front}</textarea></label>
          <label class="field"><span>Ответ (оборот)</span><textarea class="textarea" name="back" rows="5" required>${it.objective || ''}</textarea></label>
          <label class="field"><span>Колода</span><input class="input" name="deck" value="${it.subject || 'Общая'}" maxlength="60"></label>
        </form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Создать карточку',
          kind: 'primary',
          onClick: async (m) => {
            const d = formData(m.querySelector('#fc-form'));
            await api('/api/flashcards', { method: 'POST', body: { ...d, questionId: it.questionId } });
            it.hasFlashcard = true;
            toast('Флеш-карта добавлена', 'ok');
            renderMain({ keepScroll: true });
          },
        },
      ],
    });
  }

  /* ---------- calculator ---------- */
  function toggleCalc() {
    if (calc) { calc.remove(); calc = null; return; }
    calc = document.createElement('aside');
    calc.className = 'drawer calc';
    calc.setAttribute('aria-label', 'Калькулятор');
    const keys = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '⌫', '='];
    calc.innerHTML = String(html`
      <header class="drawer-head"><h2>Калькулятор</h2><button class="icon-btn" data-close aria-label="Закрыть">${icon('x')}</button></header>
      <div class="drawer-body">
        <input class="calc-screen" id="calc-screen" inputmode="decimal" aria-label="Выражение" autocomplete="off">
        <div class="calc-keys">${keys.map((k) => html`<button data-k="${k}" class="${'÷×−+()'.includes(k) ? 'op' : k === '=' ? 'eq' : ''}">${k}</button>`)}</div>
      </div>`);
    document.body.append(calc);
    const screen = calc.querySelector('#calc-screen');
    calc.querySelector('[data-close]').addEventListener('click', () => { calc.remove(); calc = null; });
    calc.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'C') screen.value = '';
      else if (k === '⌫') screen.value = screen.value.slice(0, -1);
      else if (k === '=') screen.value = evaluate(screen.value);
      else screen.value += k;
      screen.focus();
    }));
    screen.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); screen.value = evaluate(screen.value); }
      e.stopPropagation();
    });
    screen.focus();
  }

  /* ---------- events ---------- */
  const offs = [];
  offs.push(on(root, 'click', '[data-opt]', (_, el) => select(Number(el.dataset.opt))));
  offs.push(on(root, 'contextmenu', '[data-opt]', (e, el) => {
    e.preventDefault();
    if (!items[idx].revealed) toggleStrike(Number(el.dataset.opt));
  }));
  offs.push(on(root, 'click', '[data-go]', (_, el) => go(Number(el.dataset.go))));
  offs.push(on(root, 'click', '[data-action]', (e, el) => {
    const a = el.dataset.action;
    if (a === 'prev') go(idx - 1);
    else if (a === 'next') go(idx + 1);
    else if (a === 'mark') toggleMark();
    else if (a === 'submit') submit();
    else if (a === 'end') endBlock();
    else if (a === 'suspend') suspend();
    else if (a === 'labs') openLabs();
    else if (a === 'calc') toggleCalc();
    else if (a === 'note') openNote();
    else if (a === 'flashcard') openFlashcard();
    else if (a === 'theme') { toggleTheme(); renderTop(); }
    else if (a === 'font') {
      fontStep = (fontStep + 1) % FONT_SIZES.length;
      store.set('examFont', fontStep);
      applyFont();
    } else if (a === 'hl') {
      hlOn = !hlOn;
      store.set('examHl', hlOn);
      renderTop();
      toast(hlOn ? 'Маркер включён: выделите текст условия' : 'Маркер выключен');
    }
  }));
  offs.push(on(main, 'mouseup', '[data-hl-root]', (_, hlRoot) => {
    if (!hlOn) return;
    const r = selectionOffsets(hlRoot);
    if (!r) return;
    const it = items[idx];
    it.highlights = mergeRanges([...(it.highlights || []), r]);
    window.getSelection().removeAllRanges();
    renderMain({ keepScroll: true });
    saveHighlights();
  }));
  offs.push(on(main, 'click', 'mark.hl', (e, m) => {
    if (!window.getSelection().isCollapsed) return;
    const it = items[idx];
    const merged = mergeRanges(it.highlights || []);
    merged.splice(Number(m.dataset.r), 1);
    it.highlights = merged;
    renderMain({ keepScroll: true });
    saveHighlights();
  }));

  function onKey(e) {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal-back')) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const it = items[idx];
    const m = /^Key([A-J])$/.exec(e.code);
    if (m && m[1] !== 'M') {
      const i = LETTERS.indexOf(m[1]);
      if (i < it.options.length) { e.preventDefault(); select(i); }
      return;
    }
    if (e.code === 'KeyM') { e.preventDefault(); toggleMark(); }
    else if (e.key === 'ArrowRight' || e.code === 'KeyN') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.code === 'KeyP') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Enter') {
      if (e.target.closest('button, a')) return;
      e.preventDefault();
      if (test.mode === 'tutor' && !it.submitted && !isDone()) submit();
      else go(idx + 1);
    }
  }
  document.addEventListener('keydown', onKey);

  /* ---------- timer ---------- */
  function tick() {
    const el = document.getElementById('exam-timer');
    if (!el) return;
    if (isDone()) {
      el.innerHTML = String(html`<small>Время блока</small><b>${fmtClock(test.timeUsed)}</b>`);
      return;
    }
    if (test.mode === 'timed' && test.timeLimit) {
      const left = test.timeLimit - elapsed();
      el.classList.toggle('low', left < 300);
      el.innerHTML = String(html`<small>Осталось</small><b>${fmtClock(left)}</b>`);
      if (left <= 0) finish(true);
    } else {
      el.innerHTML = String(html`<small>Время блока</small><b>${fmtClock(elapsed())}</b>`);
    }
  }
  const tickTimer = setInterval(tick, 1000);
  const saveTimerId = setInterval(() => {
    if (isDone() || finishing) return;
    commitItemTime();
    saveState().catch(() => {});
  }, SAVE_EVERY_MS);

  const onHide = () => {
    if (isDone() || finishing) return;
    commitItemTime();
    saveState({}, { keepalive: true }).catch(() => {});
  };
  window.addEventListener('pagehide', onHide);
  const onVisibility = () => { if (document.visibilityState === 'hidden') onHide(); };
  document.addEventListener('visibilitychange', onVisibility);

  renderAll();
  main.focus({ preventScroll: true });
  if (!isDone() && test.mode === 'timed' && test.timeLimit && elapsed() >= test.timeLimit) finish(true);

  return async () => {
    clearInterval(tickTimer);
    clearInterval(saveTimerId);
    clearTimeout(saveTimer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    offs.forEach((f) => f());
    closeDrawer();
    calc?.remove();
    if (!isDone() && !finishing) {
      commitItemTime();
      await saveState().catch(() => {});
    }
    sessionStart = performance.now();
  };
}

/* Safe arithmetic evaluator (no eval): + − × ÷, parentheses, unary minus, decimals. */
function evaluate(src) {
  const s = src.replace(/\s+/g, '').replace(/,/g, '.').replace(/×|\*/g, '×').replace(/÷|\//g, '÷').replace(/−|-/g, '−');
  if (!s) return '';
  const tokens = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = Number(s.slice(i, j));
      if (!Number.isFinite(num)) return 'Ошибка';
      tokens.push(num);
      i = j;
    } else if ('+−×÷()'.includes(c)) { tokens.push(c); i++; }
    else return 'Ошибка';
  }
  let pos = 0;
  const peek = () => tokens[pos];
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '−') { const op = tokens[pos++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '×' || peek() === '÷') { const op = tokens[pos++]; const r = factor(); v = op === '×' ? v * r : v / r; }
    return v;
  }
  function factor() {
    const t = tokens[pos++];
    if (t === '−') return -factor();
    if (t === '+') return factor();
    if (t === '(') { const v = expr(); if (tokens[pos++] !== ')') throw new Error('paren'); return v; }
    if (typeof t === 'number') return t;
    throw new Error('syntax');
  }
  try {
    const v = expr();
    if (pos !== tokens.length || !Number.isFinite(v)) return 'Ошибка';
    return String(Number(v.toPrecision(12)));
  } catch {
    return 'Ошибка';
  }
}
