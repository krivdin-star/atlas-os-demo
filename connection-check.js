import { supabaseUrl, publishableKey } from './access-config.js';

const invalidSession = '0'.repeat(64);
const edgeUrl = supabaseUrl + '/functions/v1/atlas-read-digest';
const alternateUrl = supabaseUrl.replace('.supabase.co', '.functions.supabase.co') + '/atlas-read-digest';
const plainPost = {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  body: JSON.stringify({ session: invalidSession, digest: null }),
};
const checks = [
  { name: 'Страница приложения', url: './manifest.webmanifest', expected: 200 },
  { name: 'Сервер — GET', url: edgeUrl, expected: 405, error: 'method' },
  { name: 'Сервер — POST', url: edgeUrl, options: plainPost, expected: 200, error: 'unauthorized' },
  { name: 'Прямое чтение API', url: supabaseUrl + '/rest/v1/rpc/atlas_open_digest', expected: 200, error: 'unauthorized',
    options: { method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_session: invalidSession, p_digest: null }) } },
  { name: 'Другой адрес сервера', url: alternateUrl, options: plainPost, expected: 200, error: 'unauthorized' },
];
const runButton = document.getElementById('run-check');
const copyButton = document.getElementById('copy-check');
const list = document.getElementById('check-results');
const state = document.getElementById('check-state');
const report = document.getElementById('check-report');

async function check(entry, row) {
  const controller = new AbortController();
  const started = performance.now();
  let phase = 'соединение';
  let httpStatus;
  let timer;
  let result;
  row.textContent = entry.name + ' — проверяем…';
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
      controller.abort();
    }, 15000);
  });
  try {
    await Promise.race([deadline, (async () => {
      const response = await fetch(entry.url, { ...entry.options, signal: controller.signal,
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      httpStatus = response.status;
      phase = 'чтение ответа';
      const data = await response.json();
      result = response.status === entry.expected && (!entry.error || data.error === entry.error)
        ? 'доступен' : 'неожиданный ответ';
    })()]);
  } catch (error) {
    result = error.message === 'timeout' ? 'тайм-аут, ' + phase : 'сетевая ошибка, ' + phase;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  const line = entry.name + ' — ' + result + (httpStatus ? ', HTTP ' + httpStatus : '') + ', ' + elapsed + ' с';
  row.textContent = line;
  return line;
}

async function run() {
  runButton.disabled = true;
  copyButton.disabled = true;
  report.hidden = true;
  state.textContent = 'Проверяем соединение…';
  list.replaceChildren();
  try {
    const lines = await Promise.all(checks.map(entry => {
      const row = document.createElement('li');
      list.append(row);
      return check(entry, row);
    }));
    report.value = ['ATLAS network 20261117-02', new Date().toISOString(),
      'Режим приложения: ' + Boolean(navigator.standalone || matchMedia('(display-mode: standalone)').matches),
      navigator.userAgent, ...lines].join('\n');
    state.textContent = 'Проверка завершена. Скопируй результат и отправь его в чат.';
    copyButton.disabled = false;
  } finally { runButton.disabled = false; }
}

runButton.addEventListener('click', () => void run());
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(report.value);
    state.textContent = 'Результат скопирован.';
  } catch {
    report.hidden = false;
    report.select();
    state.textContent = 'Выделенный результат можно скопировать вручную.';
  }
});
void run();
