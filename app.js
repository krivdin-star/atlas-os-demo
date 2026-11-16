import { startAccess } from './access.js?v=20261116-7';

const moscowDate = new Intl.DateTimeFormat('en', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow',
});
const dateParts = Object.fromEntries(moscowDate.formatToParts().map(({ type, value }) => [type, value]));
const demonstrationDate = dateParts.year + '-' + dateParts.month + '-' + dateParts.day;

function dateAfter(dateKey, days) {
  const date = new Date(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const daily = {
  [demonstrationDate]: {
    events: [
      { from: '09:00', to: '10:30', title: 'Математический анализ', detail: 'Лекция · аудитория 302' },
      { from: '10:45', to: '12:15', title: 'Контрольная по линейной алгебре', detail: 'Практика · аудитория 214', important: true },
      { from: '14:00', to: '14:30', title: 'Встреча с учебной группой', detail: 'Обсуждение проекта · библиотека' },
    ],
    tasks: [
      { title: 'Сдать листок по линейной алгебре', detail: 'Сдать до 18:00', important: true },
      { title: 'Разобрать задачи на пределы', detail: 'Когда займусь · 16:00', done: true },
      { title: 'Дополнить конспект по физике', detail: 'Когда займусь · 19:00' },
    ],
  },
  [dateAfter(demonstrationDate, 1)]: {
    events: [{ from: '11:00', to: '12:30', title: 'Общая физика', detail: 'Семинар · аудитория 210' }],
    tasks: [{ title: 'Подготовить вопросы к семинару', detail: 'Когда займусь · 09:30' }],
  },
};

const byId = (id) => document.getElementById(id);
const formatDate = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
});
let selectedDate = demonstrationDate;
let savedDigest = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function titleBlock(entry, tag) {
  const block = element('span');
  if (entry.important) block.append(element('span', tag, 'row-tag'));
  block.append(element('strong', entry.title), element('small', entry.detail));
  return block;
}

function updateProgress(tasks) {
  const complete = tasks.filter(({ done }) => done).length;
  byId('progress').max = Math.max(1, tasks.length);
  byId('progress').value = complete;
  byId('progress-count').textContent = complete + ' / ' + tasks.length;
}

function render() {
  const { events, tasks } = savedDigest ?? daily[selectedDate] ?? { events: [], tasks: [] };
  const date = byId('date');
  date.dateTime = selectedDate;
  date.textContent = formatDate.format(new Date(selectedDate));
  byId('schedule-count').textContent = events.length;
  byId('task-count').textContent = tasks.length;
  byId('no-events').hidden = events.length > 0;
  byId('no-tasks').hidden = tasks.length > 0;

  byId('events').replaceChildren(...events.map((event) => {
    const row = element('li', '', event.important ? 'row event important' : 'row event');
    const time = element('time', event.from);
    time.dateTime = event.from;
    time.append(element('span', 'до ' + event.to));
    row.append(time, titleBlock(event, 'Важно'));
    return row;
  }));

  byId('task-list').replaceChildren(...tasks.map((task) => {
    const row = element('li', '', task.important ? 'row task important' : 'row task');
    const label = element('label');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = Boolean(task.done);
    input.disabled = savedDigest !== null;
    input.addEventListener('change', () => {
      task.done = input.checked;
      updateProgress(tasks);
    });
    label.append(input, titleBlock(task, 'Срочно'));
    row.append(label);
    return row;
  }));

  updateProgress(tasks);
}

function shiftDate(days) {
  selectedDate = dateAfter(selectedDate, days);
  render();
}

byId('previous').addEventListener('click', () => shiftDate(-1));
byId('next').addEventListener('click', () => shiftDate(1));
byId('reset').addEventListener('click', () => {
  selectedDate = demonstrationDate;
  render();
});

if (!startAccess((digest) => {
  savedDigest = digest;
  selectedDate = digest.date;
  byId('summary-label').textContent = 'Сохранённая тестовая сводка';
  for (const id of ['previous', 'next', 'reset']) byId(id).hidden = true;
  render();
})) {
  render();
  byId('digest-view').hidden = false;
}
