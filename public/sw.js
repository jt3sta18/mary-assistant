// Mary Service Worker — meeting reminders
const REMINDER_MINS = [60, 30, 15, 5];
const scheduled = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "SCHEDULE_EVENTS") {
    scheduleAll(event.data.events || []);
  }
});

function scheduleAll(events) {
  // Clear old timers
  scheduled.forEach((ids) => ids.forEach(clearTimeout));
  scheduled.clear();

  const now = Date.now();

  events.forEach((ev) => {
    if (!ev.start) return;
    const startMs = new Date(ev.start).getTime();
    const ids = [];

    REMINDER_MINS.forEach((mins) => {
      const fireAt = startMs - mins * 60000;
      const delay = fireAt - now;
      if (delay > 0 && delay < 25 * 3600000) {
        const id = setTimeout(() => {
          const label = mins === 60 ? "1 hour" : `${mins} min`;
          self.registration.showNotification(`📅 ${ev.title} in ${label}`, {
            body: ev.location ? `📍 ${ev.location}` : "Tap to open Mary",
            tag: `mary-event-${ev.start}-${mins}`,
            requireInteraction: mins <= 15,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            vibrate: mins <= 15 ? [200, 100, 200, 100, 200] : [200],
            data: { url: "/" },
          });
        }, delay);
        ids.push(id);
      }
    });

    // Also fire AT the meeting start
    const startDelay = startMs - now;
    if (startDelay > 0 && startDelay < 25 * 3600000) {
      const id = setTimeout(() => {
        self.registration.showNotification(`🔴 ${ev.title} is starting NOW`, {
          body: ev.location ? `📍 ${ev.location}` : "Your meeting is starting!",
          tag: `mary-event-${ev.start}-now`,
          requireInteraction: true,
          icon: "/icon-192.png",
          vibrate: [300, 100, 300, 100, 300],
          data: { url: "/" },
        });
      }, startDelay);
      ids.push(id);
    }

    if (ids.length) scheduled.set(ev.start, ids);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((list) => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow(event.notification.data?.url || "/");
    })
  );
});
