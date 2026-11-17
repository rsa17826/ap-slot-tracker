class Main {
  // ---------------------------------------------------------------------
  // Notifications permission
  // ---------------------------------------------------------------------
  static notifBtn = document.getElementById("notifBtn")
  static refreshNotifBtn() {
    if (Notification.permission === "granted") {
      Main.notifBtn.textContent = "Notifications on"
      Main.notifBtn.classList.add("granted")
    } else {
      Main.notifBtn.textContent = "Enable notifications"
      Main.notifBtn.classList.remove("granted")
    }
  }

}

document.getElementById("resetBtn").addEventListener("click", () => {
  if (!State.graph) return
  if (!confirm("Reset inventory and checked locations?")) return
  for (const k of Object.keys(State.inventory)) State.inventory[k] = 0
  State.checkedLocations = {}
  Render.syncItemListUI()
  Render.onInventoryChange()
})
document
  .getElementById("autoLayoutBtn")
  .addEventListener("click", () => {
    if (!State.graph) return
    Layout.autoLayout()
    Render.render()
  })
State.els.search.addEventListener("input", () => {
  State.searchQuery = State.els.search.value.trim().toLowerCase()
  Reachability.applySearchFilter()
})
State.els.search.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    ev.preventDefault()
    ev.stopPropagation()
    State.els.search.value = ""
    State.searchQuery = ""
    Reachability.applySearchFilter()
    State.els.search.blur()
  } else if (ev.key === "Enter") {
    ev.preventDefault()
    State.els.search.blur()
  }
})
// "/" focuses the search box from anywhere on the page (like a quick
// find), as long as the user isn't already typing into some other
// field or the sort-function editor.
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "/") return
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return
  const active = /** @type {HTMLElement | null} */ (
    document.activeElement
  )
  const isEditable =
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.isContentEditable)
  if (isEditable) return
  if (State.els.sortFnModal.classList.contains("visible")) return
  ev.preventDefault()
  State.els.search.focus()
  State.els.search.select()
})
;(async () => {
  window.db = await createDB("ap_tracker")
  window.db.connections ??= {}
  window.db.ctApiKey ??= ""
  window.db.view ??= {}
  window.db.launchURLs ??= {}
  db.hideEvents ??= false
  db.hideOOL ??= false
  db.hideEmptyNodes ??= false
  db.hideCleared ??= false
  db.noTransit ??= false
  db.showScouts ??= false
  db.customSortFns ??= {}
  db.groupCollapsed ??= {}
  const ctApiKeyInput = /** @type {HTMLInputElement} */ (
    document.getElementById("ctApiKeyInput")
  )
  ctApiKeyInput.value = window.db.ctApiKey
  ctApiKeyInput.oninput = () => {
    window.db.ctApiKey = ctApiKeyInput.value.trim()
  }
  Render.loadColors()
  Interaction.setupPanZoom()
  State.els.hideEventsChk.checked = db.hideEvents
  State.els.hideEventsChk.addEventListener("change", () => {
    db.hideEvents = State.els.hideEventsChk.checked
    db.hideEvents = db.hideEvents
    Render.render()
  })
  State.els.hideEmptyNodesChk.checked = db.hideEmptyNodes
  State.els.hideEmptyNodesChk.addEventListener("change", () => {
    db.hideEmptyNodes = State.els.hideEmptyNodesChk.checked
    Render.render()
  })
  State.els.hideOOLChk.checked = db.hideOOL
  State.els.hideOOLChk.addEventListener("change", () => {
    db.hideOOL = State.els.hideOOLChk.checked
    Render.render()
  })
  State.els.hideClearedChk.checked = db.hideCleared
  State.els.hideClearedChk.addEventListener("change", () => {
    db.hideCleared = State.els.hideClearedChk.checked
    Render.render()
  })
  State.els.noTransitChk.checked = db.noTransit
  State.els.noTransitChk.addEventListener("change", () => {
    db.noTransit = State.els.noTransitChk.checked
    Render.render()
  })
  State.els.showScoutsChk.checked = db.showScouts
  State.els.showScoutsChk.addEventListener("change", () => {
    db.showScouts = State.els.showScoutsChk.checked
    Render.render()
  })
  Main.refreshNotifBtn()
  SlotsUI.renderSlots()
  await HostApi.init()
  // generate every slot's graph first (python serialises these), then drop cache files no slot uses
  await Promise.all(
    Object.values(window.db.connections).map((c) => HostApi.ensureGraph(c)),
  )
  await HostApi.gc()
  Object.values(window.db.connections).forEach((conn) => {
    if (conn.autoConnect) Connections.startConnection(conn)
  })
  if (db.currentMapConnId) {
    SlotSync.syncFromSlot(db.connections[db.currentMapConnId])
  }
})()
;(async () => {
  await (navigator?.serviceWorker?.ready ?? new Promise(() => {}))
  // @ts-ignore
  document.querySelector("#swbtn").style.display = "none"
})()

// Top-level wiring: the add-slot form submit handler and the notifications-permission button.

// ---------------------------------------------------------------------
// Add-connection form
// ---------------------------------------------------------------------
/**
 * @typedef {HTMLFormElement & {
 *   game: HTMLInputElement,
 *   hostname: HTMLInputElement,
 *   port: HTMLInputElement,
 *   playerName: HTMLInputElement,
 *   password: HTMLInputElement,
 * }} AddSlotForm
 */
document
  .getElementById("addSlotForm")
  ?.addEventListener("submit", (e) => {
    e.preventDefault()
    const f = /** @type {AddSlotForm} */ (e.target)
    const game = f.game.value.trim()
    /** @type {SlotConnection} */
    const conn = {
      autoUpdateCTStatus: true,
      id: Math.random().toString(36).slice(2, 10),
      hostname: f.hostname.value.trim(),
      port: f.port.value.trim(),
      game, // installed world name, same as the AP protocol game name
      yamlPath: null, // null = auto-detect from the Players dir by slot name, else the picked file
      cacheKey: null,
      optionsSource: null,
      playerName: f.playerName.value.trim(),
      password: f.password.value,
      notifyMode: "all",
      ct: null, // Cheese Trackers link, set via the slot card once created
      autoConnect: true,
    }
    if (!conn.hostname || !conn.game || !conn.playerName)
      return
    window.db.connections[conn.id] = conn
    SlotsUI.renderSlots()
    Connections.startConnection(conn)
  })
Main.notifBtn.addEventListener("click", async () => {
  if (Notification.permission !== "granted") {
    await Notification.requestPermission()
  }
  Main.refreshNotifBtn()
})
