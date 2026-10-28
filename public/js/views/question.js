import { html, md, icon, LETTERS, fmtClock } from '../lib.js';

/**
 * Renders a question. `q` fields: stem, leadIn, options, image, revealed, correct, peers.
 * `st`: { selected, strikes[], locked, showPeers }
 */
export function questionHtml(q, st = {}) {
  const strikes = new Set(st.strikes || []);
  const total = q.peers?.total || 0;
  return html`
    <div class="q-text" data-hl-root>
      ${md(q.stem)}
      ${q.image ? html`<figure class="q-image"><img src="${q.image}" alt="Иллюстрация к вопросу"></figure>` : ''}
      <p class="q-lead">${q.leadIn}</p>
    </div>
    <ol class="q-options" role="radiogroup" aria-label="Варианты ответа">
      ${q.options.map((text, i) => {
        const cls = ['opt'];
        if (st.selected === i) cls.push('selected');
        if (strikes.has(i)) cls.push('struck');
        if (st.locked) cls.push('locked');
        let mark = '';
        if (q.revealed) {
          if (i === q.correct) { cls.push('correct'); mark = icon('check'); }
          else if (st.selected === i) { cls.push('wrong'); mark = icon('x'); }
        }
        const peer = q.revealed && st.showPeers !== false && total
          ? html`<span class="opt-peer" title="Доля пользователей, выбравших этот ответ">${Math.round(((q.peers.byOption[i] || 0) / total) * 100)}%</span>`
          : html`<span></span>`;
        return html`
          <li class="${cls.join(' ')}" data-opt="${i}" role="radio" aria-checked="${st.selected === i ? 'true' : 'false'}" tabindex="${st.locked ? -1 : 0}">
            ${mark ? html`<span class="opt-mark">${mark}</span>` : ''}
            <span class="opt-radio" aria-hidden="true"></span>
            <span class="opt-letter">${LETTERS[i]}.</span>
            <span class="opt-text">${text}</span>
            ${peer}
          </li>`;
      })}
    </ol>`;
}

export function resultBanner(q, item = {}) {
  if (!q.revealed) return '';
  const total = q.peers?.total || 0;
  const correctPeers = total ? Math.round(((q.peers.byOption[q.correct] || 0) / total) * 100) : null;
  const state = item.selected == null ? 'omit' : item.selected === q.correct ? 'ok' : 'bad';
  const verdict = state === 'ok' ? 'Верно' : state === 'bad' ? 'Неверно' : 'Нет ответа';
  return html`
    <div class="q-result ${state}" role="status">
      <span class="verdict">${verdict}</span>
      <span class="stat"><span>Правильный ответ</span><b>${LETTERS[q.correct]}</b></span>
      <span class="stat"><span>Ответили верно</span><b>${correctPeers == null ? '—' : `${correctPeers}%`}</b></span>
      ${item.timeSpent != null ? html`<span class="stat"><span>Ваше время</span><b>${fmtClock(item.timeSpent)}</b></span>` : ''}
      ${q.questionId ? html`<span class="stat"><span>ID вопроса</span><b>${q.questionId}</b></span>` : ''}
    </div>`;
}

export function explanationHtml(q, { tools = true } = {}) {
  if (!q.revealed) return '';
  return html`
    <section class="q-expl" aria-label="Объяснение">
      <h2>Объяснение</h2>
      <div class="q-text">${md(q.explanation || 'Объяснение пока не добавлено.')}</div>
      ${q.explanationImage ? html`<figure class="q-image"><img src="${q.explanationImage}" alt="Иллюстрация к объяснению"></figure>` : ''}
      ${q.objective ? html`<div class="objective"><b>Цель обучения</b>${q.objective}</div>` : ''}
      <div class="q-meta">
        ${q.subject ? html`<span><b>Предмет:</b> ${q.subject}</span>` : ''}
        ${q.system ? html`<span><b>Система:</b> ${q.system}</span>` : ''}
        ${q.topic ? html`<span><b>Тема:</b> ${q.topic}</span>` : ''}
      </div>
      ${tools ? html`
        <div class="q-tools">
          <button class="btn sm" data-action="note">${icon('note')}${q.note ? 'Изменить заметку' : 'Заметка'}</button>
          <button class="btn sm" data-action="flashcard">${icon('card')}${q.hasFlashcard ? 'Ещё одна флеш-карта' : 'Создать флеш-карту'}</button>
        </div>` : ''}
    </section>`;
}

/* ---------- highlighter: ranges are [start, end) offsets in the container's text ---------- */

export function mergeRanges(ranges) {
  const sorted = ranges.filter(([a, b]) => b > a).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

export function applyHighlights(root, ranges) {
  if (!ranges?.length) return;
  const merged = mergeRanges(ranges);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  let offset = 0;
  for (const node of nodes) {
    const len = node.data.length;
    const start = offset;
    const end = offset + len;
    offset = end;
    const segs = merged
      .map(([a, b], idx) => [Math.max(a, start) - start, Math.min(b, end) - start, idx])
      .filter(([a, b]) => b > a);
    if (!segs.length) continue;
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const [a, b, idx] of segs) {
      if (a > pos) frag.append(node.data.slice(pos, a));
      const m = document.createElement('mark');
      m.className = 'hl';
      m.dataset.r = String(idx);
      m.title = 'Нажмите, чтобы снять выделение';
      m.textContent = node.data.slice(a, b);
      frag.append(m);
      pos = b;
    }
    if (pos < len) frag.append(node.data.slice(pos));
    node.parentNode.replaceChild(frag, node);
  }
  return merged;
}

/** Returns [start, end] of the current selection inside root, or null. */
export function selectionOffsets(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  if (end - start < 1) return null;
  return [start, end];
}
