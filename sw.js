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
  const reminder = message?.reminder;
  event.waitUntil(self.registration.showNotification(digestPattern.test(reminder ?? '') ? 'Напоминание ATLAS OS' : 'Карта вашего дня!', {
    body: typeof message?.body === 'string' ? message.body : 'Нажми, чтобы открыть сводку',
    data: { digest: digestPattern.test(digest ?? '') ? digest : null, reminder: digestPattern.test(reminder ?? '') ? reminder : null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const digest = event.notification.data?.digest;
  const target = new URL(self.registration.scope);
  if (digestPattern.test(digest ?? '')) target.searchParams.set('summary', digest);
  const reminder = event.notification.data?.reminder;
  if (digestPattern.test(reminder ?? '')) {
    target.searchParams.set('reminder', reminder);
    target.hash = 'reminders';
  }
  // The lock-screen launch must fetch the current shell instead of a stale copy.
  target.searchParams.set('launch', String(Date.now()));
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
