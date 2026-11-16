import { supabaseUrl, publishableKey } from './access-config.js';
import { vapidPublicKey } from './push-config.js';

const messages = {
  pending: 'Проба принята. Результат появится после отправки.',
  accepted: 'Служба Apple приняла уведомление. Проверьте экран блокировки.',
  expired: 'Подписка истекла. Включите уведомления заново.',
  failed: 'Служба доставки не подтвердила отправку. Повторите пробу.',
  no_subscription: 'Сначала включите уведомления на этом iPhone.',
  rate_limited: 'Подождите 40 секунд с момента предыдущего запроса.',
  unauthorized: 'Сеанс истёк. Откройте сводку заново.',
};
const unavailable = 'Проверьте соединение и повторите попытку.';
const denied = 'Уведомления запрещены. Разрешение можно изменить в настройках iPhone.';

function applicationKey() {
  const base64 = vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}

export function setupPush({ rpc, getSession, getDigest }) {
  const tools = document.getElementById('push-tools');
  const enable = document.getElementById('push-enable');
  const send = document.getElementById('push-send');
  const variant = document.getElementById('push-variant');
  const status = document.getElementById('push-status');
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let registration;
  let subscription;
  let expired = false;

  // Starting the worker early leaves the permission request in the direct click handler.
  const worker = supported
    ? navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready).catch(() => null)
    : Promise.resolve(null);

  async function refresh() {
    send.disabled = true;
    if (!supported) {
      enable.disabled = true;
      status.textContent = 'Откройте ATLAS OS с домашнего экрана iPhone.';
      return;
    }
    if (Notification.permission === 'denied') {
      enable.disabled = true;
      status.textContent = denied;
      return;
    }
    enable.disabled = true;
    status.textContent = 'Проверяем уведомления…';
    try {
      registration = await worker;
      if (!registration) throw new Error('No service worker');
      const [local, server] = await Promise.all([
        registration.pushManager.getSubscription(),
        rpc('atlas_push_state', { p_session: getSession() }),
      ]);
      subscription = local;
      expired = server.result === 'expired';
      enable.disabled = Boolean(subscription && server.subscribed && !expired);
      send.disabled = !enable.disabled || Notification.permission !== 'granted';
      status.textContent = messages[server.error] ?? messages[server.result]
        ?? (send.disabled ? 'Включите уведомления для пробной отправки.' : 'Уведомления включены.');
    } catch {
      status.textContent = unavailable;
      enable.disabled = !registration;
    }
  }

  tools.addEventListener('toggle', () => {
    if (tools.open && !tools.hidden) void refresh();
  });

  enable.addEventListener('click', async () => {
    enable.disabled = true;
    status.textContent = 'Настраиваем уведомления…';
    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') {
        status.textContent = permission === 'denied' ? denied : 'Разрешение пока не выдано.';
        enable.disabled = permission === 'denied';
        return;
      }
      if (expired && subscription) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(),
      });
      const { endpoint, keys } = subscription.toJSON();
      const result = await rpc('atlas_push_save', {
        p_session: getSession(),
        p_endpoint: endpoint,
        p_p256dh: keys?.p256dh?.replace(/=+$/u, ''),
        p_auth: keys?.auth?.replace(/=+$/u, ''),
      });
      if (!result.ok) throw new Error(result.error);
      expired = false;
      send.disabled = false;
      status.textContent = 'Уведомления включены. Можно отправить пробу.';
    } catch {
      enable.disabled = false;
      status.textContent = unavailable;
    }
  });

  send.addEventListener('click', async () => {
    send.disabled = true;
    status.textContent = 'Запрашиваем отправку…';
    try {
      const response = await fetch(supabaseUrl + '/functions/v1/atlas-push', {
        method: 'POST',
        headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        body: JSON.stringify({ session: getSession(), digest: getDigest(), variant: variant.value }),
      });
      const result = await response.json();
      status.textContent = result.ok
        ? 'Проба принята. Закройте ATLAS OS и заблокируйте iPhone. Отправка через ' + result.seconds + ' секунд.'
        : messages[result.error] ?? unavailable;
    } catch {
      status.textContent = unavailable;
    } finally {
      send.disabled = false;
    }
  });

  return {
    show(isPhone) {
      tools.hidden = !isPhone;
      if (!isPhone) tools.open = false;
    },
    close() {
      tools.open = false;
    },
    async unsubscribe() {
      const ready = await worker;
      const local = await ready?.pushManager.getSubscription();
      if (local) await local.unsubscribe();
    },
  };
}
