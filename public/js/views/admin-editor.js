import { api, html, on, $, $$, toast, toastError, confirmDialog, icon, LETTERS } from '../lib.js';
import { questionHtml, resultBanner, explanationHtml } from './question.js';

const STEP = { step1: 'Step 1', step2: 'Step 2 CK', step3: 'Step 3' };

const EMPTY = {
  step: 'step1', subjectId: null, systemId: null, topic: '', stem: '', leadIn: '',
  options: ['', '', '', '', ''], correct: 0, explanation: '', objective: '',
  image: '', explanationImage: '', difficulty: 2, status: 'draft', isFree: false,
};

export default async function editor(root, { params, app }) {
  const isNew = !params.id;
  const [subjects, systems, loaded] = await Promise.all([
    api('/api/admin/subjects'),
    api('/api/admin/systems'),
    isNew ? Promise.resolve(null) : api(`/api/admin/questions/${params.id}`),
  ]);
  const q = { ...EMPTY, ...(loaded || {}) };
  q.image = q.image || '';
  q.explanationImage = q.explanationImage || '';
  let dirty = false;
  app.setTitle(isNew ? 'Новый вопрос' : `Вопрос ${q.id}`);

  root.innerHTML = String(html`
    <div class="page-head">
      <div>
        <h1>${isNew ? 'Новый вопрос' : `Вопрос ${q.id}`}</h1>
        <p><a href="/admin/questions">Все вопросы</a></p>
      </div>
      <div class="row">
        ${isNew ? '' : html`<button class="btn danger" data-action="delete">${icon('trash')}Удалить</button>`}
        <button class="btn" data-action="save-draft">Сохранить черновик</button>
        <button class="btn primary" data-action="save-publish">${q.status === 'published' ? 'Сохранить' : 'Опубликовать'}</button>
      </div>
    </div>
    <div class="editor">
      <form id="qe" novalidate>
        <section class="panel">
          <div class="grid-2">
            <label class="field"><span>Step</span>
              <select class="select" name="step">${Object.entries(STEP).map(([k, v]) => html`<option value="${k}" ${q.step === k ? 'selected' : ''}>${v}</option>`)}</select></label>
            <label class="field"><span>Сложность</span>
              <select class="select" name="difficulty">${[[1, 'Лёгкий'], [2, 'Средний'], [3, 'Сложный']].map(([k, v]) => html`<option value="${k}" ${q.difficulty === k ? 'selected' : ''}>${v}</option>`)}</select></label>
          </div>
          <div class="grid-2">
            <label class="field"><span>Предмет</span>
              <select class="select" name="subjectId"><option value="">—</option>${subjects.map((s) => html`<option value="${s.id}" ${q.subjectId === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></label>
            <label class="field"><span>Система</span>
              <select class="select" name="systemId"><option value="">—</option>${systems.map((s) => html`<option value="${s.id}" ${q.systemId === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></label>
          </div>
          <label class="field"><span>Тема</span><input class="input" name="topic" value="${q.topic}" maxlength="200" placeholder="например, Нефротический синдром"></label>
          <label class="check"><input type="checkbox" name="isFree" ${q.isFree ? 'checked' : ''}>Пробный вопрос — доступен без оплаты</label>
        </section>

        <section class="panel">
          <label class="field"><span>Условие (клиническая виньетка)</span>
            <textarea class="textarea" name="stem" rows="9" required>${q.stem}</textarea>
            <small>Разметка: **жирный**, *курсив*, списки «- », таблицы «| A | B |» со строкой «|---|---|».</small>
          </label>
          <div class="field"><span class="label">Изображение к условию</span>${imgField('image', q.image)}</div>
          <label class="field"><span>Вопрос</span><input class="input" name="leadIn" value="${q.leadIn}" maxlength="2000" required placeholder="Какой диагноз наиболее вероятен?"></label>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Варианты ответа</h2><span class="small muted">Отметьте правильный</span></div>
          <div id="opts"></div>
          <button class="btn sm" type="button" data-action="add-opt">${icon('plus')}Добавить вариант</button>
        </section>

        <section class="panel">
          <label class="field"><span>Объяснение</span>
            <textarea class="textarea" name="explanation" rows="14">${q.explanation}</textarea>
            <small>Разберите верный ответ и каждый неверный вариант.</small>
          </label>
          <div class="field"><span class="label">Изображение к объяснению</span>${imgField('explanationImage', q.explanationImage)}</div>
          <label class="field"><span>Цель обучения</span><textarea class="textarea" name="objective" rows="3">${q.objective}</textarea></label>
        </section>
      </form>
      <aside class="editor-preview" aria-label="Предпросмотр">
        <div class="row between" style="margin-bottom:16px">
          <b>Предпросмотр</b>
          <div class="seg"><button type="button" data-preview="q" class="on">Вопрос</button><button type="button" data-preview="a">С разбором</button></div>
        </div>
        <div id="preview"></div>
      </aside>
    </div>`);

  const form = $('#qe', root);
  let previewMode = 'q';

  function imgField(name, value) {
    return html`
      <div class="img-field">
        <input class="input" name="${name}" value="${value}" placeholder="/uploads/… или https://…">
        <label class="btn sm">${icon('upload')}Загрузить<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-upload="${name}" hidden></label>
      </div>
      ${value ? html`<img class="img-thumb" src="${value}" alt="" style="margin-top:8px">` : ''}`;
  }

  function drawOptions() {
    $('#opts', root).innerHTML = String(html`${q.options.map((o, i) => html`
      <div class="opt-edit">
        <input type="radio" name="correct" value="${i}" ${q.correct === i ? 'checked' : ''} aria-label="Правильный ответ ${LETTERS[i]}">
        <span class="letter">${LETTERS[i]}</span>
        <textarea class="textarea" data-opt="${i}" rows="1" placeholder="Вариант ${LETTERS[i]}">${o}</textarea>
        <button type="button" class="icon-btn" data-remove="${i}" aria-label="Удалить вариант ${LETTERS[i]}" ${q.options.length <= 2 ? 'disabled' : ''}>${icon('x')}</button>
      </div>`)}`);
  }

  function readForm() {
    const fd = new FormData(form);
    q.step = fd.get('step');
    q.subjectId = fd.get('subjectId') ? Number(fd.get('subjectId')) : null;
    q.systemId = fd.get('systemId') ? Number(fd.get('systemId')) : null;
    q.topic = fd.get('topic');
    q.difficulty = Number(fd.get('difficulty'));
    q.isFree = form.isFree.checked;
    q.stem = fd.get('stem');
    q.leadIn = fd.get('leadIn');
    q.explanation = fd.get('explanation');
    q.objective = fd.get('objective');
    q.image = fd.get('image').trim();
    q.explanationImage = fd.get('explanationImage').trim();
    q.correct = Number(fd.get('correct') ?? 0);
    q.options = $$('#opts textarea[data-opt]', root).map((t) => t.value);
  }

  function drawPreview() {
    const subj = subjects.find((s) => s.id === q.subjectId)?.name;
    const sys = systems.find((s) => s.id === q.systemId)?.name;
    const opts = q.options.map((o, i) => o || `Вариант ${LETTERS[i]}`);
    const revealed = previewMode === 'a';
    const pq = {
      ...q, options: opts, revealed, subject: subj, system: sys, image: q.image || null,
      explanationImage: q.explanationImage || null, peers: null, questionId: q.id || null,
      stem: q.stem || '*Условие появится здесь*', leadIn: q.leadIn || 'Вопрос',
    };
    $('#preview', root).innerHTML = String(html`
      ${questionHtml(pq, { selected: revealed ? q.correct : null, locked: true, showPeers: false })}
      ${revealed ? html`${resultBanner(pq, { selected: q.correct })}${explanationHtml(pq, { tools: false })}` : ''}`);
  }

  let pt;
  const refresh = () => { clearTimeout(pt); pt = setTimeout(() => { readForm(); drawPreview(); }, 150); };

  drawOptions();
  drawPreview();

  on(root, 'input', '#qe', () => { dirty = true; refresh(); });
  on(root, 'change', '#qe', () => { dirty = true; refresh(); });
  on(root, 'click', '[data-preview]', (_, el) => {
    previewMode = el.dataset.preview;
    $$('[data-preview]', root).forEach((b) => b.classList.toggle('on', b === el));
    readForm();
    drawPreview();
  });
  on(root, 'click', '[data-action="add-opt"]', () => {
    readForm();
    if (q.options.length >= 10) return;
    q.options.push('');
    drawOptions();
    $$('#opts textarea[data-opt]', root).at(-1).focus();
    dirty = true;
  });
  on(root, 'click', '[data-remove]', (_, el) => {
    readForm();
    const i = Number(el.dataset.remove);
    q.options.splice(i, 1);
    if (q.correct === i) q.correct = 0;
    else if (q.correct > i) q.correct -= 1;
    drawOptions();
    drawPreview();
    dirty = true;
  });
  on(root, 'change', '[data-upload]', async (_, input) => {
    const file = input.files[0];
    if (!file) return;
    try {
      const res = await api('/api/admin/upload', { method: 'POST', rawBody: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      const field = form.elements[input.dataset.upload];
      field.value = res.url;
      const wrap = field.closest('.field');
      wrap.querySelector('.img-thumb')?.remove();
      wrap.insertAdjacentHTML('beforeend', String(html`<img class="img-thumb" src="${res.url}" alt="" style="margin-top:8px">`));
      dirty = true;
      refresh();
      toast('Изображение загружено', 'ok');
    } catch (e) { toastError(e); }
  });

  async function save(status) {
    readForm();
    const body = { ...q, status: status || q.status };
    try {
      if (isNew) {
        const res = await api('/api/admin/questions', { method: 'POST', body });
        dirty = false;
        toast(body.status === 'published' ? 'Вопрос опубликован' : 'Черновик сохранён', 'ok');
        app.navigate(`/admin/questions/${res.id}`, { replace: true });
      } else {
        await api(`/api/admin/questions/${q.id}`, { method: 'PUT', body });
        q.status = body.status;
        dirty = false;
        toast(body.status === 'published' ? 'Вопрос сохранён и опубликован' : 'Черновик сохранён', 'ok');
        $('[data-action="save-publish"]', root).textContent = 'Сохранить';
      }
    } catch (e) { toastError(e); }
  }

  on(root, 'click', '[data-action="save-draft"]', () => save('draft'));
  on(root, 'click', '[data-action="save-publish"]', () => save('published'));
  on(root, 'click', '[data-action="delete"]', async () => {
    if (!(await confirmDialog('Если вопрос уже встречался в тестах, он будет перенесён в архив, а статистика сохранится.', { title: 'Удалить вопрос?', ok: 'Удалить', danger: true }))) return;
    try {
      const r = await api(`/api/admin/questions/${q.id}`, { method: 'DELETE' });
      dirty = false;
      toast(r.archived ? 'Вопрос перенесён в архив' : 'Вопрос удалён', 'ok');
      app.navigate('/admin/questions');
    } catch (e) { toastError(e); }
  });

  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const keySave = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', keySave);
  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    document.removeEventListener('keydown', keySave);
  };
}
