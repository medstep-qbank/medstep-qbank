import { api, html, fmtDate, qWord, pct } from '../lib.js';

export default async function dashboard(root, { app }) {
  app.setTitle('Главная');
  const [stats, tests, cards] = await Promise.all([
    api('/api/stats'),
    api('/api/tests'),
    api('/api/flashcards?due=1').catch(() => ({ cards: [] })),
  ]);
  const u = app.user;
  const open = tests.find((t) => t.status !== 'completed');
  const recent = tests.filter((t) => t.status === 'completed').slice(0, 5);
  const usedPct = pct(stats.used, stats.totalQuestions);
  const first = u.name.split(' ')[0];
  const due = cards.cards.length;

  root.innerHTML = String(html`
    <div class="page-head">
      <div>
        <h1>Здравствуйте, ${first}</h1>
        <p>${stats.used ? `Вы решили ${qWord(stats.used)} из ${stats.totalQuestions}.` : 'Начните с короткого теста на 10 вопросов в режиме Tutor.'}</p>
      </div>
      <a class="btn primary" href="/app/create">Создать тест</a>
    </div>

    ${!u.hasAccess ? html`
      <div class="notice warn">
        <p><b>У вас пробный доступ.</b> ${app.meta.settings.trial_note} <a href="/app/account">Выбрать тариф</a></p>
      </div>` : u.accessUntil && u.role === 'student' ? html`
      <p class="small muted">Доступ открыт до ${fmtDate(u.accessUntil)}.</p>` : ''}

    ${open ? html`
      <div class="resume">
        <div>
          <b>${open.status === 'suspended' ? 'Прерванный тест' : 'Незавершённый тест'}: ${open.name}</b>
          <p>Отвечено ${open.answered} из ${open.questionCount}, режим ${open.mode === 'timed' ? 'Timed' : 'Tutor'}</p>
        </div>
        <a class="btn" href="/exam/${open.id}">Продолжить</a>
      </div>` : ''}

    <div class="dash">
      <section class="panel">
        <div class="panel-head"><h2>Прогресс</h2><a href="/app/stats" class="small">Подробная статистика</a></div>
        <div class="kpis">
          <div class="kpi"><b>${stats.percentCorrect == null ? '—' : `${stats.percentCorrect}%`}</b><span>верных ответов</span></div>
          <div class="kpi"><b>${stats.used}</b><span>вопросов решено</span></div>
          <div class="kpi"><b>${stats.testsCompleted}</b><span>тестов завершено</span></div>
        </div>
        <div style="margin-top:24px">
          <div class="row between small"><span>Использовано вопросов</span><span class="num">${stats.used} из ${stats.totalQuestions}</span></div>
          <div class="meter" style="margin-top:6px" role="progressbar" aria-valuenow="${usedPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Использовано вопросов"><span style="width:${usedPct}%"></span></div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Повторение</h2><a href="/app/flashcards" class="small">Все карточки</a></div>
        ${due
          ? html`<p>Карточек к повторению сегодня: <b>${due}</b>.</p><a class="btn" href="/app/flashcards?review=1">Начать повторение</a>`
          : html`<p class="muted">Карточек к повторению нет. Создавайте их из разбора вопросов — кнопка «Создать флеш-карту» под объяснением.</p>`}
        ${stats.incorrect ? html`<p class="small" style="margin-top:16px">Вопросов с ошибкой: <b>${stats.incorrect}</b>. <a href="/app/create?filter=incorrect">Повторить ошибки</a></p>` : ''}
      </section>
    </div>

    <section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>Последние тесты</h2><a href="/app/tests" class="small">Все тесты</a></div>
      ${recent.length ? html`
        <ul class="list-plain">
          ${recent.map((t) => html`
            <li>
              <a href="/app/tests/${t.id}">${t.name}</a>
              <span class="muted small">${fmtDate(t.completedAt)}</span>
              <b class="num">${pct(t.scoreCorrect, t.questionCount)}%</b>
            </li>`)}
        </ul>` : html`<p class="muted">Здесь появятся результаты завершённых тестов.</p>`}
    </section>`);
}
