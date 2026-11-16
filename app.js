import { startAccess } from './access.js?v=20261116-17';

const byId = id => document.getElementById(id);
const moscow = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow',
});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
});
const shortDate = new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', timeZone:'UTC' });
const status = byId('work-digest-status');
const save = byId('save-work-digest');
const retry = byId('retry-work-digest');
const permanentLink = byId('work-digest-link');
function today() {
  const parts = Object.fromEntries(moscow.formatToParts().map(({type,value}) => [type,value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
let selectedDate = today();
let controls;
let snapshot = null;
let requestId = 0;
let pendingSave = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function dateTime(value) {
  const [date, clock] = value.split('T');
  return shortDate.format(new Date(date)) + ', ' + clock.slice(0,5);
}

function sourceTitle(entry, open) {
  if (!entry.id) return element('strong', entry.title);
  const button = element('button', entry.title, 'digest-source');
  button.type = 'button';
  button.addEventListener('click', async () => {
    try { await open(entry.id); }
    catch { status.textContent = 'Исходную запись не удалось открыть.'; }
  });
  return button;
}

function taskRow(task) {
  const row = element('li', '', 'row task' + (task.overdue || task.important ? ' important' : ''));
  if (task.overdue) row.append(element('span','Просрочено','row-tag'));
  row.append(sourceTitle(task,controls.openTask));
  if (task.subject) row.append(element('small',task.subject));
  if (task.group === 'due') row.append(element('small','Сдать до ' + dateTime(task.due_at)));
  else if (task.work_at) row.append(element('small','Когда займусь: ' + dateTime(task.work_at)));
  else if (task.detail) row.append(element('small',task.detail));
  return row;
}

function render(data = null) {
  const events = data?.events ?? [];
  const tasks = data?.tasks ?? [];
  const due = tasks.filter(task => task.group !== 'planned');
  const planned = tasks.filter(task => task.group === 'planned');
  const date = byId('date');
  date.dateTime = selectedDate;
  date.textContent = dateFormat.format(new Date(selectedDate));
  byId('summary-label').textContent = snapshot ? 'Сохранённая сводка' : 'Рабочая сводка';
  byId('schedule-count').textContent = data ? events.length : '';
  byId('task-count').textContent = data ? tasks.length : '';
  const missing = data?.covered === false;
  const noEvents = byId('no-events');
  noEvents.hidden = !data || (!missing && events.length > 0);
  noEvents.textContent = missing ? 'Расписание пар на этот день отсутствует.' : 'На этот день нет событий.';
  byId('no-tasks').hidden = !data || tasks.length > 0;
  byId('due-title').hidden = !data?.work_version || !due.length;
  byId('planned-title').hidden = !planned.length;
  byId('events').replaceChildren(...events.map(event => {
    const row = element('li', '', 'row event' + (event.important ? ' important' : ''));
    const time = element('time', event.from);
    time.dateTime = event.from;
    time.append(element('span', 'до ' + event.to));
    const body = element('span');
    if (event.important) body.append(element('span','Важно','row-tag'));
    body.append(sourceTitle(event,controls.openEvent), element('small',event.detail));
    row.append(time, body);
    return row;
  }));
  byId('task-list').replaceChildren(...due.map(taskRow));
  byId('planned-list').replaceChildren(...planned.map(taskRow));
  byId('progress-label').closest('section').hidden = !snapshot || Boolean(data?.work_version);
  if (snapshot && !data?.work_version) {
    const count = tasks.filter(task => task.done).length;
    byId('progress').max = Math.max(1,tasks.length);
    byId('progress').value = count;
    byId('progress-count').textContent = count + ' / ' + tasks.length;
  }
  for (const id of ['previous','next','reset']) byId(id).hidden = Boolean(snapshot);
  byId('open-live-digest').hidden = !snapshot;
  save.hidden = !data || Boolean(snapshot);
  permanentLink.hidden = !snapshot;
  if (snapshot) permanentLink.href = location.href;
}

async function load() {
  if (!controls || snapshot) return;
  const attempt = ++requestId;
  const day = selectedDate;
  status.textContent = 'Загружаем сводку…';
  retry.hidden = true;
  render();
  try {
    const data = await controls.work(day,null);
    if (attempt !== requestId) return;
    if (data.error) throw new Error(data.error);
    render(data);
    status.textContent = '';
  } catch {
    if (attempt !== requestId) return;
    retry.hidden = false;
    status.textContent = 'Сводка не загрузилась. Повтори попытку.';
  }
}

function chooseDate(day) {
  if (day < '2000-01-01' || day > '2099-12-31' || selectedDate === day) return;
  selectedDate = day;
  pendingSave = null;
  void load();
}

function shiftDate(delta) {
  const day = new Date(selectedDate);
  day.setUTCDate(day.getUTCDate() + delta);
  chooseDate(day.toISOString().slice(0,10));
}

byId('previous').addEventListener('click', () => shiftDate(-1));
byId('next').addEventListener('click', () => shiftDate(1));
byId('reset').addEventListener('click', () => {
  if (selectedDate === today()) void load();
  else chooseDate(today());
});
retry.addEventListener('click', () => void load());
byId('open-live-digest').addEventListener('click', () => {
  snapshot = null;
  pendingSave = null;
  controls.setSnapshot(null);
  void load();
});
save.addEventListener('click', async () => {
  const attempt = requestId;
  pendingSave ??= crypto.randomUUID();
  save.disabled = true;
  try {
    const data = await controls.work(selectedDate,pendingSave);
    if (requestId !== attempt) return;
    if (data.error) throw new Error(data.error);
    snapshot = data;
    pendingSave = null;
    controls.setSnapshot(data.id);
    render(data);
    status.textContent = 'Сводка сохранена.';
  } catch {
    if (requestId === attempt) status.textContent = 'Не удалось подтвердить сохранение. Повтори попытку.';
  } finally { save.disabled = false; }
});

window.addEventListener('hashchange', () => {
  if (!snapshot && ['','#summary','#schedule','#tasks'].includes(location.hash)) void load();
});
if (!startAccess((digest, api) => {
  controls = api;
  snapshot = digest;
  if (digest) {
    selectedDate = digest.date;
    status.textContent = '';
    render(digest);
  } else {
    selectedDate = today();
    void load();
  }
}, () => {
  requestId++;
  controls = null;
  snapshot = null;
  pendingSave = null;
})) {
  render();
  status.textContent = 'Подключение к рабочей базе не настроено.';
  byId('digest-view').hidden = false;
}
