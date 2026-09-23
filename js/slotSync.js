class SlotSync {
  // Bridges a live AP slot connection (from app.js) into the map view: opening the map for a slot and keeping it synced as items/checks come in.

  static openMapForSlot(conn) {
    db.currentMapConnId = conn.id
    SlotSync.setMapVisible(true)
    SlotSync.syncFromSlot(conn)
  }

  // Called by app.js whenever a slot gets new items/checks, regardless
  // of whether the map is even open. Only re-syncs the map if it's
  // currently showing this exact slot.
  static notifyMapOfSlotUpdate(conn) {
    if (!conn || conn.id !== db.currentMapConnId) return
    if (!SlotSync.appEl.classList.contains("visible")) return
    SlotSync.syncFromSlot(conn)
  }

  static appEl = document.getElementById("app")
  static setMapVisible(v) {
    SlotSync.appEl.classList.toggle("visible", v)
    if (v) Render.scheduleDraw()
  }

  static async syncFromSlot(conn) {
    if (!conn || conn.id !== db.currentMapConnId) return
    const raw = db.progFiles[conn.progKey]
    const wantProfile =
      raw ?
        DataLoading.resolvedProfileNameFor(raw, conn.profile)
      : null
    if (
      !State.graph ||
      CustomLayout.gameKeyOf() !== conn.progKey ||
      State.graph.activeProfile !== wantProfile
    ) {
      const ok = await Main.tryLoadFile(conn.progKey, conn.profile)
      if (!ok) {
        alert(
          "error, failed to load tracker for " +
            (conn.game || conn.progKey),
        )
      }
    }
    // `runtime` is app.js's connId -> {client, receivedCounts, ...} map;
    // shared global scope means it's directly visible here.
    const rt = Connections.runtime[conn.id]
    if (!rt || !rt.client || !State.graph) {
      State.scoutedItems = {}
      State.scoutOwnSlot = null
      State.scoutPlayerNames = {}
      State.scoutTrackedSlots = new Set()
      Render.scheduleDraw()
      return
    }

    for (const n of Object.keys(State.inventory))
      State.inventory[n] = 0
    for (const [name, count] of Object.entries(
      rt.receivedCounts || {},
    )) {
      State.inventory[name] = count
    }

    const idToName = rt.client.locationIdToName?.[conn.game] || {}
    State.checkedLocations = {}
    for (const id of rt.client.checkedLocations || []) {
      const lname = idToName[id]
      if (lname) State.checkedLocations[lname] = true
    }

    State.scoutedItems = {}
    for (const entry of Object.values(rt.client.scoutedItems || {})) {
      State.scoutedItems[entry.locationName] = entry
    }
    State.hints = rt.client.hints
    State.scoutOwnSlot = rt.client.slot
    State.scoutPlayerNames = {}
    for (const p of rt.client.players || []) {
      if (p.team === rt.client.team)
        State.scoutPlayerNames[p.slot] = p.name
    }

    // Any other connection pointed at the same AP server (same
    // hostname:port) is a slot we're also actively tracking -- used to
    // Render.draw a green star on scouted items instead of a yellow one.
    State.scoutTrackedSlots = new Set()
    for (const conn2 of Object.values(db.connections)) {
      if (
        conn2.hostname !== conn.hostname ||
        conn2.port !== conn.port
      )
        continue
      const rt2 = Connections.runtime[conn2.id]
      if (rt2?.client?.slot != null)
        State.scoutTrackedSlots.add(rt2.client.slot)
    }

    State.view = db.view[conn.game] ??= {
      x: 40,
      y: 40,
      scale: 1,
    }
    Render.syncItemListUI()
    Render.onInventoryChange()
  }
}
// Tab toggles the map overlay, except while typing in a form field
// (so normal tab-between-fields behavior in the "Add a slot" form
// still works).
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Tab") return
  // const tag = ev.target.tagName
  // if (
  //   tag === "INPUT" ||
  //   tag === "TEXTAREA" ||
  //   tag === "SELECT" ||
  //   ev.target.isContentEditable
  // )
  //   return
  ev.preventDefault()
  SlotSync.setMapVisible(
    !SlotSync.appEl.classList.contains("visible"),
  )
})
