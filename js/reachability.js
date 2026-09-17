class Reachability {
  // Live UI reachability pass: recomputes reach.{regions,locations,entrances} from the current inventory/checked state and refreshes derived UI state.

  static computeReachability() {
    const regionNames = Object.keys(State.graph.regions)
    const startRegion = State.graph.origin_region_name

    const regions = new Set([startRegion])
    const entrances = new Set()
    const locations = new Set()
    State.eventInventory = {}

    // Sets are mutated in place below, so one ctx built up front stays
    // valid for the whole fixed-point loop -- no per-iteration reassignment needed.
    const ctx = {
      countHave: MapEngine.countHave,
      reach: { regions, locations, entrances },
      warnOnce: MapEngine.warnOnce,
    }

    for (let iter = 0; iter < 20000; iter++) {
      let changed = false

      for (const rname of regionNames) {
        if (!regions.has(rname)) continue
        const region = State.graph.regions[rname]
        for (const exitName of region.exits || []) {
          const einfo = State.graph.entrances[exitName]
          if (!einfo) continue
          const ok = RuleEngine.evalRule(einfo.rule, ctx)
          if (ok) {
            if (!entrances.has(exitName)) {
              entrances.add(exitName)
              changed = true
            }
            if (
              einfo.connects_to &&
              !regions.has(einfo.connects_to)
            ) {
              regions.add(einfo.connects_to)
              changed = true
            }
          }
        }
      }

      // Computed inside the fixed-point loop (not after it), because a
      // reachable event location auto-grants its item to inventory,
      // which can unlock further entrances/locations in a later pass.
      for (const [lname, linfo] of Object.entries(
        State.graph.locations,
      )) {
        if (locations.has(lname)) continue
        if (
          regions.has(linfo.region) &&
          RuleEngine.evalRule(linfo.rule, ctx)
        ) {
          locations.add(lname)
          changed = true
          if (linfo.is_event) {
            const itemName = State.eventItemNameFor(lname, linfo)
            if (itemName) {
              State.eventInventory[itemName] =
                (State.eventInventory[itemName] || 0) + 1
              changed = true
            }
          }
        }
      }

      if (!changed) break
    }

    State.reach = { regions, locations, entrances }
  }

  // A location counts as "done" once nothing further is needed from it:
  // either the user has checked it, or (for event locations, which
  // auto-grant their item the moment they're reachable rather than via
  // the checkbox) it's currently reachable.
  static isLocationDone(lname) {
    if (State.checkedLocations[lname]) return true
    const linfo = State.graph.locations[lname]
    if (linfo && linfo.is_event)
      return State.reach.locations.has(lname)
    return false
  }

  // A region counts as "empty" once none of its locations would actually
  // be drawn after applying the active row filters (hideEvents/hideOOL/
  // hideCleared) -- whatever combination emptied it out. Used so a node
  // doesn't linger on the map showing nothing.
  static isRegionEmptyAfterFilters(rname) {
    const region = State.graph.regions[rname]
    const locs = (region && region.locations) || []
    if (locs.length === 0) return false
    return Layout.computeNodeRows(region).length === 0
  }

  // A region counts as a "transit" node when it has no locations at
  // all -- nothing to check there, it's just a hallway between other
  // regions. Used by noTransit mode to hide it and let connections
  // pass through to the next region(s) that actually have checks.
  static isTransitRegion(rname) {
    return State.graph.regions[rname]?.isTransit
  }

  static isRegionVisible(rname) {
    if (
      State.hideEmptyNodes &&
      State.hideOOL &&
      !State.reach.regions.has(rname)
    )
      return false
    if (
      State.hideEmptyNodes &&
      (State.hideEvents || State.hideCleared || State.hideOOL) &&
      Reachability.isRegionEmptyAfterFilters(rname)
    )
      return false
    if (!Reachability.regionMatchesSearch(rname, State.searchQuery))
      return false
    if (State.noTransit && Reachability.isTransitRegion(rname))
      return false
    return true
  }

  // Region names focus mode currently allows on the map -- used both
  // for rendering and to bias the layout functions so they only
  // position/pack nodes that are actually visible.
  static visibleRegionNames() {
    const names = Object.keys(State.graph.regions)
    return names.filter(Reachability.isRegionVisible)
  }

  // A region matches the search box if its own name matches, or any of
  // its locations' names do -- so searching for a check still surfaces
  // the node that contains it.
  static regionMatchesSearch(rname, q) {
    if (!q) return true
    if (rname.toLowerCase().includes(q)) return true
    const region = State.graph.regions[rname]
    const locs = (region && region.locations) || []
    return locs.some((lname) => lname.toLowerCase().includes(q))
  }

  // Applies the current search query to both the inventory list and the
  // map. The map side no longer touches any DOM -- Render.draw() already
  // checks Reachability.regionMatchesSearch per node/edge every frame (cheap: a
  // couple of string comparisons per region), so a search keystroke
  // just needs to trigger a redraw.
  static applySearchFilter() {
    State.els.itemList
      .querySelectorAll(".item-row")
      .forEach((row) => {
        const isEvent = State.eventItemNames.has(row.dataset.name)
        const matchesSearch = row.dataset.name
          .toLowerCase()
          .includes(State.searchQuery)
        row.style.display =
          State.hideEvents && isEvent ? "none"
          : matchesSearch ? ""
          : "none"
      })

    Render.scheduleDraw()
  }
}
