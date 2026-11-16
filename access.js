import { supabaseUrl, publishableKey } from './access-config.js';
import qrcode from './assets/qrcode.js';
import { setupPush } from './push.js';

const secretPattern = /^[0-9a-f]{64}$/u;
const digestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const sessionKey = 'atlas-os/atlas-os-demo:device:v1';
const byId = (id) => document.getElementById(id);

const errors = {
  unauthorized: 'Устройство нужно привязать заново.',
  invalid_invite: 'Приглашение недействительно, уже использовано или истекло.',
  invalid_session: 'Попробуйте привязать устройство ещё раз.',
  forbidden: 'QR-код можно создать на привязанном ПК.',
  not_found: 'Сохранённая сводка по этой ссылке не найдена.',
};
const networkError = 'Сервер недоступен. Проверьте соединение и повторите попытку.';

async function rpc(name, values) {
  const response = await fetch(supabaseUrl + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('RPC ' + response.status);
  return response.json();
}

function deviceToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function inviteFrom(value) {
  const text = value.trim();
  if (secretPattern.test(text)) return { code: text, digest: null };
  try {
    const url = new URL(text);
    if (url.origin !== location.origin || url.pathname !== location.pathname) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const code = fragment.get('pair');
    const digest = url.searchParams.get('summary');
    if (code && secretPattern.test(code)) {
      return {
        code,
        digest: digestPattern.test(digest ?? '') ? digest : null,
        fromQr: fragment.get('source') === 'qr',
      };
    }
  } catch {
    return null;
  }
  return null;
}

function drawQr(canvas, url) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const modules = qr.getModuleCount();
  const scale = 6;
  const quietZone = 4;
  canvas.width = canvas.height = (modules + 2 * quietZone) * scale;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) context.fillRect((col + quietZone) * scale, (row + quietZone) * scale, scale, scale);
    }
  }
}

async function copy(input, status, message) {
  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = message;
  } catch {
    input.hidden = false;
    input.focus();
    input.select();
    status.textContent = 'Ссылка выделена. Скопируйте её.';
  }
}

export function startAccess(showDigest) {
  if (!supabaseUrl || !publishableKey) return false;

  const route = new URL(location.href);
  const requested = route.searchParams.get('summary');
  let digestId = digestPattern.test(requested ?? '') ? requested : null;
  let session = null;
  const arrived = inviteFrom(location.href);
  if (new URLSearchParams(route.hash.slice(1)).has('pair')) {
    route.hash = '';
    history.replaceState(null, '', route);
  }

  const form = byId('pair-form');
  const input = byId('pair-code');
  const status = byId('access-status');
  const sessionStatus = byId('session-status');
  const digestView = byId('digest-view');
  const controls = byId('session-controls');
  const phoneInvite = byId('phone-invite');
  const savedLink = byId('saved-link');
  const message = (value, fallback) => errors[value] ?? fallback;
  const push = setupPush({ rpc, getSession: () => session, getDigest: () => digestId });

  function linkToDigest() {
    const url = new URL(location.pathname, location.origin);
    if (digestId) url.searchParams.set('summary', digestId);
    return url;
  }

  function qrInvitationLink(code) {
    const url = linkToDigest();
    url.hash = new URLSearchParams({ pair: code, source: 'qr' }).toString();
    return url;
  }

  function locked(text, setup = true) {
    digestView.hidden = true;
    controls.hidden = true;
    push.show(false);
    controls.open = false;
    phoneInvite.hidden = true;
    byId('summary-nav').hidden = true;
    byId('access-panel').hidden = false;
    form.hidden = !setup;
    status.textContent = text;
  }

  function forgetSession() {
    localStorage.removeItem(sessionKey);
    session = null;
  }

  async function openDigest(initial = false) {
    const result = await rpc('atlas_open_digest', { p_session: session, p_digest: digestId });
    if (result.error === 'unauthorized') {
      if (!initial) return false;
      forgetSession();
      locked(errors.unauthorized);
      return false;
    }
    if (result.error) {
      locked(message(result.error, networkError), false);
      byId('retry-access').hidden = false;
      return true;
    }

    digestId = result.digest.id;
    const link = linkToDigest();
    history.replaceState(null, '', link);
    savedLink.value = link.href;
    byId('access-panel').hidden = true;
    controls.hidden = false;
    push.show(result.kind === 'phone');
    byId('make-phone-invite').hidden = result.kind !== 'pc';
    byId('summary-nav').hidden = false;
    showDigest(result.digest);
    digestView.hidden = false;
    return true;
  }

  async function refresh(initial) {
    byId('retry-access').hidden = true;
    locked('Открываем сохранённую сводку…', false);
    try {
      return await openDigest(initial);
    } catch {
      locked(networkError, false);
      byId('retry-access').hidden = false;
      return false;
    }
  }

  byId('access-panel').hidden = false;
  digestView.hidden = true;
  byId('summary-nav').hidden = true;
  byId('retry-access').addEventListener('click', () => void refresh(true));

  if (arrived) input.value = arrived.code;
  if (arrived?.fromQr) {
    byId('forward-invite').hidden = false;
    byId('copy-arrived-invite').addEventListener('click', () => {
      const clipboardInput = byId('arrived-invite-url');
      clipboardInput.value = qrInvitationLink(arrived.code).href;
      void copy(clipboardInput, status, 'Приглашение скопировано. Вставьте его в ATLAS OS с домашнего экрана.');
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const invitation = inviteFrom(input.value);
    if (!invitation) {
      status.textContent = 'Вставьте ссылку или код приглашения ATLAS OS.';
      return;
    }
    if (invitation.digest) digestId = invitation.digest;
    const submit = byId('pair-submit');
    submit.disabled = true;
    status.textContent = 'Проверяем приглашение…';

    try {
      // Save the candidate before exchange so a reload can recover a committed session.
      if (!session) {
        session = deviceToken();
        localStorage.setItem(sessionKey, session);
      } else if (await openDigest()) {
        input.value = '';
        return;
      }

      const result = await rpc('atlas_exchange_invite', { p_code: invitation.code, p_session: session });
      if (result.error) {
        if (await openDigest()) return;
        forgetSession();
        locked(message(result.error, 'Не удалось привязать устройство.'));
        return;
      }
      input.value = '';
      await refresh(true);
    } catch {
      status.textContent = networkError;
    } finally {
      submit.disabled = false;
    }
  });

  byId('make-phone-invite').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    sessionStatus.textContent = '';
    try {
      const result = await rpc('atlas_make_phone_invite', { p_session: session });
      if (result.error === 'unauthorized') {
        forgetSession();
        locked(errors.unauthorized);
        return;
      }
      if (result.error) {
        sessionStatus.textContent = message(result.error, 'Не удалось создать QR-код.');
        return;
      }
      if (!controls.open) return;
      drawQr(byId('phone-qr'), qrInvitationLink(result.code).href);
      byId('invite-expires').textContent = 'Действует до ' + new Intl.DateTimeFormat('ru-RU', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow',
      }).format(new Date(result.expires_at)) + ' по Москве.';
      phoneInvite.hidden = false;
    } catch {
      sessionStatus.textContent = networkError;
    } finally {
      button.disabled = false;
    }
  });

  byId('copy-saved-link').addEventListener('click', () => void copy(savedLink, sessionStatus, 'Ссылка на сводку скопирована.'));
  controls.addEventListener('toggle', () => {
    if (controls.open) return;
    push.close();
    phoneInvite.hidden = true;
    savedLink.hidden = true;
    byId('phone-qr').width = 0;
    sessionStatus.textContent = '';
  });

  byId('logout').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await rpc('atlas_logout', { p_session: session });
      void push.unsubscribe().catch(() => {});
      forgetSession();
      byId('forward-invite').hidden = true;
      byId('arrived-invite-url').value = '';
      byId('arrived-invite-url').hidden = true;
      byId('phone-qr').width = 0;
      byId('events').replaceChildren();
      byId('task-list').replaceChildren();
      document.querySelector('video').pause();
      locked('Устройство вышло из ATLAS OS.');
    } catch {
      sessionStatus.textContent = networkError;
    } finally {
      button.disabled = false;
    }
  });

  try {
    session = localStorage.getItem(sessionKey);
    if (session) void refresh(true);
    else locked(arrived ? 'Ссылка готова к привязке.' : 'Откройте личную ссылку или вставьте приглашение.');
  } catch {
    locked('Для привязки устройству нужно разрешить хранение данных сайта.', false);
  }

  return true;
}
