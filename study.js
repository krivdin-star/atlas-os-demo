const byId = id => document.getElementById(id);
const fields = ['title', 'subject', 'source', 'due_at', 'planned_at', 'estimate_minutes', 'actual_minutes',
  'block_start', 'block_end', 'due_phrase', 'planned_phrase', 'due_zone', 'planned_zone'];
const fieldNames = {
  title: 'Название', subject: 'Предмет', source: 'Источник', due_at: 'Сдать до', planned_at: 'Когда займусь',
  block_start: 'Начало блока', block_end: 'Конец блока', due_phrase: 'Фраза для срока',
  planned_phrase: 'Фраза для пожелания', due_zone: 'Пояс срока', planned_zone: 'Пояс пожелания',
  estimate_minutes: 'Оценка, мин', actual_minutes: 'Фактически, мин', material_id: 'Материал', state: 'Статус',
};
const actions = { save: 'Сохранение', done: 'Завершение', skip: 'Пропуск', undo: 'Отмена правки',
  cancel: 'Отмена задачи', reopen: 'Возврат в работу' };
const states = { draft: 'Черновик', active: 'Текущая', done: 'Выполнена', skipped: 'Пропущена', cancelled: 'Отменена' };
const sections = { active: 'Текущих задач пока нет.', draft: 'Черновиков больше нет.', done: 'История задач пуста.' };
const errors = {
  unauthorized: 'Сеанс истёк. Откройте ATLAS OS заново.',
  conflict: 'Задача уже изменилась. Обновите список и повторите действие.',
  invalid: 'Проверьте название, даты и длительность.',
  invalid_schedule: 'Укажи оба времени блока и проверь их порядок. Для исходной фразы нужны дата и действительный часовой пояс.',
  cannot_undo: 'Последнюю правку уже нельзя отменить.',
  operation_conflict: 'Этот запрос уже использован для другой правки. Обнови список и повтори действие.',
  task_closed_block: 'Чтобы изменить блок, верни задачу в работу.',
};
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const historyTime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const baseWeek = Date.UTC(2026, 10, 9);
const day = 86400000;

function weekLabel(week) {
  const start = baseWeek + (week - 11) * 7 * day;
  return week + ' неделя · ' + dayFormat.formatRange(new Date(start), new Date(start + 6 * day));
}

function formatTime(value) {
  if (!value) return 'без времени';
  const [date, clock] = value.split('T');
  return dayFormat.format(new Date(date)) + ' · ' + clock.slice(0, 5);
}

function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function button(text, handler) {
  const control = node('button', text);
  control.type = 'button';
  control.addEventListener('click', handler);
  return control;
}

export function setupStudy(rpc, getSession, showMaterial) {
  const view = byId('study');
  const nav = byId('study-nav');
  const section = byId('study-section');
  const list = byId('study-items');
  const status = byId('study-status');
  const editor = byId('study-editor');
  const form = byId('study-form');
  const save = byId('study-save');
  const retry = byId('study-retry');
  const formStatus = byId('study-form-status');
  let enabled = false;
  let requestId = 0;
  let current = null;
  let changing = false;
  let items = [];
  let materials = [];
  const operations = new Map();

  async function request(action, item = null, data = {}) {
    const result = await rpc('atlas_study_tasks', {
      p_session: getSession(),
      p_action: action,
      p_id: item?.id ?? null,
      p_data: { ...data, revision: item?.revision ?? null },
    }, AbortSignal.timeout(10000));
    if (result.error) throw new Error(result.error);
    return result;
  }

  async function mutate(action, item, data = {}) {
    const key = JSON.stringify([action, item.id, item.revision, data]);
    if (!operations.has(key)) operations.set(key, crypto.randomUUID());
    const result = await request(action, item, { ...data, operation_id: operations.get(key) });
    operations.delete(key);
    return result;
  }

  function edit(item = null) {
    current = item ?? { id: crypto.randomUUID() };
    byId('study-editor-title').textContent = item?.state === 'draft' ? 'Проверить черновик' : item ? 'Изменить задачу' : 'Новая задача';
    save.textContent = item?.state === 'draft' ? 'Добавить в задачи' : 'Сохранить';
    for (const key of fields) form.elements.namedItem(key).value = current[key] ?? '';
    const closed = ['done', 'cancelled'].includes(current.state);
    byId('study-block').disabled = closed;
    byId('study-closed-block-note').hidden = !closed;
    byId('study-date-sources').open = Boolean(current.due_phrase || current.planned_phrase);
    const select = form.elements.namedItem('material_id');
    select.replaceChildren(new Option('Без материала', ''));
    if (current.material_id && !materials.some(material => material.id === current.material_id)) {
      select.add(new Option(current.material_title, current.material_id));
    }
    for (const material of materials) select.add(new Option(material.title, material.id));
    select.value = current.material_id ?? '';
    formStatus.textContent = '';
    editor.showModal();
  }

  function changeValue(key, value) {
    if (value == null || value === '') return '—';
    if (['due_at', 'planned_at', 'block_start', 'block_end'].includes(key)) return formatTime(value);
    if (key === 'state') return states[value] ?? value;
    if (key === 'material_id') return materials.find(item => item.id === value)?.title ?? value;
    return String(value);
  }

  function makeHistory(item) {
    const history = node('details', '');
    const entries = node('ol', '');
    const latest = item.operations[0];
    for (const operation of item.operations) {
      const entry = node('li', '');
      const device = { pc: 'ПК', phone: 'iPhone' }[operation.device_kind] ?? operation.device_kind;
      const time = historyTime.format(new Date(operation.changed_at));
      entry.append(node('p', actions[operation.action] + ' · ' + device + ' · ' + time + ' · версия ' + operation.revision));
      const changes = node('ul', '');
      for (const [key, after] of Object.entries(operation.after_fields)) {
        if (!fieldNames[key]) continue;
        const before = changeValue(key, operation.before_fields[key]);
        changes.append(node('li', fieldNames[key] + ': ' + before + ' → ' + changeValue(key, after)));
      }
      entry.append(changes, node('small', 'Операция ' + operation.id));
      entries.append(entry);
    }
    history.append(node('summary', 'История изменений'), entries);
    if (latest.action === 'save' && Object.keys(latest.before_fields).length && !('state' in latest.before_fields)) {
      history.append(button('Отменить последнюю правку', () => void change('undo', item)));
    }
    return history;
  }

  function makeCard(item) {
    const card = node('article', '');
    card.className = 'week-day';
    card.append(node('h2', item.title));
    if (['done', 'cancelled'].includes(item.state)) card.append(node('p', states[item.state]));
    if (item.subject) card.append(node('p', item.subject));
    if (item.study_week) card.append(node('p', weekLabel(item.study_week)));
    if (item.due_at) card.append(node('p', 'Сдать до: ' + formatTime(item.due_at)));
    if (item.planned_at) card.append(node('p', 'Когда займусь: ' + formatTime(item.planned_at)));
    if (item.block_start && item.block_end) {
      card.append(node('p', 'Блок работы: ' + formatTime(item.block_start) + ' — ' + formatTime(item.block_end)));
    }
    if (item.due_phrase) card.append(node('p', 'Фраза для срока: «' + item.due_phrase + '» · ' + item.due_zone));
    if (item.planned_phrase) card.append(node('p', 'Фраза для пожелания: «' + item.planned_phrase + '» · ' + item.planned_zone));
    if (item.estimate_minutes !== null) card.append(node('p', 'Оценка: ' + item.estimate_minutes + ' мин'));
    if (item.actual_minutes !== null) card.append(node('p', 'Фактически: ' + item.actual_minutes + ' мин'));
    if (item.source) card.append(node('p', 'Источник: ' + item.source));
    const actions = node('div', '');
    actions.className = 'week-toolbar';
    actions.append(button(item.state === 'draft' ? 'Проверить и добавить' : 'Изменить', () => edit(item)));
    if (item.state === 'draft') actions.append(button('Пропустить', () => void change('skip', item)));
    if (item.state === 'active') {
      actions.append(button('Завершить', () => void change('done', item)),
        button('Отменить задачу', () => void change('cancel', item)));
    }
    if (['done', 'cancelled'].includes(item.state)) {
      actions.append(button(item.state === 'done' ? 'Отменить завершение' : 'Вернуть в работу', () => void change('reopen', item)));
    }
    if (item.material_id) actions.append(button('Материал: ' + item.material_title, () => showMaterial(item.material_id)));
    card.append(actions);
    if (item.moves.length) {
      const history = node('details', '');
      const entries = node('ul', '');
      for (const move of item.moves) entries.append(node('li', formatTime(move.old_time) + ' → ' + formatTime(move.new_time)));
      history.append(node('summary', 'История переносов'), entries);
      card.append(history);
    }
    if (item.operations?.length) card.append(makeHistory(item));
    return card;
  }

  function render() {
    const cards = items.filter(item => item.state === section.value ||
      (section.value === 'done' && item.state === 'cancelled')).map(makeCard);
    const drafts = items.filter(item => item.state === 'draft').length;
    section.querySelector('[value=draft]').textContent = drafts ? 'Черновики (' + drafts + ')' : 'Черновики';
    list.replaceChildren(...cards);
    status.textContent = cards.length ? '' : sections[section.value];
  }

  async function load(notice = '') {
    const attempt = ++requestId;
    retry.hidden = true;
    status.textContent = 'Загружаем задачи…';
    try {
      const result = await request('list');
      if (attempt !== requestId) return;
      items = result.items;
      materials = result.materials;
      render();
      if (notice) status.textContent = notice;
    } catch (error) {
      if (attempt !== requestId) return;
      status.textContent = errors[error.message] ?? 'Не удалось загрузить задачи.';
      retry.hidden = false;
    }
  }

  async function change(action, item) {
    if (changing) return;
    changing = true;
    try {
      await mutate(action, item);
      const notices = { done: 'Задача перенесена в историю.', skip: 'Черновик пропущен.', undo: 'Правка отменена.',
        cancel: 'Задача отменена.', reopen: 'Задача возвращена в работу. Проверь её блок и напоминания.' };
      await load(notices[action]);
    } catch (error) {
      status.textContent = errors[error.message] ?? 'Не удалось выполнить действие.';
      retry.hidden = false;
    } finally {
      changing = false;
    }
  }

  function route() {
    view.hidden = !enabled || location.hash !== '#study';
    nav.classList.toggle('current', !view.hidden);
    if (view.hidden) {
      nav.removeAttribute('aria-current');
      requestId++;
    } else {
      byId('today-nav').classList.remove('current');
      byId('today-nav').removeAttribute('aria-current');
      nav.setAttribute('aria-current', 'page');
      void load();
    }
  }

  window.addEventListener('hashchange', route);
  section.addEventListener('change', render);
  retry.addEventListener('click', () => void load());
  byId('study-new').addEventListener('click', () => edit());
  byId('study-cancel').addEventListener('click', () => editor.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    formStatus.textContent = 'Сохраняем задачу…';
    const item = current;
    try {
      await mutate('save', item, Object.fromEntries(new FormData(form)));
      editor.close();
      if (item.state === 'draft' || !item.state) section.value = 'active';
      await load('Задача сохранена.');
    } catch (error) {
      formStatus.textContent = errors[error.message] ?? 'Не удалось подтвердить сохранение. Повторите попытку.';
    } finally {
      save.disabled = false;
    }
  });

  return {
    enable() { enabled = true; nav.hidden = false; route(); },
    disable() {
      enabled = false;
      nav.hidden = true;
      items = [];
      materials = [];
      operations.clear();
      if (editor.open) editor.close();
      list.replaceChildren();
      route();
    },
  };
}
