// Service Worker — שומר במטמון רק את ״מעטפת״ האפליקציה (קוד, עיצוב, גופנים, אייקונים).
// תכנים משפחתיים וקריאות API לעולם לא נשמרים במטמון של ה-Service Worker, מטעמי פרטיות.
const CACHE = 'saba-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg?v=2', '/icons/icon-192.png?v=2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // ניווט: קודם רשת (כדי לקבל גרסה עדכנית), ובלי חיבור — המעטפת השמורה
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // קבצי build עם hash בשם — אינם משתנים, ולכן מהמטמון תחילה
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
