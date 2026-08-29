// @regex \bappendChild\b
// @info appendChild
// @endregex

// ---------------------------------------------------------------------
// Runtime state (not persisted): live clients + derived tracking info
// ---------------------------------------------------------------------
const runtime = {} // connId -> { client, status, statusDetail, log:[], receivedNames:Set, prevObtainable:Set }

// "progFiles" now holds the same rules-JSON graph the map (index.html)
// loads — regions/entrances/locations with rule trees — rather than the
// old prog.js PROG-array format. The map writes into this store itself
// whenever a rules JSON is loaded, so nothing else needs to upload it.
//
// Multiple rules files for the *same* game are allowed as long as their
// `.version` differs (e.g. re-rolling a game's logic between releases),
// so progFiles/fileHandles/layout are all keyed by a composite
// "game@vVERSION" key rather than by game name alone.
function progKeyFor(raw) {
  const game = raw?.game || "unknown"
  const version = raw?.version ?? "unversioned"
  return `${game}@v${version}`
}

function progForGame(progKey) {
  const src = window.db.progFiles[progKey]
  if (!src) return null
  try {
    return typeof src === "string" ? JSON.parse(src) : src
  } catch (e) {
    console.error("Failed to parse map graph for", progKey, e)
    return null
  }
}

// Maps this slot's checked AP location ids to the "Room - Token" names the
// map graph uses, via the data package the client already downloaded.
function checkedLocationNames(conn, rt) {
  const idToName = rt.client.locationIdToName?.[conn.game] || {}
  const out = {}
  for (const id of rt.client.checkedLocations || []) {
    const name = idToName[id]
    if (name) out[name] = true
  }
  return out
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
    receivedCounts: {}, // itemName -> count, for Has(count) rules in the map graph
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
        pushLog(conn.id, {
          text: `Connected as ${conn.playerName} (${conn.game})`,
          prog: false,
        })
      },
      onCheckedLocations: () => {
        maybeRecomputeProgression(conn, rt)
        notifyMapOfSlotUpdate(conn)
      },
      onItems: (items) => {
        handleReceivedItems(conn, rt, items)
        notifyMapOfSlotUpdate(conn)
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

// Progression notifications only care about real, checkable locations --
// event locations (flag/beat-stage tokens etc.) aren't in the item pool
// and can't be "checked" by the player, so they shouldn't count toward
// "new obtainable location(s)".
function isRealLocation(graph, name) {
  const linfo = graph.locations[name]
  return !!linfo && !linfo.is_event
}

function handleReceivedItems(conn, rt, items) {
  const graph = progForGame(conn.progKey)

  items.forEach((item) => {
    rt.receivedNames.add(item.name)
    rt.receivedCounts[item.name] =
      (rt.receivedCounts[item.name] || 0) + 1
  })

  // Figure out, per item, whether it opened up anything new — only
  // meaningful if a map graph has been loaded for this game.
  let anyNewProgression = false
  let progDeltaTokens = []
  if (graph) {
    const checkedNames = checkedLocationNames(conn, rt)
    const { locations } = MapEngine.computeReachablePure(
      graph,
      rt.receivedCounts,
      checkedNames,
    )
    const nowObtainable = new Set(
      [...locations].filter(
        (l) => !checkedNames[l] && isRealLocation(graph, l),
      ),
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

  if (mode === "none") {
    // Notifications disabled for this slot -- log entries above still
    // record what happened, we just skip the OS notification.
  } else if (mode === "all") {
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
  const graph = progForGame(conn.progKey)
  if (!graph) return
  const checkedNames = checkedLocationNames(conn, rt)
  const { locations } = MapEngine.computeReachablePure(
    graph,
    rt.receivedCounts,
    checkedNames,
  )
  rt.prevObtainable = new Set(
    [...locations].filter(
      (l) => !checkedNames[l] && isRealLocation(graph, l),
    ),
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

// Version comes from the rules JSON's own `.version` field, so each
// loaded ruleset's dropdown entry can show which revision it is.
function progVersion(progKey) {
  return window.db.progFiles[progKey]?.version ?? null
}

// The actual AP protocol game name for a loaded ruleset (used to connect
// and to look up the data package), as opposed to the composite progKey
// used to store/select that specific version of it.
function progGameName(progKey) {
  return window.db.progFiles[progKey]?.game ?? progKey
}

// Keeps the "Add a slot" game <select> in sync with whatever rules JSON
// files have been loaded, showing each entry's name + version. Distinct
// versions of the same game each get their own option.
function populateGameSelect() {
  const select = document.getElementById("gameSelect")
  if (!select) return
  const progKeys = gamesWithProg()
  const prevValue = select.value

  select.replaceChildren(
    newelem(
      "option",
      { value: "", disabled: true, selected: !prevValue },
      [
        progKeys.length === 0 ?
          "Load a rules JSON below to select a game"
        : "Select a game",
      ],
    ),
    ...progKeys.map((progKey) => {
      const version = progVersion(progKey)
      const name = progGameName(progKey)
      return newelem("option", { value: progKey }, [
        version ? `${name} (v${version})` : name,
      ])
    }),
  )

  if (progKeys.includes(prevValue)) select.value = prevValue
}

function renderSlots() {
  const conns = [...window.db.connections]
  if (conns.length === 0) {
    slotsRoot?.replaceChildren(
      newelem("div", { class: "empty" }, [
        "No slots yet — add one above.",
      ]),
    )
    return
  }
  slotsRoot?.replaceChildren(
    ...conns.map((conn) => {
      const rt = runtime[conn.id]
      const status = rt?.status || "disconnected"

      const hasProg = gamesWithProg().includes(conn.progKey)
      return newelem("div", { class: "slot-card" }, [
        newelem(
          "div",
          { class: "slot-log" },
          (rt?.log || []).map((entry) =>
            newelem(
              "div",
              { class: `row${entry.prog ? " new-prog" : ""}` },
              [
                entry.prog ?
                  newelem("span", { class: "badge" }, ["PROG"])
                : null,
                entry.text,
              ],
            ),
          ),
        ),
        newelem("div", { class: "slot-top" }, [
          newelem("div", {}, [
            newelem("div", { class: "slot-title" }, [
              newelem("span", { class: `status-dot ${status}` }, []),
              `${conn.playerName} @ ${conn.hostname}${conn.port ? ":" + conn.port : ""}`,
            ]),
            newelem("div", { class: "slot-sub" }, [
              `${conn.game}${conn.progKey && hasProg ? " — v" + (progVersion(conn.progKey) ?? "?") : ""}${rt?.statusDetail ? " — " + rt.statusDetail : ""}`,
            ]),
          ]),
          newelem("div", { class: "slot-controls" }, [
            (() => {
              const modeSelect = newelem("select", {
                title:
                  hasProg ? "" : (
                    `Upload/load a rules JSON for "${conn.game}" to unlock progression-aware alerts`
                  ),
                options: {
                  "Notify: none": "none",
                  "Notify: progression-unlocking only": "progression",
                  "Notify: all (highlight progression)": "both",
                  "Notify: all items": "all",
                },
                value: conn.notifyMode || "all",
              })
              modeSelect.onchange = () => {
                const idx = window.db.connections.findIndex(
                  (c) => c.id === conn.id,
                )
                if (idx === -1) return
                window.db.connections[idx].notifyMode =
                  modeSelect.value
              }
              return modeSelect
            })(),
            newelem(
              "button",
              {
                onclick() {
                  if (
                    status === "disconnected" ||
                    status === "error" ||
                    !rt
                  ) {
                    startConnection(conn)
                  } else {
                    stopConnection(conn.id)
                  }
                },
              },
              [
                status === "disconnected" || status === "error" ?
                  "Connect"
                : "Disconnect",
              ],
            ),
            newelem(
              "button",
              {
                class: "danger",
                onclick() {
                  stopConnection(conn.id)
                  const idx = window.db.connections.findIndex(
                    (c) => c.id === conn.id,
                  )
                  if (idx !== -1) window.db.connections.splice(idx, 1)
                  renderSlots()
                },
              },
              ["Remove"],
            ),
            newelem(
              "button",
              {
                onclick: async (e) => {
                  // Defined in index.html's map script: loads this game's
                  // rules JSON (if already known) and syncs the map's
                  // inventory/checked-locations from this slot's live AP
                  // state.
                  await openMapForSlot(conn)
                },
              },
              ["Show Map"],
            ),
          ]),
        ]),
      ])
    }),
  )
}

function renderProgFiles() {
  const progKeys = gamesWithProg()
  progRoot.replaceChildren(
    ...(progKeys.length === 0 ?
      [
        newelem("div", { class: "empty" }, [
          'No map data yet — open a slot\'s "Show Map" and load its rules JSON there.',
        ]),
      ]
    : progKeys.map((progKey) => {
        const g = window.db.progFiles[progKey]
        const regionCount =
          g?.regions ? Object.keys(g.regions).length : 0
        const locCount =
          g?.locations ? Object.keys(g.locations).length : 0
        const version = progVersion(progKey)
        const name = progGameName(progKey)
        return newelem("div", { class: "prog-row" }, [
          newelem("div", {}, [
            version ? `${name} — v${version}` : name,
            newelem("div", { class: "file-name" }, [
              `${regionCount} regions · ${locCount} locations`,
            ]),
          ]),
          newelem("div", {}, [
            newelem(
              "button",
              {
                marginRight: "8px",
                onclick() {
                  updateSavedText(progKey)
                },
              },
              ["Update"],
            ),
            newelem(
              "button",
              {
                class: "danger",
                onclick() {
                  delete window.db.progFiles[progKey]
                  renderProgFiles()
                  renderSlots()
                },
              },
              ["Remove"],
            ),
          ]),
        ])
      })),
  )
  populateGameSelect()
}

// ---------------------------------------------------------------------
// Add-connection form
// ---------------------------------------------------------------------
document
  .getElementById("addSlotForm")
  .addEventListener("submit", (e) => {
    e.preventDefault()
    const f = e.target
    const progKey = f.game.value.trim()
    const conn = {
      id: Math.random().toString(36).slice(2, 10),
      hostname: f.hostname.value.trim(),
      port: f.port.value.trim(),
      game: progGameName(progKey), // actual AP protocol game name
      progKey, // which loaded ruleset/version this slot uses for the map
      playerName: f.playerName.value.trim(),
      password: f.password.value,
      notifyMode: "all",
    }
    if (!conn.hostname || !progKey || !conn.game || !conn.playerName)
      return
    window.db.connections.push(conn)
    f.reset()
    renderSlots()
    startConnection(conn)
  })

// ---------------------------------------------------------------------
// Prog file upload form
// ---------------------------------------------------------------------
// document.getElementById("addProgForm").addEventListener("submit", async (e) => {
//   e.preventDefault()
//   const f = e.target
//   const game = f.progGame.value.trim()
//   const fileInput = f.progFile
//   if (!game || !fileInput.files[0]) return
//   const text = await fileInput.files[0].text()
//   const copy = { ...window.db.progFiles, [game]: text }
//   window.db.progFiles = copy
//   f.reset()
//   renderProgFiles()
//   renderSlots()
// })

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
