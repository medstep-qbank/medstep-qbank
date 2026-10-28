import { api, html, on, md, fmtDate, toast, confirmDialog, modal, formData, $ } from '../lib.js';

const GRADES = [
  [0, 'Снова', 'через 10 мин'],
  [1, 'Трудно', ''],
  [2, 'Хорошо', ''],
  [3, 'Легко', ''],
];

function preview(card, grade) {
  // Mirrors the server's simplified SM-2 so buttons can show the next interval.
  if (grade === 0) return 'через 10 мин';
  const reps = card.reps + 1;
  let interval;
  if (reps === 1) interval = grade === 3 ? 4 : 1;
  else if (reps === 2) interval = grade === 1 ? 3 : 6;
  else interval = card.intervalDays * (grade === 1 ? 1.2 : grade === 2 ? 2.5 : 3.25);
  interval = Math.max(1, Math.round(interval));
  return `через ${interval} дн.`;
}

export default async function flashcards(root, { app, query }) {
  app.setTitle('Флеш-карты');
  let data = await api('/api/flashcards');
  let mode = query.get('review') === '1' ? 'review' : 'list';
  let deck = query.get('deck') || '';
  let queue = [];
  let showBack = false;

  const dueCards = () => data.cards.filter((c) => c.dueAt <= new Date().toISOString() && (!deck || c.deck === deck));

  function startReview() {
    queue = dueCards();
    showBack = false;
    mode = 'review';
    draw();
  }

  function drawReview() {
    const c = queue[0];
    if (!c) {
      root.innerHTML = String(html`
        <div class="page-head"><div><h1>Повторение</h1></div></div>
        <div class="panel empty">
          <h2>На сегодня всё</h2>
          <p>Новые карточки появятся, когда подойдёт их срок повторения.</p>
          <button class="btn primary" data-action="list">К списку карточек</button>
        </div>`);
      return;
    }
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Повторение</h1><p>Осталось карточек: ${queue.length}${deck ? `, колода «${deck}»` : ''}</p></div>
        <button class="btn" data-action="list">Завершить</button>
      </div>
      <div class="fc-stage">
        <div class="fc-card">
          <div class="q-text">${md(c.front)}</div>
          ${showBack ? html`<div class="fc-back q-text">${md(c.back)}</div>` : ''}
        </div>
        ${showBack ? html`
          <div class="fc-grades" role="group" aria-label="Насколько легко вспомнили">
            ${GRADES.map(([g, label]) => html`<button class="btn ${g === 2 ? 'primary' : ''}" data-grade="${g}">${label}<small>${preview(c, g)}</small></button>`)}
          </div>
          <p class="small muted" style="text-align:center;margin-top:12px">Клавиши 1–4</p>` : html`
          <div class="row" style="justify-content:center;margin-top:16px"><button class="btn primary lg" data-action="flip">Показать ответ</button></div>
          <p class="small muted" style="text-align:center;margin-top:12px">Пробел — показать ответ</p>`}
      </div>`);
  }

  function drawList() {
    const cards = deck ? data.cards.filter((c) => c.deck === deck) : data.cards;
    const due = dueCards().length;
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Флеш-карты</h1><p>Интервальное повторение: чем лучше вы помните карточку, тем реже она возвращается.</p></div>
        <div class="row">
          <button class="btn" data-action="new">Новая карточка</button>
          <button class="btn primary" data-action="review" ${due ? '' : 'disabled'}>Повторить${due ? ` (${due})` : ''}</button>
        </div>
      </div>
      ${data.decks.length ? html`
        <div class="seg" style="margin-bottom:16px" role="tablist" aria-label="Колоды">
          <button data-deck="" class="${!deck ? 'on' : ''}">Все колоды</button>
          ${data.decks.map((d) => html`<button data-deck="${d.deck}" class="${deck === d.deck ? 'on' : ''}">${d.deck} <span class="muted">${d.due ? `${d.due}/` : ''}${d.total}</span></button>`)}
        </div>` : ''}
      ${cards.length ? html`
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Вопрос</th><th>Колода</th><th>Следующее повторение</th><th></th></tr></thead>
            <tbody>
              ${cards.map((c) => html`
                <tr>
                  <td class="clip">${c.front}</td>
                  <td>${c.deck}</td>
                  <td class="nowrap">${c.dueAt <= new Date().toISOString() ? html`<span class="tag hema">Сегодня</span>` : fmtDate(c.dueAt)}</td>
                  <td class="r nowrap"><button class="btn sm" data-edit="${c.id}">Изменить</button> <button class="btn sm danger" data-del="${c.id}">Удалить</button></td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : html`
        <div class="panel empty">
          <h2>Карточек пока нет</h2>
          <p>Создавайте их из разбора вопросов или вручную — кнопкой «Новая карточка».</p>
        </div>`}`);
  }

  function draw() {
    if (mode === 'review') drawReview(); else drawList();
  }

  function editor(card) {
    modal({
      title: card ? 'Изменить карточку' : 'Новая карточка',
      wide: true,
      body: html`
        <form id="fc">
          <label class="field"><span>Вопрос (лицевая сторона)</span><textarea class="textarea" name="front" rows="3" required>${card?.front || ''}</textarea></label>
          <label class="field"><span>Ответ (оборот)</span><textarea class="textarea" name="back" rows="5" required>${card?.back || ''}</textarea></label>
          <label class="field"><span>Колода</span><input class="input" name="deck" value="${card?.deck || deck || 'Общая'}" maxlength="60" list="decks"></label>
          <datalist id="decks">${data.decks.map((d) => html`<option value="${d.deck}"></option>`)}</datalist>
        </form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сохранить',
          kind: 'primary',
          onClick: async (m) => {
            const body = formData(m.querySelector('#fc'));
            if (card) await api(`/api/flashcards/${card.id}`, { method: 'PUT', body });
            else await api('/api/flashcards', { method: 'POST', body });
            data = await api('/api/flashcards');
            draw();
            toast('Карточка сохранена', 'ok');
          },
        },
      ],
    });
  }

  async function grade(g) {
    const c = queue[0];
    if (!c) return;
    try {
      const res = await api(`/api/flashcards/${c.id}/review`, { method: 'POST', body: { grade: g } });
      Object.assign(c, { dueAt: res.dueAt, intervalDays: res.intervalDays, reps: g === 0 ? 0 : c.reps + 1 });
      queue.shift();
      if (g === 0) queue.push(c); // see it again in this session
      showBack = false;
      draw();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  on(root, 'click', '[data-action]', (_, el) => {
    const a = el.dataset.action;
    if (a === 'review') startReview();
    else if (a === 'list') { mode = 'list'; api('/api/flashcards').then((d) => { data = d; draw(); }); }
    else if (a === 'flip') { showBack = true; draw(); }
    else if (a === 'new') editor(null);
  });
  on(root, 'click', '[data-grade]', (_, el) => grade(Number(el.dataset.grade)));
  on(root, 'click', '[data-deck]', (_, el) => { deck = el.dataset.deck; draw(); });
  on(root, 'click', '[data-edit]', (_, el) => editor(data.cards.find((c) => c.id === Number(el.dataset.edit))));
  on(root, 'click', '[data-del]', async (_, el) => {
    const id = Number(el.dataset.del);
    if (!(await confirmDialog('Карточка будет удалена.', { title: 'Удалить карточку?', ok: 'Удалить', danger: true }))) return;
    await api(`/api/flashcards/${id}`, { method: 'DELETE' });
    data = await api('/api/flashcards');
    draw();
  });

  const onKey = (e) => {
    if (mode !== 'review' || e.target.closest('input, textarea') || $('.modal-back')) return;
    if (!showBack && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); showBack = true; draw(); }
    else if (showBack && /^[1-4]$/.test(e.key)) { e.preventDefault(); grade(Number(e.key) - 1); }
  };
  document.addEventListener('keydown', onKey);

  if (mode === 'review') startReview(); else draw();
  return () => document.removeEventListener('keydown', onKey);
}
