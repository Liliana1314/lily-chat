self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "notify") {
    e.waitUntil(
      self.registration.showNotification(d.title || "莉莉·Amour", {
        body: d.body || "发来一条消息",
        tag: d.tag || "lily-msg",
        renotify: d.renotify !== false,
        requireInteraction: !!d.requireInteraction,
        silent: !!d.silent,
        vibrate: d.silent ? [] : [80, 40, 80],
        data: { open: d.open || "chat" }
      })
    );
  }
  if (d.type === "clear") {
    e.waitUntil(
      self.registration.getNotifications({ tag: d.tag || "lily-bg" }).then((list) => {
        list.forEach((n) => n.close());
      })
    );
  }
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || "chat";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c && c.url) {
          c.postMessage({ type: "open", open: open });
          return c.focus();
        }
      }
      return self.clients.openWindow("./");
    })
  );
});
