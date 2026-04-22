// Mary Service Worker — reliable notification delivery
// The main thread handles all timing/scheduling via setInterval.
// This SW's only job is to show the notification (works even when tab is backgrounded)
// and handle notification clicks.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

// Main thread posts FIRE_NOTIFICATION when a reminder or alert is due
self.addEventListener("message", (event) => {
  if (event.data?.type === "FIRE_NOTIFICATION") {
    const { title, options } = event.data;
    self.registration.showNotification(title, {
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [200, 100, 200],
      requireInteraction: true,
      data: { url: "/" },
      ...options,
    });
  }
});

// Tap notification → bring Mary to front (or open it)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const maryTab = list.find((c) => c.url.includes(self.location.origin));
      if (maryTab) return maryTab.focus();
      return clients.openWindow(event.notification.data?.url || "/");
    })
  );
});
