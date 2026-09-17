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

  // Reads every .json file directly inside dirHandle and registers it
  // as a rule list (db.progFiles), without descending into
  // subfolders. Re-running this (e.g. on startup, or via the
  // "Load rules folder" button again) picks up any files added to
  // the folder since the last scan.
  static async scanProgFolder(dirHandle, { loadFirst = false } = {}) {
    db.fileHandles ??= {}
    window.db.progFiles ??= {}
    let firstRaw = null
    for await (const entry of dirHandle.values()) {
      if (
        entry.kind !== "file" ||
        !entry.name.toLowerCase().endsWith(".json")
      )
        continue
      try {
        const file = await entry.getFile()
        const raw = JSON.parse(await file.text())
        const key = ProgKeys.progKeyFor(raw)
        if (!key) {
          continue
        }
        db.fileHandles[key] = entry
        window.db.progFiles[key] = raw
        if (!firstRaw) firstRaw = raw
      } catch (e) {
        console.error("Could not parse", entry.name, e)
      }
    }
    ProgFilesUI.renderProgFiles()
    SlotsUI.renderSlots()
    if (loadFirst && firstRaw) DataLoading.loadGraph(firstRaw)
  }

  static async tryLoadFile(name, profile) {
    if (name && db.progFiles[name]) {
      DataLoading.loadGraph(db.progFiles[name], profile)
    } else {
      return false
    }
    Interaction.applyView()
    return true
  }

  static async updateSavedText(name) {
    if (name && db.fileHandles[name]) {
      try {
        db.progFiles[name] = JSON.parse(
          await (await db.fileHandles[name].getFile()).text(),
        )
      } catch (e) {
        a.getfileperms(db.fileHandles[name]).then(async (e) => {
          db.progFiles[name] = JSON.parse(
            await (await db.fileHandles[name].getFile()).text(),
          )
        })
      }
    }
  }
}
// Wires up all the map screens UI controls (buttons, checkboxes, modals) to the functions defined in the other map-*.js files, and does initial setup.

document
  .getElementById("loadBtn")
  .addEventListener("click", async () => {
    const handles = await showOpenFilePicker({
      types: [
        {
          description: "JSON Files",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
      excludeAcceptAllOption: true,
      multiple: true,
    })

    const fh = handles.pop()
    const file = await fh.getFile()
    ;(async () => {
      db.fileHandles ??= {}
      for (var fh of handles) {
        try {
          var text = JSON.parse(await (await fh.getFile()).text())
          var k = ProgKeys.progKeyFor(text)
          if (!k) error("an invalid file selected")
          db.fileHandles[k] = fh
        } catch (e) {
          error(e)
        }
      }
    })()
    if (!file) return
    const text = await file.text()
    try {
      const raw = JSON.parse(text)
      const key = ProgKeys.progKeyFor(raw)
      if (!key) {
        error(name, "not valid")
        return
      }
      db.fileHandles[key] = fh
      DataLoading.loadGraph(raw)
    } catch (e) {
      alert("Could not parse JSON: " + e.message)
    }
  })

document
  .getElementById("loadFolderBtn")
  .addEventListener("click", async () => {
    try {
      const dirHandle = await showDirectoryPicker()
      // Remember the folder itself (not just its current
      // contents) so it can be rescanned later, e.g. on next
      // page load, to pick up files added afterwards.
      db.progFolderHandle = dirHandle
      await Main.scanProgFolder(dirHandle, {
        loadFirst: !State.graph,
      })
    } catch (e) {
      if (e.name !== "AbortError")
        alert("Could not load folder: " + e.message)
    }
  })
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
  window.db.progFiles ??= {}
  window.db.ctApiKey ??= ""
  window.db.launchURLs ??= {}
  const ctApiKeyInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById("ctApiKeyInput")
  )
  if (ctApiKeyInput) {
    ctApiKeyInput.value = window.db.ctApiKey || ""
    ctApiKeyInput.oninput = () => {
      window.db.ctApiKey = ctApiKeyInput.value.trim()
    }
  }
  Render.loadColors()
  Interaction.setupPanZoom()
  State.view = db.view ?? { x: 40, y: 40, scale: 1 }
  State.hideEvents = db.hideEvents ?? false
  State.els.hideEventsChk.checked = State.hideEvents
  State.els.hideEventsChk.addEventListener("change", () => {
    State.hideEvents = State.els.hideEventsChk.checked
    db.hideEvents = State.hideEvents
    Render.render()
  })
  State.hideEmptyNodes = db.hideEmptyNodes ?? false
  State.els.hideEmptyNodesChk.checked = State.hideEmptyNodes
  State.els.hideEmptyNodesChk.addEventListener("change", () => {
    State.hideEmptyNodes = State.els.hideEmptyNodesChk.checked
    db.hideEmptyNodes = State.hideEmptyNodes
    Render.render()
  })
  State.hideOOL = db.hideOOL ?? false
  State.els.hideOOLChk.checked = State.hideOOL
  State.els.hideOOLChk.addEventListener("change", () => {
    State.hideOOL = State.els.hideOOLChk.checked
    db.hideOOL = State.hideOOL
    Render.render()
  })
  State.hideCleared = db.hideCleared ?? false
  State.els.hideClearedChk.checked = State.hideCleared
  State.els.hideClearedChk.addEventListener("change", () => {
    State.hideCleared = State.els.hideClearedChk.checked
    db.hideCleared = State.hideCleared
    Render.render()
  })
  State.noTransit = db.noTransit ?? false
  State.els.noTransitChk.checked = State.noTransit
  State.els.noTransitChk.addEventListener("change", () => {
    State.noTransit = State.els.noTransitChk.checked
    db.noTransit = State.noTransit
    Render.render()
  })
  State.showScouts = db.showScouts ?? false
  State.els.showScoutsChk.checked = State.showScouts
  State.els.showScoutsChk.addEventListener("change", () => {
    State.showScouts = State.els.showScoutsChk.checked
    db.showScouts = State.showScouts
    Render.render()
  })
  CustomLayout.loadCustomSortFns()
  const lastConn = db.connections?.[db.currentMapConnId]
  if (lastConn) SlotSync.syncFromSlot(lastConn)
  Main.refreshNotifBtn()
  ProgFilesUI.renderProgFiles()
  SlotsUI.renderSlots()
  // If a rules folder was picked in a previous session, rescan it
  // now so files added since then show up. Permission may not be
  // grantable without a user gesture on some browsers; fail quietly
  // if so (the "Load rules folder" button can always re-grant it).
  if (window.db.progFolderHandle) {
    ;(async () => {
      try {
        a.getfileperms(window.db.progFolderHandle).then(async (e) => {
          await Main.scanProgFolder(window.db.progFolderHandle)
        })
      } catch (e) {
        console.error("Could not rescan saved rules folder", e)
      }
    })()
  }
  // Auto-reconnect any saved slots
  Object.values(window.db.connections).forEach((conn) =>
    Connections.startConnection(conn),
  )
  if (db.currentMapConnId) {
    var s = db.connections[db.currentMapConnId]
    if (s) SlotSync.syncFromSlot(s)
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
    const progKey = f.game.value.trim()
    /** @type {SlotConnection} */
    const conn = {
      autoUpdateCTStatus: true,
      id: Math.random().toString(36).slice(2, 10),
      hostname: f.hostname.value.trim(),
      port: f.port.value.trim(),
      game: SlotsUI.progGameName(progKey), // actual AP protocol game name
      progKey, // which loaded ruleset/version this slot uses for the map
      playerName: f.playerName.value.trim(),
      password: f.password.value,
      notifyMode: "all",
      profile: null, // which settings profile this slot uses, if its rules file has more than one; null = file's default
      ct: null, // Cheese Trackers link, set via the slot card once created
    }
    if (!conn.hostname || !progKey || !conn.game || !conn.playerName)
      return
    window.db.connections[conn.id] = conn
    document
      .getElementById("gameSelect")
      ?.removeAttribute("data-value")
    SlotsUI.populateGameSelect()
    SlotsUI.renderSlots()
    Connections.startConnection(conn)
  })
Main.notifBtn.addEventListener("click", async () => {
  if (Notification.permission !== "granted") {
    await Notification.requestPermission()
  }
  Main.refreshNotifBtn()
})
