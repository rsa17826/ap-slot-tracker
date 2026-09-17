class DataLoading {
  // Loading rules JSON (single file or folder) into window.db.progFiles and initializing the maps graph/inventory/layout from it.

  static collectItemNames() {
    const names = new Set()
    function walk(rule) {
      if (!rule || typeof rule !== "object") return
      if (rule.item_name) names.add(rule.item_name)
      for (const key of ["item_names", "items", "group_items"]) {
        if (Array.isArray(rule[key]))
          rule[key].forEach((n) => names.add(n))
      }
      if (rule.item_counts)
        Object.keys(rule.item_counts).forEach((n) => names.add(n))
      if (rule.counts)
        Object.keys(rule.counts).forEach((n) => names.add(n))
      for (const key of ["rules", "sub_rules"]) {
        if (Array.isArray(rule[key])) rule[key].forEach(walk)
      }
      if (rule.rule) walk(rule.rule)
      if (rule.wrapped) walk(rule.wrapped)
      if (rule.sub_rule) walk(rule.sub_rule)
      if (Array.isArray(rule.children)) rule.children.forEach(walk)
    }
    for (const e of Object.values(State.graph.entrances)) walk(e.rule)
    for (const l of Object.values(State.graph.locations)) walk(l.rule)
    // Event locations auto-grant an item of the same name once
    // reachable (see State.eventItemNameFor) -- make sure that item shows up
    // in the inventory list even if no rule happens to reference it.
    for (const n of DataLoading.collectEventItemNames()) names.add(n)
    // The exporter also dumps the real (non-filler) item pool, which
    // includes items that no rule references directly (e.g. purely
    // "useful" items, or progression items that only ever gate via a
    // group/count rule elsewhere) -- make sure those show up too.
    if (State.graph.items) {
      for (const n of Object.keys(State.graph.items)) names.add(n)
    }
    return Array.from(names).sort()
  }

  static collectEventItemNames() {
    const set = new Set()
    for (const [lname, linfo] of Object.entries(
      State.graph.locations,
    )) {
      if (linfo && linfo.is_event) {
        set.add(State.eventItemNameFor(lname, linfo))
      }
    }
    return set
  }

  // Rule trees don't tell us the true item-pool quantity of each item,
  // but the highest `count` ever demanded by a rule (Has(item, count>=N),
  // item_counts/counts maps, etc.) is a solid lower bound on how many
  // copies can exist -- used to show "x / y" in the inventory.
  static collectItemMaxCounts(itemNames) {
    const max = {}
    for (const n of itemNames) max[n] = 1
    function bump(name, count) {
      const c = Number(count) || 1
      max[name] = Math.max(max[name] ?? 1, c)
    }
    function walk(rule) {
      if (!rule || typeof rule !== "object") return
      if (rule.item_name) bump(rule.item_name, rule.count ?? 1)
      if (rule.item_counts) {
        for (const [n, c] of Object.entries(rule.item_counts))
          bump(n, c)
      }
      if (rule.counts) {
        for (const [n, c] of Object.entries(rule.counts)) bump(n, c)
      }
      for (const key of ["rules", "sub_rules"]) {
        if (Array.isArray(rule[key])) rule[key].forEach(walk)
      }
      if (rule.rule) walk(rule.rule)
      if (rule.wrapped) walk(rule.wrapped)
      if (rule.sub_rule) walk(rule.sub_rule)
      if (Array.isArray(rule.children)) rule.children.forEach(walk)
    }
    for (const e of Object.values(State.graph.entrances)) walk(e.rule)
    for (const l of Object.values(State.graph.locations)) walk(l.rule)

    // For event items, the true max is simply how many distinct event
    // locations grant that item -- more reliable than any single rule's
    // `count` requirement (which may ask for fewer than the total that
    // exist, e.g. needing 13 of 26 "star can be got" flags).
    const eventCounts = {}
    for (const [lname, linfo] of Object.entries(
      State.graph.locations,
    )) {
      if (!linfo || !linfo.is_event) continue
      const itemName = State.eventItemNameFor(lname, linfo)
      eventCounts[itemName] = (eventCounts[itemName] || 0) + 1
    }
    for (const [name, count] of Object.entries(eventCounts)) {
      max[name] = count
    }

    // The exporter's item pool counts (filler excluded) are the true
    // quantity that exists, and take priority over the rule-derived
    // lower bound above -- e.g. 26 "star" items in the pool but a rule
    // only ever asks for 13 of them should still show "x / 26".
    if (State.graph.items) {
      for (const [name, info] of Object.entries(State.graph.items)) {
        const c = Number(info && info.count) || 0
        if (c > 0) max[name] = c
      }
    }

    return max
  }

  // Which profile a rules JSON should be resolved against, given a
  // requested name (typically a slot's own conn.profile, set from the
  // slot-controls picker in app.js): the request if it's actually a
  // valid profile in this file, else the file's own default. Different
  // slots can be pointed at the same rules file (progKey) but ask for
  // different profiles here, independently of each other.
  /**
   * @param {RulesGraph} raw
   * @param {string|undefined} requestedProfile
   */
  static resolvedProfileNameFor(raw, requestedProfile = undefined) {
    const names = MapEngine.profileNamesOf(raw)
    if (names.length === 0) return null
    return names.includes(requestedProfile) ? requestedProfile : (
        MapEngine.defaultProfileName(raw)
      )
  }
  static markTransitLocations() {
    for (const [lname, region] of Object.entries(
      State.graph.regions,
    )) {
      region.isTransit =
        region.locations.filter(
          (/** @type {any} */ e) => !State.eventItemNames.has(e),
        ) == 0
    }
  }
  /**
   * @param {RulesGraph} raw
   * @param {string?} requestedProfile
   */
  static loadGraph(raw, requestedProfile = undefined) {
    State.rawGraph = raw
    const profile = DataLoading.resolvedProfileNameFor(
      raw,
      requestedProfile,
    )
    State.graph = MapEngine.resolveProfile(raw, profile)
    const key = ProgKeys.progKeyFor(raw)
    if (!key) {
      error(requestedProfile, "not valid")
      return
    }
    State.eventItemNames = DataLoading.collectEventItemNames()
    DataLoading.markTransitLocations()
    const itemNames = DataLoading.collectItemNames()
    State.itemMaxCounts = DataLoading.collectItemMaxCounts(itemNames)
    // const savedState = db.state ?? null
    // if (savedState && savedState.gameKey === key) {
    //   inventory = savedState.inventory || {}
    //   checkedLocations = savedState.checkedLocations || {}
    // } else {
    //   inventory = {}
    //   checkedLocations = {}
    //   for (const n of itemNames) inventory[n] = 0
    // }
    State.scoutedItems = {} // scouted data is per-slot/live, not part of saved graph state
    for (const n of itemNames)
      if (!(n in State.inventory)) State.inventory[n] = 0
    db.layout ??= {}
    State.positions = db.layout[key] || {}

    State.els.status.textContent =
      `${Object.keys(State.graph.regions).length} regions · ` +
      `${Object.keys(State.graph.locations).length} locations · ${itemNames.length} items`
    State.els.emptyMsg.style.display = "none"

    Render.buildItemList(itemNames)
    Layout.layoutIfNeeded()
    Render.render()

    // Publish this graph into the tracker's shared store so app.js can
    // use it for progression notifications too — the map is now the
    // single source of truth for "prog" data, replacing prog.js.
    // Keyed by game+version so multiple rules revisions of the same
    // game can be stored side by side.
    if (window.db) {
      window.db.progFiles[key] = raw
      ProgFilesUI.renderProgFiles()
      SlotsUI.renderSlots()
    }
  }
}
