// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------
window.db = null
async function initDB() {
  window.db = await createDB("ap_tracker")
  if (!Array.isArray(window.db.connections)) window.db.connections = []
  if (typeof window.db.progFiles !== "object" || window.db.progFiles === null) {
    window.db.progFiles = {}
  }
}

// ---------------------------------------------------------------------
// Runtime state (not persisted): live clients + derived tracking info
// ---------------------------------------------------------------------
const runtime = {} // connId -> { client, status, statusDetail, log:[], receivedNames:Set, prevObtainable:Set }

function progForGame(game) {
  const src = window.db.progFiles[game]
  if (!src) return null
  try {
    return ProgLib.parseProgSource(src)
  } catch (e) {
    console.error("Failed to parse prog file for", game, e)
    return null
  }
}

function notify(title, body) {
  if (Notification.permission !== "granted") return
  try {
    new Notification(title, { body, icon: undefined })
  } catch (e) {
    console.error("notify failed", e)
  }
}

function pushLog(connId, entry) {
  const rt = runtime[connId]
  rt.log.push(entry)
  if (rt.log.length > 200) rt.log.shift()
  renderSlots()
}

function startConnection(conn) {
  const rt = {
    client: null,
    status: "connecting",
    statusDetail: "",
    log: [],
    receivedNames: new Set(),
    prevObtainable: new Set(),
  }
  runtime[conn.id] = rt

  const client = new APSlotClient(
    {
      hostname: conn.hostname,
      port: conn.port,
      game: conn.game,
      playerName: conn.playerName,
      password: conn.password,
    },
    {
      onStatus: (status, detail) => {
        rt.status = status
        rt.statusDetail = detail || ""
        renderSlots()
      },
      onConnected: () => {
        pushLog(conn.id, { text: `Connected as ${conn.playerName} (${conn.game})`, prog: false })
      },
      onCheckedLocations: () => {
        maybeRecomputeProgression(conn, rt)
      },
      onItems: (items) => {
        handleReceivedItems(conn, rt, items)
      },
    },
  )
  rt.client = client
  client.connect()
}

function stopConnection(connId) {
  runtime[connId]?.client?.disconnect()
  delete runtime[connId]
  renderSlots()
}

function handleReceivedItems(conn, rt, items) {
  const prog = progForGame(conn.game)

  items.forEach((item) => rt.receivedNames.add(item.name))

  // Figure out, per item, whether it opened up anything new — only
  // meaningful if a prog file exists for this game.
  let anyNewProgression = false
  let progDeltaTokens = []
  if (prog) {
    const owned = ProgLib.ownedFromSlot(
      prog,
      rt.receivedNames,
      rt.client.slotData,
      rt.client.checkedLocations,
    )
    const nowObtainable = ProgLib.obtainableNow(
      prog,
      owned,
      rt.client.slotData,
      rt.client.checkedLocations,
    )
    for (const key of nowObtainable) {
      if (!rt.prevObtainable.has(key)) progDeltaTokens.push(key)
    }
    anyNewProgression = progDeltaTokens.length > 0
    rt.prevObtainable = nowObtainable
  }

  items.forEach((item) => {
    pushLog(conn.id, { text: item.name, prog: false })
  })

  if (anyNewProgression) {
    pushLog(conn.id, {
      text: `Unlocked ${progDeltaTokens.length} new obtainable location(s)`,
      prog: true,
    })
  }

  const mode = conn.notifyMode || "all"
  const itemNames = items.map((i) => i.name).join(", ")

  if (mode === "all") {
    notify(`[${conn.playerName}] Item received`, itemNames)
  } else if (mode === "progression") {
    if (anyNewProgression) {
      notify(
        `[${conn.playerName}] New progression!`,
        `${itemNames} unlocked ${progDeltaTokens.length} new location(s)`,
      )
    }
  } else if (mode === "both") {
    notify(
      `[${conn.playerName}] Item received${anyNewProgression ? " — unlocks progression!" : ""}`,
      itemNames,
    )
  }
}

function maybeRecomputeProgression(conn, rt) {
  const prog = progForGame(conn.game)
  if (!prog) return
  const owned = ProgLib.ownedFromSlot(
    prog,
    rt.receivedNames,
    rt.client.slotData,
    rt.client.checkedLocations,
  )
  rt.prevObtainable = ProgLib.obtainableNow(
    prog,
    owned,
    rt.client.slotData,
    rt.client.checkedLocations,
  )
}

// ---------------------------------------------------------------------
// UI: connections panel
// ---------------------------------------------------------------------
const slotsRoot = document.getElementById("slots")
const progRoot = document.getElementById("progFiles")

function gamesWithProg() {
  return Object.keys(window.db.progFiles || {})
}

function renderSlots() {
  slotsRoot.innerHTML = ""
  const conns = [...window.db.connections]
  if (conns.length === 0) {
    slotsRoot.appendChild(newelem("div", { class: "empty" }, ["No slots yet — add one above."]))
    return
  }
  conns.forEach((conn) => {
    const rt = runtime[conn.id]
    const status = rt?.status || "disconnected"

    const card = newelem("div", { class: "slot-card" })

    const top = newelem("div", { class: "slot-top" })
    top.appendChild(
      newelem("div", {}, [
        newelem("div", { class: "slot-title" }, [
          newelem("span", { class: `status-dot ${status}` }, []),
          `${conn.playerName} @ ${conn.hostname}${conn.port ? ":" + conn.port : ""}`,
        ]),
        newelem("div", { class: "slot-sub" }, [
          `${conn.game}${rt?.statusDetail ? " — " + rt.statusDetail : ""}`,
        ]),
      ]),
    )

    const controls = newelem("div", { class: "slot-controls" })

    const modeSelect = newelem("select", {}, [])
    const hasProg = gamesWithProg().includes(conn.game)
    const options = [
      { v: "all", t: "Notify: all items" },
    ]
    if (hasProg) {
      options.push({ v: "progression", t: "Notify: progression-unlocking only" })
      options.push({ v: "both", t: "Notify: all (highlight progression)" })
    }
    options.forEach((o) => {
      modeSelect.appendChild(newelem("option", { value: o.v }, [o.t]))
    })
    modeSelect.value = hasProg ? conn.notifyMode || "all" : "all"
    modeSelect.disabled = !hasProg
    modeSelect.title = hasProg ? "" : `Upload a prog file for "${conn.game}" to unlock progression alerts`
    modeSelect.addEventListener("change", async () => {
      const idx = window.db.connections.findIndex((c) => c.id === conn.id)
      if (idx === -1) return
      window.db.connections[idx].notifyMode = modeSelect.value
    })
    controls.appendChild(modeSelect)

    const toggleBtn = newelem("button", {}, [status === "disconnected" || status === "error" ? "Connect" : "Disconnect"])
    toggleBtn.addEventListener("click", () => {
      if (status === "disconnected" || status === "error" || !rt) {
        startConnection(conn)
      } else {
        stopConnection(conn.id)
      }
    })
    controls.appendChild(toggleBtn)

    const removeBtn = newelem("button", { class: "danger" }, ["Remove"])
    removeBtn.addEventListener("click", () => {
      stopConnection(conn.id)
      const idx = window.db.connections.findIndex((c) => c.id === conn.id)
      if (idx !== -1) window.db.connections.splice(idx, 1)
      renderSlots()
    })
    controls.appendChild(removeBtn)

    top.appendChild(controls)
    card.appendChild(top)

    const log = newelem("div", { class: "slot-log" }, [])
    ;(rt?.log || []).forEach((entry) => {
      log.appendChild(
        newelem("div", { class: `row${entry.prog ? " new-prog" : ""}` }, [
          entry.prog ? newelem("span", { class: "badge" }, ["PROG"]) : null,
          entry.text,
        ]),
      )
    })
    card.appendChild(log)

    slotsRoot.appendChild(card)
  })
}

function renderProgFiles() {
  progRoot.innerHTML = ""
  const games = gamesWithProg()
  if (games.length === 0) {
    progRoot.appendChild(newelem("div", { class: "empty" }, ["No progression files uploaded yet."]))
  }
  games.forEach((game) => {
    const row = newelem("div", { class: "prog-row" })
    row.appendChild(
      newelem("div", {}, [
        game,
        newelem("div", { class: "file-name" }, [
          `${(window.db.progFiles[game] || "").length} chars loaded`,
        ]),
      ]),
    )
    const removeBtn = newelem("button", { class: "danger" }, ["Remove"])
    removeBtn.addEventListener("click", () => {
      delete window.db.progFiles[game]
      // proxy delete needs a reassignment to trigger persistence cleanly
      const copy = { ...window.db.progFiles }
      delete copy[game]
      window.db.progFiles = copy
      renderProgFiles()
      renderSlots()
    })
    row.appendChild(removeBtn)
    progRoot.appendChild(row)
  })
}

// ---------------------------------------------------------------------
// Add-connection form
// ---------------------------------------------------------------------
document.getElementById("addSlotForm").addEventListener("submit", (e) => {
  e.preventDefault()
  const f = e.target
  const conn = {
    id: Math.random().toString(36).slice(2, 10),
    hostname: f.hostname.value.trim(),
    port: f.port.value.trim(),
    game: f.game.value.trim(),
    playerName: f.playerName.value.trim(),
    password: f.password.value,
    notifyMode: "all",
  }
  if (!conn.hostname || !conn.game || !conn.playerName) return
  window.db.connections.push(conn)
  f.reset()
  renderSlots()
  startConnection(conn)
})

// ---------------------------------------------------------------------
// Prog file upload form
// ---------------------------------------------------------------------
document.getElementById("addProgForm").addEventListener("submit", async (e) => {
  e.preventDefault()
  const f = e.target
  const game = f.progGame.value.trim()
  const fileInput = f.progFile
  if (!game || !fileInput.files[0]) return
  const text = await fileInput.files[0].text()
  const copy = { ...window.db.progFiles, [game]: text }
  window.db.progFiles = copy
  f.reset()
  renderProgFiles()
  renderSlots()
})

// ---------------------------------------------------------------------
// Notifications permission
// ---------------------------------------------------------------------
const notifBtn = document.getElementById("notifBtn")
function refreshNotifBtn() {
  if (Notification.permission === "granted") {
    notifBtn.textContent = "Notifications on"
    notifBtn.classList.add("granted")
  } else {
    notifBtn.textContent = "Enable notifications"
    notifBtn.classList.remove("granted")
  }
}
notifBtn.addEventListener("click", async () => {
  if (Notification.permission !== "granted") {
    await Notification.requestPermission()
  }
  refreshNotifBtn()
})

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------
;(async () => {
  await initDB()
  refreshNotifBtn()
  renderProgFiles()
  renderSlots()
  // Auto-reconnect any saved slots
  window.db.connections.forEach((conn) => startConnection(conn))
})()
