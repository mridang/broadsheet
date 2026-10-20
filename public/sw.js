/*
 * The app's service worker, the same in every app. It exists so the app can be
 * installed, so a page opened offline says so instead of showing the browser's
 * dinosaur, and so a pushed notification can be shown. It deliberately caches
 * nothing else: pages are personal and change often, so every page comes from
 * the network.
 *
 * What differs from app to app (its name and colours) arrives in the query
 * string of the address it is registered at: `/sw.js?name=...&theme=...&background=...`
 * (see `components/site/service-worker.tsx`). A worker cannot import the app's
 * own modules, and this keeps one file for every app.
 */

const PARAMS = new URL(self.location.href).searchParams;
const ORIGIN = self.location.origin;

/** A colour from the query string, only if it is a plain `#rrggbb` value. */
function colour(name, fallback) {
  const value = PARAMS.get(name);
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/** Text made safe to place inside HTML. */
function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}

/** Whether black or white text is the more readable on a `#rrggbb` background. */
function inkFor(background) {
  const channel = (at) => parseInt(background.slice(at, at + 2), 16);
  const luminance = 0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5);
  return luminance > 140 ? '#15120e' : '#f3f3f6';
}

const NAME = escapeHtml(PARAMS.get('name') || 'This app');
const THEME = colour('theme', '#000000');
const BACKGROUND = colour('background', '#ffffff');
const INK = inkFor(BACKGROUND);

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${THEME}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<title>Offline · ${NAME}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${BACKGROUND}; color: ${INK}; font: 16px/1.5 system-ui, sans-serif; text-align: center; padding: 24px; }
  h1 { font-size: 1.75rem; margin: 0 0 8px; }
  p { margin: 0 0 20px; opacity: 0.75; }
  button { background: ${INK}; color: ${BACKGROUND}; border: 0; border-radius: 8px; padding: 12px 20px; font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>You're offline</h1>
  <p>${NAME} needs a connection to open. Check it and try again.</p>
  <button type="button" onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Navigation preload starts the network request while the worker boots, so
  // having a worker adds no start-up delay to a page load (the consent page
  // included). Not every browser has it.
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable()
        : undefined,
    ]),
  );
});

/** The page from the network: the preloaded response if there is one, else a fresh fetch. */
async function fromNetwork(event) {
  const preloaded = await event.preloadResponse;
  return preloaded ?? fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') {
    return;
  }
  event.respondWith(
    fromNetwork(event).catch(
      () =>
        new Response(OFFLINE_PAGE, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    ),
  );
});

/*
 * Web Push. A `push` event carries a JSON payload: `title`, `body`, `image`,
 * `tag` and `url`. An app that sends no pushes never receives the event.
 * A payload that cannot be read still shows a notification, so a push is never
 * silently dropped. Only what the payload has is set: a missing icon or badge
 * can make some browsers drop the notification.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.warn('[sw] push payload is not JSON:', error);
  }
  const options = {
    body: payload.body || 'There is something new.',
    tag: payload.tag,
    data: { url: payload.url || ORIGIN },
    renotify: Boolean(payload.tag),
    requireInteraction: true,
  };
  if (payload.image) {
    options.image = payload.image;
  }
  event.waitUntil(
    self.registration
      .showNotification(payload.title || PARAMS.get('name') || 'Notification', options)
      .catch((error) => console.error('[sw] showNotification failed:', error)),
  );
});

/*
 * Tapping a notification opens the app, focusing a tab that is already open.
 * The address in the payload is only followed when it is on this site, so a
 * tampered payload cannot send anyone elsewhere.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? ORIGIN;
  const url = target.startsWith(ORIGIN) ? target : ORIGIN;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((win) => win.url.startsWith(ORIGIN));
        if (open) {
          return open.focus().then(() => open.navigate(url));
        }
        return self.clients.openWindow(url);
      }),
  );
});
