import { api, html, raw, on, fmtClock, fmtDate, confirmDialog, modal, toast, formData } from '../lib.js';

const STEPS = [['', 'Все Step'], ['step1', 'Step 1'], ['step2', 'Step 2 CK'], ['step3', 'Step 3']];

function bars(rows) {
  if (!rows.length) return html`<p class="muted">Нет данных — решите хотя бы один тест.</p>`;
  const sorted = [...rows].sort((a, b) => (a.correct / a.used) - (b.correct / b.used));
  return html`
    <div class="bars">
      ${sorted.map((r) => {
        const p = r.used ? Math.round((r.correct / r.used) * 100) : 0;
        return html`
          <div class="bar-row" title="${r.name}: верно ${r.correct}, неверно ${r.incorrect}, без ответа ${r.omitted}">
            <span class="name">${r.name}</span>
            <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${p}%"></span></span>
            <span class="val"><b>${p}%</b> из ${r.used}</span>
          </div>`;
      })}
    </div>
    <p class="small muted" style="margin:12px 0 0">Доля верных ответов по последней попытке. Сначала — самые слабые разделы.</p>`;
}

function historyChart(tests, peerAvg) {
  if (tests.length < 2) return html`<p class="muted">График появится после двух завершённых тестов.</p>`;
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (tests.length === 1 ? iw / 2 : (i / (tests.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / 100) * ih;
  const pts = tests.map((t, i) => [x(i), y(t.percent)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100];
  const step = Math.max(1, Math.ceil(tests.length / 8));
  return html`
    <svg class="chart-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="Результаты тестов по порядку, в процентах">
      ${raw(grid.map((g) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(g)}" y2="${y(g)}"/><text class="axis" x="${pad.l - 8}" y="${y(g) + 4}" text-anchor="end">${g}</text>`).join(''))}
      ${peerAvg != null ? raw(`<line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${y(peerAvg)}" y2="${y(peerAvg)}"/>`) : ''}
      ${raw(tests.map((t, i) => (i % step === 0 || i === tests.length - 1 ? `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>` : '')).join(''))}
      <path class="line" d="${d}"/>
      ${raw(pts.map((p, i) => `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="4"/><rect class="hit" data-i="${i}" x="${p[0] - Math.max(8, iw / tests.length / 2)}" y="${pad.t}" width="${Math.max(16, iw / tests.length)}" height="${ih}"/>`).join(''))}
    </svg>
    <div class="legend"><span><i style="background:var(--hema)"></i>Ваш результат, %</span>${peerAvg != null ? html`<span><i style="background:var(--muted);height:2px"></i>Среднее по пользователям</span>` : ''}</div>`;
}

export default async function stats(root, { app, query }) {
  app.setTitle('Статистика');
  let step = query.get('step') || '';
  let data;

  async function load() {
    data = await api(`/api/stats${step ? `?step=${step}` : ''}`);
    draw();
  }

  function draw() {
    const s = data;
    const t = s.correct + s.incorrect + s.omitted;
    const w = (v) => (t ? (v / t) * 100 : 0);
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Статистика</h1><p>Сильные и слабые разделы по вашим последним ответам.</p></div>
        <div class="seg" role="tablist" aria-label="Step">
          ${STEPS.map(([k, v]) => html`<button role="tab" data-step="${k}" class="${step === k ? 'on' : ''}" aria-selected="${step === k ? 'true' : 'false'}">${v}</button>`)}
        </div>
      </div>

      <section class="panel">
        <div class="kpis">
          <div class="kpi"><b>${s.percentCorrect == null ? '—' : `${s.percentCorrect}%`}</b><span>верных ответов</span></div>
          <div class="kpi"><b>${s.peerAverage == null ? '—' : `${s.peerAverage}%`}</b><span>в среднем у пользователей</span></div>
          <div class="kpi"><b>${s.used} / ${s.totalQuestions}</b><span>вопросов использовано</span></div>
          <div class="kpi"><b>${s.avgTimePerQuestion == null ? '—' : fmtClock(s.avgTimePerQuestion)}</b><span>в среднем на вопрос</span></div>
          <div class="kpi"><b>${s.marked}</b><span>отмечено</span></div>
        </div>
        ${t ? html`
          <div style="margin-top:24px">
            <div class="split" role="img" aria-label="Верно ${s.correct}, неверно ${s.incorrect}, без ответа ${s.omitted}">
              ${s.correct ? html`<span class="s-ok" style="width:${w(s.correct)}%"></span>` : ''}
              ${s.incorrect ? html`<span class="s-bad" style="width:${w(s.incorrect)}%"></span>` : ''}
              ${s.omitted ? html`<span class="s-omit" style="width:${w(s.omitted)}%"></span>` : ''}
            </div>
            <div class="legend">
              <span><i style="background:var(--ok)"></i>Верно: ${s.correct}</span>
              <span><i style="background:var(--bad)"></i>Неверно: ${s.incorrect}</span>
              <span><i style="background:var(--line-strong)"></i>Без ответа: ${s.omitted}</span>
            </div>
          </div>` : ''}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Результаты тестов</h2><span class="small muted">${s.testsCompleted} завершено</span></div>
        <div id="chart">${historyChart(s.tests, s.peerAverage)}</div>
      </section>

      <div class="grid-2" style="margin-top:16px">
        <section class="panel"><div class="panel-head"><h2>По предметам</h2></div>${bars(s.subjects)}</section>
        <section class="panel" style="margin-top:0"><div class="panel-head"><h2>По системам</h2></div>${bars(s.systems)}</section>
      </div>

      <section class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>Начать заново</h2></div>
        <p class="muted">Сброс удалит все тесты и статистику, вопросы снова станут неиспользованными. Заметки и флеш-карты сохранятся.</p>
        <button class="btn danger" data-action="reset">Сбросить прогресс</button>
      </section>`);
  }

  // tooltip for the history chart
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  document.body.append(tip);
  on(root, 'mousemove', '.hit', (e, el) => {
    const t = data.tests[Number(el.dataset.i)];
    tip.innerHTML = String(html`<b>${t.name}</b><br>${t.percent}% (${t.correct} из ${t.total})<br>${fmtDate(t.completedAt)}`);
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 250)}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  on(root, 'mouseout', '.hit', () => { tip.hidden = true; });
  on(root, 'click', '.hit', (_, el) => app.navigate(`/app/tests/${data.tests[Number(el.dataset.i)].id}`));

  on(root, 'click', '[data-step]', (_, el) => {
    step = el.dataset.step;
    history.replaceState(null, '', step ? `/app/stats?step=${step}` : '/app/stats');
    load();
  });

  on(root, 'click', '[data-action="reset"]', async () => {
    const go = await confirmDialog('Все тесты и статистика будут удалены без возможности восстановления.', { title: 'Сбросить прогресс?', ok: 'Продолжить', danger: true });
    if (!go) return;
    modal({
      title: 'Подтвердите сброс',
      body: html`<form id="rs"><label class="field"><span>Введите слово СБРОСИТЬ</span><input class="input" name="confirm" autocomplete="off"></label></form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сбросить прогресс',
          kind: 'danger',
          onClick: async (m) => {
            await api('/api/progress/reset', { method: 'POST', body: formData(m.querySelector('#rs')) });
            toast('Прогресс сброшен', 'ok');
            await load();
          },
        },
      ],
    });
  });

  await load();
  return () => tip.remove();
}
