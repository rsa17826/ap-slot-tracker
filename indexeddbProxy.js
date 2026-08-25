// ==UserScript==
// @name         lib:indexeddbProxy
// @version      16
// @description  none
// @license      GPLv3
// @run-at       document-start
// @author       rssaromeo
// @match        *://*/*
// @include      *
// @tag          lib
// @grant        none
// ==/UserScript==
;(async () => {
  /* =========================================================
     INDEXEDDB HELPERS
  ========================================================== */

  const idb = (() => {
    function openDB({ dbName, storeName, keyPath = "id" }) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1)

        request.onupgradeneeded = (e) => {
          const db = e.target.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath })
          }
        }

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    async function setup({
      storeName,
      keyPath = "id",
      storePrefix = "",
    }) {
      const dbName =
        storePrefix ? `${storePrefix}_${storeName}` : storeName

      const db = await openDB({ dbName, storeName, keyPath })
      return { db, storeName }
    }

    function getStore(dbObj, mode = "readonly") {
      const tx = dbObj.db.transaction(dbObj.storeName, mode)
      return tx.objectStore(dbObj.storeName)
    }

    function getAll(dbObj) {
      return new Promise((resolve, reject) => {
        const request = getStore(dbObj).getAll()
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
      })
    }

    function clearAll(dbObj) {
      return new Promise((resolve, reject) => {
        const request = getStore(dbObj, "readwrite").clear()
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
      })
    }

    return { setup, getAll, clearAll }
  })()

  /* =========================================================
     MAIN LIB
  ========================================================== */
  window.createDB = createDB
  async function createDB(name, options = {}) {
    const dbObj = await idb.setup({
      storeName: name,
      keyPath: "id",
      storePrefix: "",
      ...options,
    })
    const proxyCache = new WeakMap()
    const proxyToTarget = new WeakMap()

    /* =========================
       CROSS-TAB SYNC
    ========================== */
    // One channel per db+store so different createDB() calls don't cross-talk.
    const channelName = `idbproxy:${dbObj.db.name}:${dbObj.storeName}`
    const bc =
      "BroadcastChannel" in window ?
        new BroadcastChannel(channelName)
      : null

    // Stable per-tab identity so ids generated in different tabs never collide.
    const tabId = Math.random().toString(36).slice(2, 10)
    let idCounter = 0
    function genId() {
      return `${tabId}:${idCounter++}`
    }

    // rootKey -> array of stable element ids, parallel to localData[rootKey]
    // when that value is an array. This is what lets push (insert) in one tab
    // and splice (remove) in another merge correctly instead of one clobbering
    // the other: ops reference elements by id, not by index, so they commute.
    const arrayIds = {}

    bc?.addEventListener("message", (e) => {
      const msg = e.data
      if (!msg) return

      switch (msg.type) {
        case "write":
          // Another tab committed this key to IDB — adopt it locally.
          // This also drops any proxy cached for the old object identity
          // so future property access rebuilds against fresh data.
          localData[msg.key] = msg.val
          if (Array.isArray(msg.val)) {
            arrayIds[msg.key] = msg.val.map((_, i) => `init:${i}`)
          } else {
            delete arrayIds[msg.key]
          }
          break

        case "delete":
          delete localData[msg.key]
          delete arrayIds[msg.key]
          break

        case "clear":
          for (const key of Object.keys(localData)) {
            delete localData[key]
          }
          for (const key of Object.keys(arrayIds)) {
            delete arrayIds[key]
          }
          break

        case "arrayOp":
          applyRemoteArrayOp(msg.key, msg.op)
          break
      }
    })

    function broadcastWrite(key, val) {
      bc?.postMessage(
        val === undefined ?
          { type: "delete", key }
        : { type: "write", key, val },
      )
    }

    // Apply an insert/remove op that originated in another tab onto our own
    // in-memory array + id shadow, then re-persist so this tab's IDB copy
    // (and any tab that opens fresh later) reflects the merged result too.
    // Both op kinds are idempotent/no-ops when the referenced id is unknown,
    // so out-of-order or duplicate delivery can't corrupt state.
    function applyRemoteArrayOp(key, op) {
      if (!Array.isArray(localData[key])) return

      const ids = arrayIds[key] || (arrayIds[key] = [])
      const arr = localData[key]

      if (op.kind === "insert") {
        if (ids.includes(op.id)) return

        let pos = arr.length
        if (op.afterId) {
          const idx = ids.indexOf(op.afterId)
          pos = idx === -1 ? arr.length : idx + 1
        } else if (op.atStart) {
          pos = 0
        }

        ids.splice(pos, 0, op.id)
        arr.splice(pos, 0, op.value)
      } else if (op.kind === "remove") {
        const idx = ids.indexOf(op.id)
        if (idx === -1) return // already gone locally — nothing to do

        ids.splice(idx, 1)
        arr.splice(idx, 1)
      }

      queueWrite(key, clone(arr))
    }

    /* =========================
       LOAD INITIAL DATA
    ========================== */

    const records = await idb.getAll(dbObj)
    let localData = {}

    for (const { id, val } of records) {
      localData[id] = val
      if (Array.isArray(val)) {
        // Deterministic ids for pre-existing elements: any tab loading the
        // same persisted state at this point assigns the same ids, so ops
        // referencing them stay consistent across tabs.
        arrayIds[id] = val.map((_, i) => `init:${i}`)
      }
      // shouldProxy(val) ? createDeepProxy(id, val) : val
    }

    /* =========================
       BATCH WRITE ENGINE
    ========================== */

    const writeQueue = new Map()
    let flushScheduled = false
    let flushing = false
    let pendingResolves = []

    function scheduleFlush() {
      if (flushScheduled) return
      flushScheduled = true

      queueMicrotask(async () => {
        flushScheduled = false
        await flush()
      })
    }
    function unwrap(value) {
      if (value === null || typeof value !== "object") return value

      // If this is one of our proxies, get the real underlying target
      const raw = proxyToTarget.get(value) ?? value

      if (Array.isArray(raw)) return raw.map(unwrap)

      if (isPlainObject(raw)) {
        const out = {}
        for (const k of Object.keys(raw)) out[k] = unwrap(raw[k])
        return out
      }

      // Non-plain objects (Date, etc.) pass through as-is
      return raw
    }

    function clone(val) {
      return unwrap(val)
    }
    function isPlainObject(value) {
      if (value === null || typeof value !== "object") return false

      const proto = Object.getPrototypeOf(value)

      return proto === Object.prototype || proto === null
    }

    function shouldProxy(value) {
      return Array.isArray(value) || isPlainObject(value)
    }

    // Builds id-aware replacements for the array mutator methods on a
    // top-level array value. Instead of persisting/broadcasting the whole
    // array (which is what a plain proxy `set` trap would do for every
    // element touched during a native splice), each call emits a small
    // insert/remove op keyed by stable element id and broadcasts *that*.
    // Because ops target ids rather than indices, a push in one tab and a
    // splice-remove in another commute correctly instead of one silently
    // overwriting the other.
    function makeArrayOps(rootKey) {
      const arr = localData[rootKey]
      const ids =
        arrayIds[rootKey] ||
        (arrayIds[rootKey] = arr.map((_, i) => `init:${i}`))

      function persist() {
        queueWrite(rootKey, clone(arr))
      }
      function broadcastOp(op) {
        bc?.postMessage({ type: "arrayOp", key: rootKey, op })
      }

      return {
        push(...items) {
          for (const item of items) {
            const id = genId()
            const value = unwrap(item)
            ids.push(id)
            arr.push(value)
            broadcastOp({
              kind: "insert",
              id,
              value,
              afterId: ids[ids.length - 2] ?? null,
            })
          }
          persist()
          return arr.length
        },

        unshift(...items) {
          for (let i = items.length - 1; i >= 0; i--) {
            const id = genId()
            const value = unwrap(items[i])
            ids.unshift(id)
            arr.unshift(value)
            broadcastOp({ kind: "insert", id, value, atStart: true })
          }
          persist()
          return arr.length
        },

        pop() {
          if (!arr.length) return undefined
          const id = ids.pop()
          const value = arr.pop()
          broadcastOp({ kind: "remove", id })
          persist()
          return value
        },

        shift() {
          if (!arr.length) return undefined
          const id = ids.shift()
          const value = arr.shift()
          broadcastOp({ kind: "remove", id })
          persist()
          return value
        },

        splice(start, deleteCount, ...items) {
          const len = arr.length
          const from =
            start < 0 ?
              Math.max(len + start, 0)
            : Math.min(start, len)
          const count =
            deleteCount === undefined ?
              len - from
            : Math.max(0, Math.min(deleteCount, len - from))

          const removedIds = ids.splice(from, count)
          const removed = arr.splice(
            from,
            count,
            ...items.map(unwrap),
          )

          for (const id of removedIds) {
            broadcastOp({ kind: "remove", id })
          }

          const newIds = items.map(() => genId())
          ids.splice(from, 0, ...newIds)

          let prevId = ids[from - 1] ?? null
          items.forEach((item, i) => {
            const value = unwrap(item)
            broadcastOp({
              kind: "insert",
              id: newIds[i],
              value,
              afterId: prevId,
            })
            prevId = newIds[i]
          })

          persist()
          return removed
        },
      }
    }

    const ARRAY_OP_METHODS = [
      "push",
      "pop",
      "shift",
      "unshift",
      "splice",
    ]

    function createDeepProxy(rootKey, target) {
      if (target === null || typeof target !== "object") return target

      if (proxyCache.has(target)) return proxyCache.get(target)

      if (shouldProxy(target)) {
        const proxy = new Proxy(target, {
          get(obj, prop) {
            if (
              obj === localData[rootKey] &&
              Array.isArray(obj) &&
              typeof prop === "string" &&
              ARRAY_OP_METHODS.includes(prop)
            ) {
              return makeArrayOps(rootKey)[prop]
            }

            const value = obj[prop]

            return createDeepProxy(rootKey, value)
          },

          set(obj, prop, value) {
            obj[prop] = unwrap(value)

            // Persist entire root object
            queueWrite(rootKey, clone(localData[rootKey]))
            return true
          },

          deleteProperty(obj, prop) {
            delete obj[prop]

            queueWrite(rootKey, clone(localData[rootKey]))

            return true
          },
        })

        proxyCache.set(target, proxy)
        proxyToTarget.set(proxy, target)
        return proxy
      }
      return target
    }
    function queueWrite(key, value) {
      writeQueue.set(key, { id: key, val: value })
      scheduleFlush()
    }

    async function flush() {
      if (flushing) return // an in-progress flush's finally{} will reschedule and resolve

      if (!writeQueue.size) {
        resolvePending()
        return
      }

      flushing = true

      const items = [...writeQueue.values()]
      writeQueue.clear()

      try {
        await new Promise((resolve, reject) => {
          const tx = dbObj.db.transaction(
            dbObj.storeName,
            "readwrite",
          )
          const store = tx.objectStore(dbObj.storeName)

          for (const item of items) {
            if (item.val === undefined) {
              store.delete(item.id)
            } else {
              store.put(item)
            }
          }

          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
        })

        // Only broadcast after the transaction actually committed.
        for (const item of items) {
          broadcastWrite(item.id, item.val)
        }
      } finally {
        flushing = false
        resolvePending()

        // If new writes came during flush, schedule again
        if (writeQueue.size) scheduleFlush()
      }
    }

    function resolvePending() {
      pendingResolves.forEach((r) => r())
      pendingResolves = []
    }

    function doneSaving() {
      return new Promise((resolve) => {
        if (!writeQueue.size && !flushing && !flushScheduled) {
          resolve()
        } else {
          pendingResolves.push(resolve)
        }
      })
    }

    /* =========================
       CORE OPERATIONS
    ========================== */

    function setProp(key, value) {
      localData[key] = unwrap(value)
      // shouldProxy(value) ? createDeepProxy(key, value) : value

      // A direct assignment is a hard reset, not a merge-tracked op — fresh
      // ids so any in-flight ops from other tabs referencing the old
      // elements just become no-ops instead of corrupting new data.
      if (Array.isArray(localData[key])) {
        arrayIds[key] = localData[key].map(() => genId())
      } else {
        delete arrayIds[key]
      }

      queueWrite(key, clone(localData[key]))
    }

    function deleteProp(key) {
      if (!(key in localData)) return true

      delete localData[key]
      delete arrayIds[key]
      queueWrite(key, undefined)
      return true
    }

    /* =========================
       PROXY
    ========================== */

    const handler = {
      set(target, prop, value) {
        const raw = unwrap(value)
        target[prop] = raw
        setProp(prop, raw)
        return true
      },

      deleteProperty(target, prop) {
        return deleteProp(prop)
      },

      get(target, prop) {
        switch (prop) {
          case "doneSaving":
            return doneSaving()
          case "all":
            return localData

          case "clear":
            return async () => {
              await idb.clearAll(dbObj)

              // ✅ Properly clear existing proxy target
              for (const key of Object.keys(localData)) {
                delete localData[key]
              }
              for (const key of Object.keys(arrayIds)) {
                delete arrayIds[key]
              }
              bc?.postMessage({ type: "clear" })
              return localData
            }
          case "saveall":
            return async () => {
              for (const [k, v] of Object.entries(localData)) {
                queueWrite(k, v)
              }
              await flush()
            }

          case Symbol.iterator:
            return function* () {
              for (const [id, val] of Object.entries(localData)) {
                yield { id, val }
              }
            }

          default:
            return createDeepProxy(prop, Reflect.get(target, prop))
        }
      },
    }

    return new Proxy(localData, handler)
  }
})()
