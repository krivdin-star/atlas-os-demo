import { supabaseUrl } from './access-config.js';

const byId = id => document.getElementById(id);
const labels = {
  unauthorized: 'Сеанс истёк. Откройте ATLAS OS заново.',
  unsupported_file: 'Выберите PDF, Markdown в UTF-8, JPEG или PNG.',
  too_large: 'Размер файла превышает 6 МБ.',
  invalid_metadata: 'Проверьте название, предмет и источник.',
  not_found: 'Материал недоступен. Обновите список.',
};
const empty = { active: 'Материалов пока нет.', archived: 'Архив пуст.', trashed: 'Корзина пуста.' };

function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

export function setupLibrary(getSession) {
  const view = byId('library');
  const nav = byId('library-nav');
  const section = byId('library-section');
  const list = byId('library-items');
  const status = byId('library-status');
  const editor = byId('library-editor');
  const form = byId('library-form');
  const reader = byId('library-reader');
  const original = byId('library-original');
  const download = byId('library-download');
  const preview = byId('library-reader-text');
  const readerStatus = byId('library-reader-status');
  const save = byId('library-save');
  const retry = byId('library-retry');
  let enabled = false;
  let loadId = 0;
  let readerId = 0;
  let items = [];
  let target = null;
  let changing = false;

  async function request(action, data = {}) {
    const body = data instanceof FormData ? data : JSON.stringify({ session: getSession(), action, ...data });
    if (body instanceof FormData) body.set('session', getSession());
    const response = await fetch(supabaseUrl + '/functions/v1/atlas-library', {
      method: 'POST', body,
      headers: body instanceof FormData ? undefined : { 'Content-Type': 'text/plain;charset=UTF-8' },
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(body instanceof FormData ? 60000 : 12000),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error ?? 'unavailable');
    return result;
  }

  function edit(item = null) {
    target = item?.id ?? null;
    form.reset();
    byId('library-editor-title').textContent = item ? 'Загрузить новую версию' : 'Добавить файл';
    byId('library-description').hidden = Boolean(item);
    for (const key of ['title', 'subject', 'topic', 'source']) form.elements.namedItem(key).disabled = Boolean(item);
    byId('library-form-status').textContent = '';
    editor.showModal();
  }

  function resetReader() {
    readerId++;
    for (const link of [original, download]) {
      link.hidden = true;
      link.removeAttribute('href');
    }
    preview.hidden = true;
    preview.textContent = '';
  }

  async function open(item, version) {
    resetReader();
    const attempt = readerId;
    byId('library-reader-title').textContent = version.filename;
    readerStatus.textContent = 'Готовим файл…';
    reader.showModal();
    try {
      const result = await request('open', { id: item.id, version: version.number });
      if (attempt !== readerId) return;
      const url = new URL(result.url);
      if (url.origin !== new URL(supabaseUrl).origin) throw new Error('unavailable');
      original.href = url.href;
      original.hidden = false;
      url.searchParams.set('download', version.filename);
      download.href = url.href;
      download.hidden = false;
      readerStatus.textContent = 'Ссылка действует 90 секунд.';
      if (result.mime === 'text/plain') {
        const response = await fetch(original.href, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('unavailable');
        const text = await response.text();
        if (attempt !== readerId) return;
        preview.textContent = text;
        preview.hidden = false;
      }
    } catch (error) {
      if (attempt === readerId) readerStatus.textContent = labels[error.message] ?? 'Не удалось загрузить файл. Попробуйте открыть его ещё раз.';
    }
  }

  function button(text, handler) {
    const control = node('button', text);
    control.type = 'button';
    control.addEventListener('click', handler);
    return control;
  }

  function render() {
    const cards = items.filter(item => item.state === section.value).map(item => {
      const card = node('article', '');
      card.className = 'week-day';
      card.append(node('h2', item.title), node('p', [item.subject, item.topic].filter(Boolean).join(' · ')),
        node('p', 'Источник: ' + item.source));
      const versions = node('ul', '');
      versions.className = 'week-events';
      for (const version of item.versions) {
        const row = node('li', '');
        row.append(button(version.filename + ' · версия ' + version.number, () => void open(item, version)));
        versions.append(row);
      }
      card.append(versions);
      const actions = node('div', '');
      actions.className = 'week-toolbar';
      if (item.state === 'active') {
        actions.append(button('Новая версия', () => edit(item)), button('В архив', () => void change('archive', item.id)));
      } else {
        actions.append(button('Восстановить', () => void change('restore', item.id)));
      }
      card.append(actions);
      return card;
    });
    byId('library-clear').hidden = section.value !== 'archived' || !cards.length;
    list.replaceChildren(...cards);
    status.textContent = cards.length ? '' : empty[section.value];
  }

  async function load(notice = '') {
    const attempt = ++loadId;
    retry.hidden = true;
    status.textContent = 'Загружаем материалы…';
    try {
      const result = await request('list');
      if (attempt !== loadId) return;
      items = result.items;
      render();
      if (notice) status.textContent = notice;
    } catch (error) {
      if (attempt !== loadId) return;
      status.textContent = labels[error.message] ?? 'Не удалось загрузить библиотеку.';
      retry.hidden = false;
    }
  }

  async function change(action, id) {
    if (changing) return;
    changing = true;
    try {
      await request(action, { id });
      await load();
    } catch (error) {
      status.textContent = labels[error.message] ?? 'Не удалось выполнить действие. Повторите попытку.';
    } finally {
      changing = false;
    }
  }

  function route() {
    view.hidden = !enabled || location.hash !== '#library';
    nav.classList.toggle('current', !view.hidden);
    if (view.hidden) {
      nav.removeAttribute('aria-current');
      loadId++;
      return;
    }
    byId('today-nav').classList.remove('current');
    byId('today-nav').removeAttribute('aria-current');
    nav.setAttribute('aria-current', 'page');
    void load();
  }

  window.addEventListener('hashchange', route);
  section.addEventListener('change', render);
  retry.addEventListener('click', () => void load());
  byId('library-new').addEventListener('click', () => edit());
  byId('library-cancel').addEventListener('click', () => editor.close());
  byId('library-reader-close').addEventListener('click', () => reader.close());
  reader.addEventListener('close', resetReader);
  byId('library-clear').addEventListener('click', () => {
    if (window.confirm('Переместить все архивные материалы в корзину?')) void change('clear_archive');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    const feedback = byId('library-form-status');
    const data = new FormData(form);
    const file = data.get('file');
    if (!file?.size || !/\.(pdf|md|jpe?g|png)$/iu.test(file.name)) {
      feedback.textContent = labels.unsupported_file;
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      feedback.textContent = labels.too_large;
      return;
    }
    if (target) data.set('id', target);
    save.disabled = true;
    feedback.textContent = 'Загружаем файл…';
    try {
      const result = await request('save', data);
      editor.close();
      await load(result.duplicate ? 'Этот оригинал уже есть в библиотеке.' : 'Файл сохранён.');
    } catch (error) {
      feedback.textContent = labels[error.message] ?? 'Не удалось подтвердить сохранение. Повторите загрузку.';
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
      list.replaceChildren();
      if (editor.open) editor.close();
      if (reader.open) reader.close();
      resetReader();
      route();
    },
  };
}
