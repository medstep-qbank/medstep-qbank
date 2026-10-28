import { api, html, on, md, fmtDate, toast, confirmDialog, modal, formData } from '../lib.js';

export default async function notes(root, { app }) {
  app.setTitle('Заметки');
  let list = await api('/api/notes');
  let q = '';

  function draw() {
    const v = q.trim().toLowerCase();
    const shown = v ? list.filter((n) => `${n.body} ${n.subject || ''} ${n.system || ''} ${n.leadIn || ''}`.toLowerCase().includes(v)) : list;
    root.innerHTML = String(html`
      <div class="page-head">
        <div><h1>Заметки</h1><p>Выводы, которые вы сохранили при разборе вопросов.</p></div>
        ${list.length ? html`<input class="input" type="search" id="nq" placeholder="Поиск по заметкам" value="${q}" style="max-width:320px">` : ''}
      </div>
      ${list.length ? (shown.length ? html`
        <div class="stack">
          ${shown.map((n) => {
            const [tid, pos] = (n.reviewRef || '').split(':');
            return html`
              <article class="panel">
                <div class="panel-head">
                  <div>
                    <h2 style="font-size:16px;margin:0">${n.leadIn || 'Заметка'}</h2>
                    <span class="small muted">${[n.subject, n.system].filter(Boolean).join(', ')}${n.questionId ? `, вопрос ID ${n.questionId}` : ''}, изменена ${fmtDate(n.updatedAt)}</span>
                  </div>
                  <div class="row">
                    ${tid ? html`<a class="btn sm" href="/exam/${tid}?q=${pos}">Открыть вопрос</a>` : ''}
                    <button class="btn sm" data-edit="${n.id}">Изменить</button>
                    <button class="btn sm danger" data-del="${n.id}">Удалить</button>
                  </div>
                </div>
                <div class="q-text" style="font-size:15px">${md(n.body)}</div>
              </article>`;
          })}
        </div>` : html`<p class="muted">Ничего не найдено.</p>`) : html`
        <div class="panel empty">
          <h2>Заметок пока нет</h2>
          <p>После ответа на вопрос нажмите «Заметка» под объяснением — запись появится здесь.</p>
          <a class="btn primary" href="/app/create">Решать вопросы</a>
        </div>`}`);
    const input = root.querySelector('#nq');
    if (input && v) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
  draw();

  on(root, 'input', '#nq', (_, el) => { q = el.value; draw(); });

  on(root, 'click', '[data-del]', async (_, el) => {
    const id = Number(el.dataset.del);
    if (!(await confirmDialog('Заметка будет удалена.', { title: 'Удалить заметку?', ok: 'Удалить', danger: true }))) return;
    await api(`/api/notes/${id}`, { method: 'DELETE' });
    list = list.filter((n) => n.id !== id);
    draw();
    toast('Заметка удалена', 'ok');
  });

  on(root, 'click', '[data-edit]', (_, el) => {
    const n = list.find((x) => x.id === Number(el.dataset.edit));
    modal({
      title: 'Изменить заметку',
      wide: true,
      body: html`<form id="ne"><label class="field"><span>Текст</span><textarea class="textarea" name="body" rows="10">${n.body}</textarea></label></form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сохранить',
          kind: 'primary',
          onClick: async (m) => {
            const { body } = formData(m.querySelector('#ne'));
            await api(`/api/notes/question/${n.questionId}`, { method: 'PUT', body: { body } });
            if (body.trim()) n.body = body.trim(); else list = list.filter((x) => x !== n);
            draw();
            toast('Заметка сохранена', 'ok');
          },
        },
      ],
    });
  });
}
