import { api, html, icon, on, fmtClock, fmtDate, pct } from '../lib.js';

const STEP = { step1: 'Step 1', step2: 'Step 2 CK', step3: 'Step 3' };

function ring(value) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return html`
    <svg class="score-ring" viewBox="0 0 132 132" role="img" aria-label="Результат ${v}%">
      <circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
      <circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--hema)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 66 66)"/>
      <text x="66" y="70" text-anchor="middle">${v}%</text>
      <text x="66" y="92" text-anchor="middle" class="sub">верно</text>
    </svg>`;
}

export default async function result(root, { params, app }) {
  const id = Number(params.id);
  const { test, items } = await api(`/api/tests/${id}`);
  if (test.status !== 'completed') {
    app.navigate(`/exam/${id}`, { replace: true });
    return;
  }
  app.setTitle(`${test.name}: результаты`);
  const correct = items.filter((i) => i.isCorrect === true).length;
  const incorrect = items.filter((i) => i.isCorrect === false).length;
  const omitted = items.filter((i) => i.selected == null).length;
  const score = pct(correct, items.length);
  const peerVals = items.filter((i) => i.peers?.total).map((i) => (i.peers.byOption[i.correct] || 0) / i.peers.total);
  const peerAvg = peerVals.length ? Math.round((peerVals.reduce((a, b) => a + b, 0) / peerVals.length) * 100) : null;
  const avgTime = items.length ? Math.round(items.reduce((a, b) => a + b.timeSpent, 0) / items.length) : 0;

  root.innerHTML = String(html`
    <div class="page-head">
      <div>
        <h1>${test.name}</h1>
        <p>${STEP[test.step]}, режим ${test.mode === 'timed' ? 'Timed' : 'Tutor'}, завершён ${fmtDate(test.completedAt, true)}</p>
      </div>
      <div class="row">
        <a class="btn" href="/app/tests">Все тесты</a>
        <a class="btn primary" href="/exam/${id}?q=0">Разбор вопросов</a>
      </div>
    </div>

    <section class="panel">
      <div class="score-head">
        ${ring(score)}
        <div class="kpis">
          <div class="kpi"><b>${correct}</b><span>верно</span></div>
          <div class="kpi"><b>${incorrect}</b><span>неверно</span></div>
          <div class="kpi"><b>${omitted}</b><span>без ответа</span></div>
          <div class="kpi"><b>${peerAvg == null ? '—' : `${peerAvg}%`}</b><span>в среднем у других</span></div>
          <div class="kpi"><b>${fmtClock(avgTime)}</b><span>на вопрос в среднем</span></div>
          <div class="kpi"><b>${fmtClock(test.timeUsed)}</b><span>время блока</span></div>
        </div>
      </div>
    </section>

    <h2 style="margin-top:32px">Вопросы</h2>
    <div class="table-wrap">
      <table class="data">
        <thead><tr><th>№</th><th></th><th>Предмет</th><th>Система</th><th>Тема</th><th class="r">Верно у других</th><th class="r">Время</th></tr></thead>
        <tbody>
          ${items.map((it) => {
            const state = it.selected == null ? 'omit' : it.isCorrect ? 'ok' : 'bad';
            const peers = it.peers?.total ? `${Math.round(((it.peers.byOption[it.correct] || 0) / it.peers.total) * 100)}%` : '—';
            return html`
              <tr class="clickable" data-pos="${it.position}" tabindex="0">
                <td class="num">${it.position + 1}${it.marked ? html` <span class="flag-mark" title="Отмечен">${icon('flag')}</span>` : ''}</td>
                <td><span class="result-icon ${state}" title="${state === 'ok' ? 'Верно' : state === 'bad' ? 'Неверно' : 'Без ответа'}">${icon(state === 'ok' ? 'check' : state === 'bad' ? 'x' : 'clock')}</span><span class="visually-hidden">${state === 'ok' ? 'Верно' : state === 'bad' ? 'Неверно' : 'Без ответа'}</span></td>
                <td>${it.subject || '—'}</td>
                <td>${it.system || '—'}</td>
                <td class="clip">${it.topic || ''}</td>
                <td class="r num">${peers}</td>
                <td class="r num">${fmtClock(it.timeSpent)}</td>
              </tr>`;
          })}
        </tbody>
      </table>
    </div>`);

  const open = (el) => app.navigate(`/exam/${id}?q=${el.dataset.pos}`);
  on(root, 'click', 'tr[data-pos]', (_, el) => open(el));
  on(root, 'keydown', 'tr[data-pos]', (e, el) => { if (e.key === 'Enter') open(el); });
}
