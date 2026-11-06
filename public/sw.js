// The site that used to live at chaseteichmann.com installed a service worker at /sw.js, and it can
// keep serving that old site's leftovers (a blank page) to anyone who visited it. Browsers check this
// file for updates; this version clears the old caches, removes itself, and reloads open tabs so they
// get the current site. The current site does not register a service worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: 'window' });
      tabs.forEach((tab) => tab.navigate(tab.url));
    })(),
  );
});
