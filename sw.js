// prettier-ignore
const ASSETS = ["/","/ctApi.js","/a.js","/apMulti.js","/app.js","/colors.css","/.foldericon.png","/favicon.ico","/indexeddbProxy.js","/manifest.json","/map.css","/newelem.js","/style.css",]
// Install Service Worker and cache core assets
self.addEventListener("install", (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open("cache").then((cache) => {
      return Promise.all(
        ASSETS.map((url) => {
          return cache.add(url.split("?")[0]).catch((err) => {
            console.error("❌ Failed to cache asset:", url, err)
          })
        }),
      )
    }),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim())
})

let cache = null
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(event.request)
        // 🛑 Treat Nginx error status codes as failures
        if (
          networkResponse.status === 502 ||
          networkResponse.status === 504
        ) {
          throw new Error(`Gateway error: ${networkResponse.status}`)
        }
        if (
          /^https?:\/\/([^\/]+\.)?(127.0.0.1|localhost)/.test(
            event.request.url,
          )
        ) {
          cache ??= await caches.open("cache")
          const cloned = networkResponse.clone()
          event.waitUntil(
            cache.put(event.request.url.split("?")[0], cloned),
          )
        }
        return networkResponse
      } catch (err) {
        let res = getCached(event.request.url)
        if (res) return res
        console.error(
          `failed to get cached file!!!`,
          event.request.url,
          err,
        )
        throw err
      }
    })(),
  )
})

async function getCached(url) {
  cache ??= await caches.open("cache")
  const cachedResponse = await cache.match(url.split("?")[0])
  return cachedResponse
}

// navigator.serviceWorker.register("/sw.js")
