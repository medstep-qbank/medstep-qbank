import { api, html, on, fmtDate, pct, toast, modal, formData } from '../lib.js';

const STEP = { step1: 'Step 1', step2: 'Step 2 CK', step3: 'Step 3' };

export default async function tests(root, { app }) {
  app.setTitle('Мои тесты');
  let list = await api('/api/tests');

  function draw() {
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Мои тесты</h1><p>Продолжайте прерванные блоки и возвращайтесь к разбору завершённых.</p></div>
        <a class="btn primary" href="/app/create">Создать тест</a>
      </div>
      ${list.length ? html`
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Тест</th><th>Дата</th><th>Step</th><th>Режим</th><th class="r">Вопросов</th><th class="r">Результат</th><th></th></tr></thead>
            <tbody>
              ${list.map((t) => html`
                <tr>
                  <td><b>${t.name}</b> <button class="btn ghost sm" data-rename="${t.id}" aria-label="Переименовать тест">Переименовать</button></td>
                  <td class="nowrap">${fmtDate(t.createdAt, true)}</td>
                  <td class="nowrap">${STEP[t.step]}</td>
                  <td>${t.mode === 'timed' ? 'Timed' : 'Tutor'}</td>
                  <td class="r num">${t.questionCount}</td>
                  <td class="r num">${t.status === 'completed'
                    ? html`<b>${pct(t.scoreCorrect, t.questionCount)}%</b>`
                    : html`<span class="tag ${t.status === 'suspended' ? 'warn' : 'hema'}">${t.status === 'suspended' ? 'Прерван' : 'Идёт'}</span>`}</td>
                  <td class="r nowrap">
                    ${t.status === 'completed'
                      ? html`<a class="btn sm" href="/app/tests/${t.id}">Результаты</a> <a class="btn sm" href="/exam/${t.id}?q=0">Разбор</a>`
                      : html`<a class="btn sm primary" href="/exam/${t.id}">Продолжить</a>`}
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : html`
        <div class="panel empty">
          <h2>Тестов пока нет</h2>
          <p>Соберите первый блок: выберите Step, режим и разделы.</p>
          <a class="btn primary" href="/app/create">Создать тест</a>
        </div>`}`);
  }
  draw();

  on(root, 'click', '[data-rename]', (_, el) => {
    const t = list.find((x) => x.id === Number(el.dataset.rename));
    modal({
      title: 'Название теста',
      body: html`<form id="rn"><label class="field"><span>Название</span><input class="input" name="name" value="${t.name}" maxlength="80" required></label></form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сохранить',
          kind: 'primary',
          onClick: async (m) => {
            const { name } = formData(m.querySelector('#rn'));
            await api(`/api/tests/${t.id}`, { method: 'PUT', body: { name } });
            t.name = name.trim();
            draw();
            toast('Название сохранено', 'ok');
          },
        },
      ],
    });
  });
}
