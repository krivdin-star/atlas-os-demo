const digestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message;
  try {
    message = event.data?.json();
  } catch {
    message = null;
  }
  const digest = message?.digest;
  event.waitUntil(self.registration.showNotification('Карта вашего дня!', {
    body: typeof message?.body === 'string' ? message.body : 'Нажми, чтобы открыть сводку',
    data: { digest: digestPattern.test(digest ?? '') ? digest : null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const digest = event.notification.data?.digest;
  const target = new URL(self.registration.scope);
  if (digestPattern.test(digest ?? '')) target.searchParams.set('summary', digest);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = clients.find((client) => {
      const url = new URL(client.url);
      return url.origin === target.origin && url.pathname === target.pathname;
    });
    if (current) {
      try {
        const opened = current.url === target.href ? current : await current.navigate(target.href);
        if (opened) {
          await opened.focus();
          return;
        }
      } catch {
        // An existing window can close while the click is being handled.
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
