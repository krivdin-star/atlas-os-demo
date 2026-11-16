const $ = id => document.getElementById(id);
const local = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const labels = { once:'Один раз', hour:'По часам', day:'По дням', week:'По неделям', month:'По месяцам', year:'Ежегодно' };
const results = { accepted:'Принято службой доставки', partial:'Доставлено в часть подписок', failed:'Ошибка отправки', pending:'Ожидает результата', no_subscription:'Уведомления не подключены' };
const timestamp = value => local.format(new Date(value));
function element(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

export function setupReminders(rpc, getSession) {
  const view = $('reminders');
  const link = $('reminders-nav');
  const editor = $('reminder-editor');
  const form = $('reminder-form');
  const submit = $('reminder-save');
  let selected = null;
  let enabled = false;
  let editing;
  let version = 0;
  let busy = false;

  async function operation(action, id = null, values = {}) {
    const result = await rpc('atlas_reminders', { p_session:getSession(), p_operation:action, p_id:id, p_values:values });
    if (result.error) throw new Error(result.error);
    return result;
  }

  function edit(item) {
    editing = item ?? { id:crypto.randomUUID(), starts:timestamp(Date.now()+180000).replace(' ','T'), every:1, kind:'once', text:'', until_day:'', days:[] };
    for (const key of ['starts','every','kind','text','until_day']) form.elements.namedItem(key).value = editing[key] ?? '';
    for (const box of form.querySelectorAll('[name="day"]')) box.checked = editing.days.includes(Number(box.value));
    updateFields();
    $('reminder-form-status').textContent = '';
    editor.showModal();
  }

  function updateFields() {
    const kind = form.elements.namedItem('kind').value;
    $('reminder-interval').hidden = ['once','year'].includes(kind);
    $('reminder-weekdays').hidden = kind !== 'week';
  }

  async function change(action, item) {
    if (busy) return;
    busy = true;
    try {
      await operation(action,item.id, { run:item.last?.id });
      await load();
    } catch {
      $('reminder-status').textContent = 'Не удалось выполнить действие. Повторите попытку.';
    } finally { busy = false; }
  }

  function render(items) {
    const list=$('reminder-items');
    const sorted=selected ? items.filter(item => item.id===selected) : items;
    $('reminder-all').hidden = !selected;
    const cards = sorted.map(item => {
      const card=element('article','');
      card.className='week-day';
      card.append(element('h2',item.text));
      const next=item.paused ? 'На паузе' : item.next_at ? 'Следующее: '+timestamp(item.next_at) : 'Будущих отправок нет';
      card.append(element('p',labels[item.kind]+' · '+next));
      if(item.last) card.append(element('p','Последнее: '+timestamp(item.last.due)+' · '+(results[item.last.result]??item.last.result)+' · Выполнено: '+item.completed_count));
      const actions=element('div','');
      actions.className='week-toolbar';
      function button(label,call) {
        const control=element('button',label);
        control.type='button';
        control.addEventListener('click',call);
        actions.append(control);
      }
      button('Изменить',()=>edit(item));
      if(item.next_at || item.paused) button(item.paused?'Возобновить':'Приостановить',()=>void change(item.paused?'resume':'pause',item));
      if(item.last&&!item.last.completed) button('Отметить как завершённое',()=>void change('complete',item));
      button(item.kind==='once'?'В корзину':'Завершить сессию',()=>void change('trash',item));
      card.append(actions);
      if (item.history.length) {
        const journal=element('details','');
        journal.append(element('summary','Журнал отправок'));
        const entries=element('ul','');
        for (const run of item.history) {
          entries.append(element('li',timestamp(run.due)+' · Попытка: '+timestamp(run.attempted)+' · '+(results[run.result]??run.result)));
        }
        journal.append(entries);
        card.append(journal);
      }
      return card;
    });
    list.replaceChildren(...cards);
    $('reminder-status').textContent = cards.length ? '' : selected ? 'Напоминание недоступно.' : 'Напоминаний пока нет.';
  }

  async function load() {
    const attempt=++version;
    $('reminder-status').textContent='Загружаем напоминания…';
    try {
      const {items}=await operation('list');
      if(attempt===version) render(items);
    } catch {
      if(attempt===version) $('reminder-status').textContent='Не удалось загрузить напоминания. Откройте раздел ещё раз.';
    }
  }

  function route() {
    view.hidden = !enabled || location.hash !== '#reminders';
    $('reminders-nav').classList.toggle('current',!view.hidden);
    if (!view.hidden) {
      selected = new URL(location.href).searchParams.get('reminder');
      $('today-nav').classList.remove('current');
      $('today-nav').removeAttribute('aria-current');
      link.setAttribute('aria-current','page');
      void load();
    } else {
      link.removeAttribute('aria-current');
      version++;
    }
  }
  window.addEventListener('hashchange',route);
  $('reminder-all').addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.delete('reminder');
    history.replaceState(null, '', url);
    route();
  });
  $('reminder-new').addEventListener('click',()=>edit());
  $('reminder-cancel').addEventListener('click',()=>editor.close());
  form.elements.namedItem('kind').addEventListener('change',updateFields);
  form.addEventListener('submit',async (event)=>{
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled=true;
    try {
      const fields=new FormData(form);
      await operation('save',editing.id,{...Object.fromEntries(fields),every:['once','year'].includes(fields.get('kind')) ? 1 : fields.get('every')||1,
        days:fields.getAll('day').map(Number)});
      editor.close();
      await load();
    } catch {
      $('reminder-form-status').textContent='Не удалось сохранить. Проверьте дату и параметры повтора.';
    } finally { submit.disabled=false; }
  });
  return { enable(){ enabled=true;link.hidden=false;route(); },
    disable(){ enabled=false;link.hidden=true;$('reminder-items').replaceChildren();route(); } };
}
