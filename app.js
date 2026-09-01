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
  const game = raw?.game
  const version = raw?.version
  if (!game || !version) return null
  return `${game}@v${version}`
}

// Rules JSON can now bundle multiple settings profiles (see
// generate-global-tracker-data.py --options / --profiles): any rule field
// that differs between profiles is stored as { "_by_profile": { name:
// value, ... } } instead of a flat value. progForGame() resolves that down
// to a plain graph for whichever profile a *slot* has picked (see the
// profile <select> in renderSlots below) -- different slots can share the
// same rules file (progKey) but each ask for a different profile, so the
// resolved-graph cache is keyed by progKey+profile, not just progKey.
const _resolvedGraphCache = {} // "progKey::profile" -> { srcRef, resolved }

function progForGame(progKey, requestedProfile) {
  const src = window.db.progFiles[progKey]
  if (!src) return null
  let raw
  try {
    raw = typeof src === "string" ? JSON.parse(src) : src
  } catch (e) {
    console.error("Failed to parse map graph for", progKey, e)
    return null
  }

  const names =
    (typeof MapEngine !== "undefined" &&
      MapEngine.profileNamesOf &&
      MapEngine.profileNamesOf(raw)) ||
    []
  if (names.length === 0) return raw // older single-profile file, nothing to resolve

  const profile =
    names.includes(requestedProfile) ? requestedProfile : (
      MapEngine.defaultProfileName(raw)
    )

  const cacheKey = `${progKey}::${profile}`
  const cached = _resolvedGraphCache[cacheKey]
  if (cached && cached.srcRef === src) return cached.resolved
  const resolved = MapEngine.resolveProfile(raw, profile)
  _resolvedGraphCache[cacheKey] = { srcRef: src, resolved }
  return resolved
}

// Names of the settings profiles available for a slot's currently-selected
// rules file, [] if that file doesn't exist or is a single-profile file.
function profileNamesFor(progKey) {
  const raw = window.db.progFiles?.[progKey]
  if (
    !raw ||
    typeof MapEngine === "undefined" ||
    !MapEngine.profileNamesOf
  )
    return []
  return MapEngine.profileNamesOf(raw)
}

// Which profile name a slot is actually using right now: its own explicit
// choice if still valid for the currently-loaded file, else that file's
// default profile.
function activeProfileFor(conn) {
  const names = profileNamesFor(conn.progKey)
  if (names.length === 0) return null
  const raw = window.db.progFiles[conn.progKey]
  return names.includes(conn.profile) ?
      conn.profile
    : MapEngine.defaultProfileName(raw)
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
  const graph = progForGame(conn.progKey, conn.profile)

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
  ctAutoSync(conn)

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
  const graph = progForGame(conn.progKey, conn.profile)
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
  // Locations just got checked off (possibly clearing the last obtainable
  // one) -- re-sync BK status to match.
  ctAutoSync(conn)
}

// ---------------------------------------------------------------------
// UI: connections panel
// ---------------------------------------------------------------------
const slotsRoot = document.getElementById("slots")
const progRoot = document.getElementById("progFiles")

function gamesWithProg() {
  return Object.keys(window.db.progFiles || {}).sort((a, s) =>
    a.localeCompare(s, undefined, { numeric: true })
  )
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

// Keeps the "Add a slot" game picker in sync with whatever rules JSON
// files have been loaded, showing each entry's name + version. Games
// with a single loaded version are a plain one-click item; games with
// multiple loaded versions become a nested group you expand to pick a
// version from, like a titlebar menu.
//
// The picker is a custom widget (not a native <select>, which can't do
// nested/expandable entries) but keeps the same #gameSelect id and
// exposes its value through a hidden `game` form field, so
// `f.game.value` in the add-slot submit handler keeps working unchanged.
let gameSelectExpanded = null // which game name's submenu is open, if any

function populateGameSelect() {
  let root = document.getElementById("gameSelect")
  if (!root) return

  // First run: the element in markup is still the old <select id="gameSelect">
  // (or nothing has replaced it yet) — swap it for our widget container,
  // preserving id/name so the rest of the app and the form keep working.
  if (
    root.tagName !== "DIV" ||
    !root.classList.contains("game-select")
  ) {
    const replacement = newelem("div", {
      id: "gameSelect",
      class: "game-select",
    })
    root.replaceWith(replacement)
    root = replacement
  }

  const prevValue = root.dataset.value || ""
  const progKeys = gamesWithProg()
  const hasAny = progKeys.length > 0

  // Group progKeys by display game name, so games with >1 loaded
  // version become an expandable group and games with exactly one
  // stay a flat, single-click item.
  const groups = new Map() // name -> [progKey, ...]
  for (const progKey of progKeys) {
    const name = progGameName(progKey)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(progKey)
  }

  const selectedValid = progKeys.includes(prevValue)
  const value = selectedValid ? prevValue : ""
  root.dataset.value = value

  const selectedLabel = (() => {
    if (!value) {
      return hasAny ? "Select a game" : (
          "Load a rules JSON below to select a game"
        )
    }
    const version = progVersion(value)
    const name = progGameName(value)
    return version ? `${name} (v${version})` : name
  })()

  function closeMenu() {
    gameSelectExpanded = null
    const menu = root.querySelector(".game-select-menu")
    menu?.remove()
    root.classList.remove("open")
  }

  function selectValue(progKey) {
    root.dataset.value = progKey
    closeMenu()
    populateGameSelect()
    root
      .querySelector('input[name="game"]')
      ?.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function buildMenu() {
    if (groups.size === 0) {
      return newelem("div", { class: "game-select-menu" }, [
        newelem("div", { class: "game-select-empty" }, [
          "Load a rules JSON below to select a game",
        ]),
      ])
    }
    return newelem(
      "div",
      { class: "game-select-menu" },
      [...groups.entries()].map(([name, keys]) => {
        if (keys.length === 1) {
          const progKey = keys[0]
          return newelem(
            "div",
            {
              class: `game-select-item${progKey === value ? " selected" : ""}`,
              onclick: (e) => {
                e.stopPropagation()
                selectValue(progKey)
              },
            },
            [name],
          )
        }

        const expanded = gameSelectExpanded === name
        return newelem("div", { class: "game-select-group" }, [
          newelem(
            "div",
            {
              class: `game-select-group-header${expanded ? " expanded" : ""}`,
              onclick: (e) => {
                e.stopPropagation()
                gameSelectExpanded = expanded ? null : name
                populateGameSelect()
              },
            },
            [name, newelem("span", { class: "caret" }, ["▸"])],
          ),
          expanded ?
            newelem(
              "div",
              { class: "game-select-submenu" },
              keys.map((progKey) => {
                const version = progVersion(progKey)
                return newelem(
                  "div",
                  {
                    class: `game-select-item${progKey === value ? " selected" : ""}`,
                    onclick: (e) => {
                      e.stopPropagation()
                      selectValue(progKey)
                    },
                  },
                  [version ? `v${version}` : "(unversioned)"],
                )
              }),
            )
          : null,
        ])
      }),
    )
  }

  const wasOpen = root.classList.contains("open")

  root.replaceChildren(
    newelem("input", { type: "hidden", name: "game", value }),
    newelem(
      "button",
      {
        type: "button",
        class: "game-select-trigger",
        disabled: !hasAny,
        onclick: (e) => {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          if (root.classList.contains("open")) closeMenu()
          else {
            root.classList.add("open")
            root.appendChild(buildMenu())
          }
        },
      },
      [selectedLabel, newelem("span", { class: "caret" }, ["▾"])],
    ),
  )

  if (wasOpen) {
    root.classList.add("open")
    root.appendChild(buildMenu())
  }
}

// Close the menu when clicking anywhere outside it.
document.addEventListener("click", (e) => {
  const root = document.getElementById("gameSelect")
  if (!root || !root.classList.contains("open")) return
  if (root.contains(e.target)) return
  gameSelectExpanded = null
  root.classList.remove("open")
  root.querySelector(".game-select-menu")?.remove()
})

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
            (() => {
              // Only shown once a rules file is loaded for this slot's game
              // AND that file actually has more than one settings profile
              // baked in -- otherwise there's nothing to choose between.
              // Each slot keeps its own `conn.profile`, so two slots on the
              // same game+version file can independently track different
              // settings (e.g. one with walls_are_checks on, one off).
              const profileNames =
                hasProg ? profileNamesFor(conn.progKey) : []
              if (profileNames.length <= 1) return null

              const options = {}
              for (const n of profileNames)
                options[`Profile: ${n}`] = n

              const profileSelect = newelem("select", {
                title:
                  "Which settings profile this slot's logic (map + notifications) should use",
                options,
                value: activeProfileFor(conn),
              })
              profileSelect.onchange = () => {
                const idx = window.db.connections.findIndex(
                  (c) => c.id === conn.id,
                )
                if (idx === -1) return
                window.db.connections[idx].profile =
                  profileSelect.value
                if (runtime[conn.id]) {
                  maybeRecomputeProgression(conn, runtime[conn.id])
                }
                // If this slot's map is currently open, reload it against
                // the newly chosen profile too.
                if (
                  db.currentMapConnId === conn.id &&
                  typeof openMapForSlot === "function"
                ) {
                  openMapForSlot(window.db.connections[idx])
                }
                renderSlots()
              }
              return profileSelect
            })(),
            newelem("div", { class: "h" }, [
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
                    if (idx !== -1)
                      window.db.connections.splice(idx, 1)
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
            newelem("div", { class: "h" }, ctPanelFor(conn)),
          ]),
        ]),
      ])
    }),
  )
}

// ---------------------------------------------------------------------
// Cheese Trackers integration: link a slot to a tracker/game so its BK
// (blocked) status can be toggled from here instead of the tracker site.
// The API key is global (one field, used for every linked slot); linking
// only needs a tracker link/ID since the game is auto-matched by slot name.
// ---------------------------------------------------------------------
const ctUiState = {} // connId -> ephemeral link-flow state (not persisted)

function ctUi(connId) {
  return (ctUiState[connId] ??= {
    trackerInput: "",
    busy: false,
    error: "",
  })
}

function ctSaveConn(conn) {
  const idx = window.db.connections.findIndex((c) => c.id === conn.id)
  if (idx !== -1) window.db.connections[idx].ct = conn.ct
}

async function ctDoLink(conn) {
  const ui = ctUi(conn.id)
  const trackerId = ctParseTrackerId(ui.trackerInput)
  if (!trackerId) {
    ui.error = "Enter a tracker link or ID first"
    renderSlots()
    return
  }
  ui.busy = true
  ui.error = ""
  renderSlots()
  try {
    const tracker = await ctGetTracker(trackerId)
    const game = ctGuessGame(
      tracker.games,
      conn.playerName,
      conn.game,
    )
    if (!game) {
      ui.error = `No game on that tracker matches slot name "${conn.playerName}"`
      return
    }
    conn.ct = {
      trackerId,
      gameId: game.id,
      lastKnownStatus: game.progression_status,
      isBk: game.progression_status === CT_BK_VALUE,
    }
    ctSaveConn(conn)
    delete ctUiState[conn.id]
  } catch (e) {
    console.error(e)
    ui.error = e.message || "Failed to fetch tracker"
  } finally {
    ui.busy = false
    renderSlots()
  }
}

function ctUnlink(conn) {
  conn.ct = null
  ctSaveConn(conn)
  delete ctUiState[conn.id]
  renderSlots()
}

// Whether this slot currently has any obtainable-but-unchecked locations,
// per its loaded rules graph. null means we can't tell (no graph loaded
// yet), in which case BK can only be set manually.
function ctObtainableState(conn) {
  const graph = progForGame(conn.progKey, conn.profile)
  const rt = runtime[conn.id]
  if (!graph || !rt?.prevObtainable) return null
  return rt.prevObtainable.size > 0
}

// Forces the linked slot's tracker status to the given BK state.
async function ctApplyStatus(conn, toBk) {
  if (!conn.ct) return
  const ui = ctUi(conn.id)
  ui.busy = true
  ui.error = ""
  renderSlots()
  try {
    const updated = await ctSetBk(conn, toBk)
    conn.ct.isBk = toBk
    conn.ct.lastKnownStatus =
      updated ? updated.progression_status : conn.ct.lastKnownStatus
    ctSaveConn(conn)
  } catch (e) {
    console.error(e)
    ui.error = e.message || "Failed to update status"
  } finally {
    ui.busy = false
    renderSlots()
  }
}

// Called whenever a slot's obtainable-locations set may have changed
// (items received or locations checked off). Silently re-syncs the
// tracker's BK status to match the current logic state, if we can tell
// what it should be and it's not already correct.
function ctAutoSync(conn) {
  if (!conn.ct) return
  const state = ctObtainableState(conn)
  if (state === null) return
  const shouldBeBk = !state
  if (conn.ct.isBk === shouldBeBk) return
  ctApplyStatus(conn, shouldBeBk)
}

function ctPanelFor(conn) {
  const ui = ctUi(conn.id)

  // Already linked: one button that always reflects (and applies) the
  // status the current logic says this slot should have. With no rules
  // graph loaded we can't compute that, so it falls back to a manual
  // toggle of whatever it's currently set to.
  if (conn.ct?.trackerId && conn.ct?.gameId != null) {
    const state = ctObtainableState(conn)
    const targetIsBk = state === null ? !conn.ct.isBk : !state
    const label =
      ui.busy ? "…"
      : state === null ?
        conn.ct.isBk ?
          "Marked BK'd (tap to clear)"
        : "Mark BK'd"
      : targetIsBk ? "Mark BK'd"
      : "Mark Unblocked"

    return [
      newelem(
        "button",
        {
          disabled: ui.busy,
          onclick: () => ctApplyStatus(conn, targetIsBk),
        },
        [label],
      ),
      newelem(
        "button",
        { class: "danger", onclick: () => ctUnlink(conn) },
        ["Unlink"],
      ),
      ui.error ?
        newelem("span", { class: "slot-sub" }, [ui.error])
      : null,
    ]
  }

  // Not linked yet: just a tracker link/ID -- the game is auto-matched by
  // slot name, and the API key is the global one set above.
  const trackerInput = newelem("input", {
    placeholder: "Tracker link or ID (e.g. .../tracker/AAA or AAA)",
    value: ui.trackerInput,
    width: "300px",
  })
  trackerInput.oninput = () => (ui.trackerInput = trackerInput.value)

  return [
    trackerInput,
    newelem(
      "button",
      { disabled: ui.busy, onclick: () => ctDoLink(conn) },
      [ui.busy ? "…" : "Link Cheese Tracker"],
    ),
    ui.error ?
      newelem("span", { class: "slot-sub" }, [ui.error])
    : null,
  ]
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
        const profileNames =
          g && g.profiles && typeof g.profiles === "object" ?
            Object.keys(g.profiles)
          : []
        return newelem("div", { class: "prog-row" }, [
          newelem("div", {}, [
            version ? `${name} — v${version}` : name,
            newelem("div", { class: "file-name" }, [
              `${regionCount} regions · ${locCount} locations` +
                (profileNames.length > 1 ?
                  ` · ${profileNames.length} settings profiles (choose per-slot below)`
                : ""),
            ]),
          ]),
          newelem("div", {}, [
            newelem(
              "button",
              {
                marginRight: "8px",
                onclick() {
                  updateSavedText(progKey).then(() => {
                    // If this row is the map's currently active graph,
                    // feed the freshly-reread JSON straight into it so the
                    // view (reachability, item list, positions) reflects
                    // the update immediately instead of only updating on
                    // next load. loadGraph() reuses saved inventory/
                    // checked-locations/layout for a matching gameKey, so
                    // this is safe to call again on the same graph.
                    if (gameKeyOf() === progKey) {
                      // preserve whichever profile the map is currently
                      // showing for this file, rather than snapping back to
                      // the file's default.
                      loadGraph(
                        window.db.progFiles[progKey],
                        graph?.activeProfile,
                      )
                    } else {
                      renderProgFiles()
                    }
                  })
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
      profile: null, // which settings profile this slot uses, if its rules file has more than one; null = file's default
      ct: null, // Cheese Trackers link, set via the slot card once created
    }
    if (!conn.hostname || !progKey || !conn.game || !conn.playerName)
      return
    window.db.connections.push(conn)
    f.reset()
    document
      .getElementById("gameSelect")
      ?.removeAttribute("data-value")
    populateGameSelect()
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
