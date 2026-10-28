import { api, html, on, md, fmtDate, toast, toastError, modal, formData } from '../lib.js';

const ORDER_STATUS = { pending: ['На проверке', 'warn'], paid: ['Оплачено', 'ok'], rejected: ['Отклонено', 'bad'] };

export default async function account(root, { app }) {
  app.setTitle('Аккаунт и оплата');
  let data = await api('/api/billing');

  function draw() {
    const u = data.user;
    const staff = u.role !== 'student';
    root.innerHTML = String(html`
      <div class="page-head"><div><h1>Аккаунт и оплата</h1></div></div>

      <section class="panel">
        <div class="panel-head"><h2>Доступ</h2></div>
        ${staff ? html`<p>У вас роль «${u.role === 'admin' ? 'администратор' : 'автор'}» — доступ ко всем вопросам открыт.</p>`
          : u.hasAccess ? html`<p>Полный доступ открыт до <b>${fmtDate(u.accessUntil)}</b>. Продлить можно в любой момент — новый срок прибавится к текущему.</p>`
          : html`<p>Сейчас у вас пробный доступ. ${app.meta.settings.trial_note}</p>`}
      </section>

      ${data.plans.length ? html`
        <section class="panel">
          <div class="panel-head"><h2>${u.hasAccess && !staff ? 'Продлить доступ' : 'Тарифы'}</h2></div>
          <div class="l-prices">
            ${data.plans.map((p) => html`
              <div class="l-price">
                <h3>${p.name}</h3>
                <div class="price">${Number(p.price).toLocaleString('ru-RU')} <small>${p.currency}</small></div>
                <p>${p.description}</p>
                <button class="btn primary" data-plan="${p.id}">Оплатить</button>
              </div>`)}
          </div>
        </section>` : ''}

      ${data.orders.length ? html`
        <section class="panel">
          <div class="panel-head"><h2>Мои заявки на оплату</h2></div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr><th>Дата</th><th>Тариф</th><th class="r">Сумма</th><th>Статус</th><th>Комментарий</th></tr></thead>
              <tbody>${data.orders.map((o) => html`
                <tr>
                  <td class="nowrap">${fmtDate(o.created_at, true)}</td>
                  <td>${o.plan_name}</td>
                  <td class="r num nowrap">${o.amount} ${o.currency}</td>
                  <td><span class="tag ${ORDER_STATUS[o.status][1]}">${ORDER_STATUS[o.status][0]}</span></td>
                  <td>${o.admin_comment || o.user_comment}</td>
                </tr>`)}</tbody>
            </table>
          </div>
        </section>` : ''}

      <section class="panel">
        <div class="panel-head"><h2>Профиль</h2></div>
        <form id="profile" style="max-width:420px">
          <label class="field"><span>Email</span><input class="input" value="${u.email}" disabled></label>
          <label class="field"><span>Имя</span><input class="input" name="name" value="${u.name}" maxlength="80" required></label>
          <details>
            <summary class="label" style="cursor:pointer;margin-bottom:12px">Сменить пароль</summary>
            <label class="field"><span>Текущий пароль</span><input class="input" type="password" name="currentPassword" autocomplete="current-password"></label>
            <label class="field"><span>Новый пароль</span><input class="input" type="password" name="newPassword" autocomplete="new-password" minlength="8"><small>Минимум 8 символов</small></label>
          </details>
          <button class="btn primary" type="submit">Сохранить профиль</button>
        </form>
      </section>`);
  }
  draw();

  on(root, 'submit', '#profile', async (e) => {
    e.preventDefault();
    try {
      const body = formData(e.target);
      const res = await api('/api/me', { method: 'PUT', body });
      app.user = { ...app.user, ...res.user };
      data.user = { ...data.user, ...res.user };
      toast(body.newPassword ? 'Профиль и пароль сохранены' : 'Профиль сохранён', 'ok');
      e.target.querySelectorAll('input[type="password"]').forEach((i) => { i.value = ''; });
    } catch (ex) { toastError(ex); }
  });

  on(root, 'click', '[data-plan]', (_, el) => {
    const plan = data.plans.find((p) => p.id === Number(el.dataset.plan));
    modal({
      title: `Оплата: ${plan.name}`,
      wide: true,
      body: html`
        <p>Сумма к оплате: <b>${Number(plan.price).toLocaleString('ru-RU')} ${plan.currency}</b></p>
        <div class="notice">${md(data.instructions)}</div>
        <form id="pay">
          <label class="field"><span>Данные платежа</span>
            <textarea class="textarea" name="comment" rows="3" required maxlength="500" placeholder="Номер транзакции, время перевода, имя отправителя"></textarea>
            <small>По этим данным администратор найдёт ваш платёж и откроет доступ.</small>
          </label>
        </form>`,
      actions: [
        { label: 'Отмена' },
        {
          label: 'Отправить заявку',
          kind: 'primary',
          onClick: async (m) => {
            const { comment } = formData(m.querySelector('#pay'));
            await api('/api/orders', { method: 'POST', body: { planId: plan.id, comment } });
            data = await api('/api/billing');
            draw();
            toast('Заявка отправлена. Доступ откроется после проверки платежа.', 'ok');
          },
        },
      ],
    });
  });
}
