import { supabaseUrl } from './access-config.js';
import { requestAtlas } from './digest-request.js';

const byId = id => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const moscowDate = new Intl.DateTimeFormat('en', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow',
});
const firstStudyWeek = '2026-11-09'; // 11-я неделя по утверждённому расписанию.
const firstStudyWeekNumber = 11;
const lastStudyWeek = '2026-12-28';
const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
const message = {
  unauthorized: 'Сеанс истёк. Откройте ATLAS OS заново.',
  invalid_event: 'Проверьте дату, название и время. Окончание должно быть позже начала.',
  conflict: 'Событие уже изменилось. Откройте его заново и повторите правку.',
};

function today() {
  const p = Object.fromEntries(moscowDate.formatToParts().map(({ type, value }) => [type, value]));
  return p.year + '-' + p.month + '-' + p.day;
}

function shift(day, days) {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(day) {
  return shift(day, -((new Date(day).getUTCDay() + 6) % 7));
}

function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}

export function setupSchedule(getSession) {
  const view = byId('week');
  const digest = byId('digest-view');
  const nav = byId('week-nav');
  const home = byId('today-nav');
  const weekDays = byId('week-days');
  const weekStatus = byId('week-status');
  const editor = byId('event-editor');
  const form = byId('event-form');
  const formStatus = byId('event-status');
  const save = byId('event-save');
  const cancel = byId('event-cancel');
  let enabled = false;
  let requestNumber = 0;
  let monday = mondayOf(today());
  let editing = null;

  function api(action, args) {
    return requestAtlas(supabaseUrl, 'atlas-calendar', { session: getSession(), action, ...args });
  }

  function edit(event) {
    editing = event;
    byId('event-title').textContent = event.revision ? 'Изменить событие' : 'Новое событие';
    for (const key of ['day', 'start', 'end', 'kind', 'title', 'detail']) {
      form.elements.namedItem(key).value = event[key];
    }
    formStatus.textContent = '';
    editor.showModal();
  }

  function render(result) {
    const resultDays = [];
    for (let i = 0; i < 7; i++) {
      const day = shift(monday, i);
      const card = node('section', '', 'week-day');
      const heading = node('h2', dayFormat.format(new Date(day)));
      card.append(heading);
      const events = result.events.filter(e => e.day === day);
      if (!events.length) {
        card.append(node('p', result.covered.includes(day) ? 'Свободный день' : 'Расписание пар отсутствует', 'week-empty'));
      } else {
        const list = node('ul', '', 'week-events');
        for (const e of events) {
          const overlap = events.some(other => other.id !== e.id && other.start < e.end && e.start < other.end);
          const item = node('li');
          const button = node('button', '', 'schedule-event');
          button.type = 'button';
          button.append(node('span', e.start + '–' + e.end, 'event-time'), node('strong', e.title));
          button.append(node('small', [e.kind === 'class' ? 'Пара' : 'Встреча', e.detail].filter(Boolean).join(' · ')));
          if (overlap) button.append(node('small', 'Пересечение по времени', 'event-overlap'));
          button.addEventListener('click', () => edit(e));
          item.append(button);
          list.append(item);
        }
        card.append(list);
        if (!result.covered.includes(day)) card.append(node('p', 'Расписание пар на этот день отсутствует', 'week-empty'));
      }
      resultDays.push(card);
    }
    weekDays.replaceChildren(...resultDays);
  }

  async function load() {
    if (!enabled || view.hidden) return;
    const attempt = ++requestNumber;
    const chosen = monday;
    const last = new Date(shift(chosen, 6));
    byId('week-range').textContent = dateFormat.formatRange(new Date(chosen), last);
    const covered = chosen >= firstStudyWeek && chosen <= lastStudyWeek;
    const weekNumber = firstStudyWeekNumber + (Date.parse(chosen) - Date.parse(firstStudyWeek)) / millisecondsPerWeek;
    byId('week-number').textContent = covered ? weekNumber + ' неделя' : '';
    byId('week-number').hidden = !covered;
    weekStatus.textContent = 'Загружаем расписание…';
    byId('week-retry').hidden = true;
    weekDays.replaceChildren();
    try {
      const result = await api('week', { monday: chosen });
      if (attempt !== requestNumber) return;
      if (result.error) throw new Error(message[result.error] ?? 'Не удалось открыть эту неделю.');
      render(result);
      weekStatus.textContent = '';
    } catch (error) {
      if (attempt !== requestNumber) return;
      weekStatus.textContent = error.message.match(/^[А-Яа-яЁё]/u) ? error.message : 'Расписание не загрузилось. Проверьте соединение.';
      byId('week-retry').hidden = false;
    }
  }

  function go(day) {
    const chosen = mondayOf(day);
    if (chosen < '2000-01-03' || chosen > '2099-12-28') return;
    monday = chosen;
    void load();
  }

  function syncRoute() {
    const open = enabled && location.hash === '#week';
    view.hidden = !open;
    if (enabled) digest.hidden = open;
    nav.classList.toggle('current', open);
    home.classList.toggle('current', !open);
    if (open) {
      home.removeAttribute('aria-current');
      nav.setAttribute('aria-current', 'page');
      void load();
    } else {
      nav.removeAttribute('aria-current');
      home.setAttribute('aria-current', 'page');
      requestNumber++;
    }
  }

  window.addEventListener('hashchange', syncRoute);
  byId('week-previous').addEventListener('click', () => go(shift(monday, -7)));
  byId('week-next').addEventListener('click', () => go(shift(monday, 7)));
  byId('week-reset').addEventListener('click', () => go(today()));
  byId('week-retry').addEventListener('click', () => void load());
  byId('event-new').addEventListener('click', () => {
    const date = today();
    edit({ id: crypto.randomUUID(), revision: null, day: mondayOf(date) === monday ? date : monday,
      start: '', end: '', kind: 'meeting', title: '', detail: '' });
  });
  cancel.addEventListener('click', () => editor.close());
  editor.addEventListener('cancel', (event) => { if (save.disabled) event.preventDefault(); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    if (fields.start >= fields.end || !fields.title.trim()) {
      formStatus.textContent = message.invalid_event;
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    try {
      const result = await api('save', { event: { ...fields, id: editing.id, revision: editing.revision } });
      if (result.error) {
        formStatus.textContent = message[result.error] ?? 'Не удалось сохранить событие.';
        if (result.error === 'conflict') void load();
        return;
      }
      editor.close();
      go(result.event.day);
    } catch {
      formStatus.textContent = 'Ответ сервера не получен. Проверьте соединение и повторите сохранение.';
    } finally {
      save.disabled = false;
      cancel.disabled = false;
    }
  });

  return {
    enable() {
      enabled = true;
      nav.href = '#week';
      syncRoute();
    },
    disable() {
      enabled = false;
      nav.href = '#schedule';
      weekDays.replaceChildren();
      if (editor.open) editor.close();
      syncRoute();
    },
  };
}
