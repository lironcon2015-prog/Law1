const CACHE_VERSION = 'app-v1.21.14'
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core.js',
  './templates.js',
  './wizard.js',
  './budget.js',
  './budgetGen.js',
  './recurring.js',
  './dashboard.js',
  './transactions.js',
  './import.js',
  './analysis.js',
  './settings.js',
  './drive.js',
  './autocat.js',
  './property.js',
  './scrollMirror.js',
  './manifest.json',
]

self.addEventListener('install', e => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS)))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // חסימה מוחלטת: אסור ל-Service Worker לגעת בקריאות API (דרייב או AI)
  if (e.request.url.includes('googleapis.com')) return

  // network-first for HTML and version.json
  const url = new URL(e.request.url)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('version.json') || url.pathname.endsWith('/')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)))
    return
  }

  // strip query params for cache matching (cache-busting ?v=)
  const cleanUrl = url.origin + url.pathname
  e.respondWith(
    caches.match(cleanUrl).then(r => r || caches.match(e.request)).then(r => r || fetch(e.request))
  )
})

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
