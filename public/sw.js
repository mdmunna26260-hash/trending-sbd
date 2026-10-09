/* TRENDING'S Commerce — Web Push service worker.
   Registered globally by components/push-register.tsx. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { try { data = { title: "Update", body: e.data ? e.data.text() : "" }; } catch {} }
  const title = data.title || "TRENDING'S";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-badge-96.png",
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    (async () => {
      const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of cs) {
        try { if (new URL(c.url).origin === self.location.origin) { await c.focus(); if (c.navigate) await c.navigate(url); return; } } catch {}
      }
      return self.clients.openWindow(url);
    })()
  );
});
