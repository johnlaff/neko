// Neko service worker: the app shell works offline and the last projection stays readable.
// Hashed assets are immutable (cache first); pages and the projection go to the network first
// and fall back to the last good copy. Nothing here ever writes anywhere but this device.
// Filled in by vite.config.ts at build time: a hash of this build and its hashed files.
const BUILD = "dev";
const ASSETS = [];
const SHELL = `neko-shell-${BUILD}`;
const DATA = "neko-data-v1";
const OFFLINE_API = ["/api/me", "/api/projection", "/api/history", "/api/settings"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(["/", "/manifest.webmanifest", "/favicon.png", ...ASSETS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

const networkFirst = async (request, cacheName, fallbackUrl) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(fallbackUrl ?? request, response.clone());
    // Signed out on the server (from another device, or the session ended): the finance data
    // kept for offline use goes too, so it cannot be read on this device afterwards.
    else if (response.status === 401 && cacheName === DATA) await caches.delete(DATA);
    return response;
  } catch {
    const hit = await cache.match(fallbackUrl ?? request);
    if (!hit) throw new Error("offline and not cached");
    const headers = new Headers(hit.headers);
    headers.set("x-neko-offline", "1");
    return new Response(hit.body, { status: hit.status, headers });
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            if (res.ok) caches.open(SHELL).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }
  if (OFFLINE_API.includes(url.pathname)) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }
  if (request.mode === "navigate") event.respondWith(networkFirst(request, SHELL, "/"));
});

// Logging out wipes the cached sheet data from this device.
self.addEventListener("message", (event) => {
  if (event.data === "logout") event.waitUntil(caches.delete(DATA));
});

// Daily reminders sent by the Worker cron (08:00 "hoje cabem", 21:00 "lançou os gastos?").
self.addEventListener("push", (event) => {
  const msg = event.data?.json() ?? { title: "Neko", body: "", url: "/", tag: "neko" };
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: msg.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const own =
        url.startsWith("/") && windows.find((w) => new URL(w.url).origin === self.location.origin);
      return own ? own.focus().then((w) => w.navigate(url)) : self.clients.openWindow(url);
    }),
  );
});
