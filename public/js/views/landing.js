import { api, html, icon, $, on, qWord } from '../lib.js';
import { brandMark } from '../app.js';
import { questionHtml, resultBanner } from './question.js';

const FEATURES = [
  ['clock', 'Режимы Tutor и Timed', 'Разбор сразу после каждого ответа или полноценный блок на время — 90 секунд на вопрос, как на экзамене.'],
  ['highlighter', 'Привычный экзаменационный интерфейс', 'Навигация по блоку, отметки, маркер для текста, зачёркивание вариантов, лабораторные нормы и калькулятор.'],
  ['eye', 'Разбор каждого варианта', 'Почему верный ответ верен и чем ошибочен каждый из остальных — плюс короткая цель обучения в конце.'],
  ['chart', 'Статистика по предметам и системам', 'Процент верных ответов по каждому разделу, история тестов и сравнение со средним по пользователям.'],
  ['cards', 'Заметки и флеш-карты', 'Сохраняйте выводы прямо из разбора. Карточки повторяются с интервалами, чтобы материал не забывался.'],
  ['moon', 'Тёмная тема для долгих сессий', 'Переключается в один клик и в кабинете, и прямо во время теста. Размер шрифта тоже настраивается.'],
];

export default async function landing(root, { app }) {
  const { meta } = app;
  app.setTitle('Вопросы USMLE на русском');
  const s = meta.settings;
  const counts = meta.questionCounts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const plans = meta.plans || [];
  const sample = await api('/api/sample').catch(() => null);
  const user = app.user;

  root.innerHTML = String(html`
    <div class="landing">
      <div class="l-wrap">
        <header class="l-nav">
          <a href="/" class="brand">${brandMark()}<span>${s.site_name}</span></a>
          <nav aria-label="Разделы">
            <a href="#how" class="hide-sm">Как это работает</a>
            <a href="#pricing" class="hide-sm">Тарифы</a>
            <a href="#faq" class="hide-sm">Вопросы и ответы</a>
            ${user
              ? html`<a class="btn primary" href="/app">Открыть кабинет</a>`
              : html`<a href="/login">Войти</a><a class="btn primary" href="/register">Начать бесплатно</a>`}
          </nav>
        </header>

        ${meta.demo ? html`<p class="notice" role="note">Это демо-версия сайта. Регистрируйтесь и пробуйте всё — но аккаунты и прогресс периодически сбрасываются.</p>` : ''}
        <section class="l-hero">
          <div>
            <h1>Готовьтесь к USMLE на родном языке</h1>
            <p class="lede">Клинические задачи в формате Step 1, Step 2 CK и Step 3 на русском. После каждого ответа — разбор всех вариантов и ваша статистика по предметам и системам.</p>
            <div class="cta">
              <a class="btn primary lg" href="${user ? '/app/create' : '/register'}">${user ? 'Создать тест' : 'Начать бесплатно'}</a>
              ${user ? '' : html`<small>Пробные вопросы — без оплаты и без карты</small>`}
            </div>
            <div class="l-facts">
              <div><b>${total}</b><span>${qWord(total).replace(/^\d+ /, '')} в базе</span></div>
              ${['step1', 'step2', 'step3'].filter((k) => counts[k]).map((k) => html`<div><b>${counts[k]}</b><span>${k === 'step1' ? 'Step 1' : k === 'step2' ? 'Step 2 CK' : 'Step 3'}</span></div>`)}
            </div>
          </div>
          ${sample ? html`
            <div class="l-demo" id="demo">
              <div class="l-demo-bar"><b>Попробуйте прямо сейчас</b><span>${sample.subject || ''}</span></div>
              <div class="l-demo-body" id="demo-body"></div>
            </div>` : ''}
        </section>
      </div>

      <section class="l-section" id="how">
        <div class="l-wrap">
          <h2>Три шага от вопроса к пониманию</h2>
          <p class="lead">Платформа повторяет логику реального экзамена, но каждую ошибку превращает в материал для повторения.</p>
          <ol class="l-steps">
            <li><h3>Соберите тест</h3><p>Выберите Step, предметы и системы. Отфильтруйте только новые вопросы, ошибки или отмеченные — и задайте их количество.</p></li>
            <li><h3>Решайте как на экзамене</h3><p>Таймер, навигация по блоку, отметки и маркер. Можно прерваться и продолжить с того же места.</p></li>
            <li><h3>Разбирайте ошибки</h3><p>Объяснение каждого варианта, процент верных ответов у других пользователей, заметки и флеш-карты.</p></li>
          </ol>
        </div>
      </section>

      <section class="l-section" id="features">
        <div class="l-wrap">
          <h2>Всё, что нужно для ежедневной практики</h2>
          <p class="lead">Работает в браузере на компьютере, планшете и телефоне — устанавливать ничего не нужно.</p>
          <div class="l-features">
            ${FEATURES.map(([ic, t, d]) => html`<div>${icon(ic)}<h3>${t}</h3><p>${d}</p></div>`)}
          </div>
        </div>
      </section>

      ${plans.length ? html`
        <section class="l-section" id="pricing">
          <div class="l-wrap">
            <h2>Тарифы</h2>
            <p class="lead">${s.trial_note}</p>
            <div class="l-prices">
              ${plans.map((p, i) => html`
                <div class="l-price ${plans.length >= 3 && i === 1 ? 'featured' : ''}">
                  <h3>${p.name}</h3>
                  <div class="price">${fmtPrice(p.price)} <small>${p.currency}</small></div>
                  <p>${p.description}</p>
                  <a class="btn ${plans.length >= 3 && i === 1 ? 'primary' : ''}" href="${user ? '/app/account' : '/register?next=/app/account'}">Выбрать</a>
                </div>`)}
            </div>
          </div>
        </section>` : ''}

      <section class="l-section" id="faq">
        <div class="l-wrap">
          <h2>Вопросы и ответы</h2>
          <div class="l-faq">
            <details><summary>Откуда берутся вопросы?</summary><p>Все вопросы составлены авторами платформы по программе USMLE и написаны сразу на русском языке. К каждому есть подробный разбор всех вариантов.</p></details>
            <details><summary>Можно попробовать бесплатно?</summary><p>Да. После регистрации доступны пробные вопросы со всеми функциями: экзаменационный интерфейс, разборы, статистика и флеш-карты.</p></details>
            <details><summary>Как оплатить доступ?</summary><p>Выберите тариф в личном кабинете — там будут реквизиты. После оплаты оставьте номер транзакции, и доступ откроется после проверки${s.contact_telegram ? html`. Вопросы можно задать в Telegram: ${s.contact_telegram}` : ''}.</p></details>
            <details><summary>Есть ли ограничение по устройствам?</summary><p>Нет. Прогресс хранится в аккаунте: начните тест на компьютере и продолжите с телефона.</p></details>
            <details><summary>Почему на русском, если экзамен на английском?</summary><p>Чтобы сначала надёжно понять механизм и клиническую логику. Медицинские термины в разборах даны так, чтобы их легко было сопоставить с англоязычными источниками.</p></details>
          </div>
        </div>
      </section>

      <footer class="l-foot">
        <div class="l-wrap">
          <span>© ${new Date().getFullYear()} ${s.site_name}${s.contact_email ? html`, <a href="mailto:${s.contact_email}">${s.contact_email}</a>` : ''}</span>
          <span>USMLE® — совместная программа FSMB и NBME. Сайт с ними не связан.</span>
        </div>
      </footer>
    </div>`);

  if (!sample) return;
  const body = $('#demo-body', root);
  const q = { ...sample, leadIn: sample.lead_in, correct: sample.correct_index, revealed: false };
  let selected = null;
  const draw = () => {
    body.innerHTML = String(html`
      ${questionHtml(q, { selected, locked: q.revealed, showPeers: false })}
      ${q.revealed ? html`
        ${resultBanner({ ...q, peers: null, questionId: null }, { selected })}
        <p class="small" style="margin-top:16px"><b>Цель обучения.</b> ${q.objective}</p>` : ''}
      <div class="l-demo-foot">
        <span class="small muted">${q.revealed ? 'Полный разбор всех вариантов — в кабинете' : 'Выберите вариант ответа'}</span>
        ${q.revealed ? html`<a class="btn primary sm" href="${user ? '/app/create' : '/register'}">${user ? 'Решать дальше' : 'Решать дальше бесплатно'}</a>` : ''}
      </div>`);
  };
  draw();
  const choose = (i) => {
    if (q.revealed) return;
    selected = i;
    q.revealed = true;
    draw();
  };
  on(body, 'click', '[data-opt]', (_, el) => choose(Number(el.dataset.opt)));
  on(body, 'keydown', '[data-opt]', (e, el) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(Number(el.dataset.opt)); }
  });
}

function fmtPrice(n) {
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
