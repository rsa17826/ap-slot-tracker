class MapEngine {
  // Headless MapEngine: pure reachability computation + settings-profile resolution, exposed as window.MapEngine for app.js to use.

  static computeReachablePure(graph, inventory, checkedLocations) {
    const eventInventory = {} // itemName -> 1, granted once its event location is reachable
    function countHave(name) {
      return (inventory[name] || 0) + (eventInventory[name] || 0)
    }
    const regionNames = Object.keys(graph.regions)
    const regions = new Set([graph.origin_region_name])
    const entrances = new Set()
    const locations = new Set()
    // Sets are mutated in place below, so one ctx built up front stays
    // valid for the whole fixed-point loop -- no per-iteration reassignment needed.
    const ctx = {
      countHave,
      reach: { regions, locations, entrances },
    }
    for (let iter = 0; iter < 20; iter++) {
      let changed = false
      for (const rname of regionNames) {
        if (!regions.has(rname)) continue
        const region = graph.regions[rname]
        for (const exitName of region.exits || []) {
          const einfo = graph.entrances[exitName]
          if (!einfo) continue
          if (RuleEngine.evalRule(einfo.rule, ctx)) {
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
      // "locations" here means reachable, regardless of checked state —
      // callers filter out already-checked ones themselves. Computed
      // inside the fixed-point loop (not after it) because a reachable
      // event location auto-grants its item, which can in turn unlock
      // further entrances/locations.
      for (const [lname, linfo] of Object.entries(graph.locations)) {
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
              // Each reachable event location grants one copy of its
              // item -- multiple distinct locations can share the same
              // item name (e.g. 26 "star can be got" events all
              // granting "flag:starCanBeGot"), so this accumulates
              // rather than just flagging presence. Safe against
              // double-counting since `locations.has(lname)` above
              // ensures each location is only processed once, the
              // first time it becomes reachable.
              eventInventory[itemName] =
                (eventInventory[itemName] || 0) + 1
              changed = true
            }
          }
        }
      }
      if (!changed) break
    }
    return { regions, locations, entrances, eventInventory }
  }
  /* ============================================================
                SETTINGS PROFILES
                generate-global-tracker-data.py can now dump multiple
                settings profiles into one rules JSON. Any field that
                differs between profiles is stored as
                { "_by_profile": { profileName: value, ... } } instead
                of a flat value; everything else is stored flat as
                before. `MapEngine.resolveProfile` walks the raw JSON and swaps
                each _by_profile marker for the value belonging to one
                chosen profile, producing an ordinary flat graph that
                the rest of the app (RuleEngine.evalRule, Reachability.computeReachability,
                MapEngine.computeReachablePure, etc.) can keep using unchanged.
                ============================================================ */
  static profileNamesOf(raw) {
    return raw?.profiles ? Object.keys(raw.profiles) : []
  }

  static defaultProfileName(raw) {
    const names = MapEngine.profileNamesOf(raw)
    if (names.length === 0) return null
    return names.includes("default") ? "default" : names[0]
  }

  static resolveProfile(raw, profileName) {
    if (!raw || !raw.profiles) return raw // older single-profile file, nothing to resolve

    function resolve(node) {
      if (Array.isArray(node)) return node.map(resolve)
      if (node && typeof node === "object") {
        if (
          Object.prototype.hasOwnProperty.call(node, "_by_profile")
        ) {
          const byProfile = node._by_profile
          const value =
            profileName != null && profileName in byProfile ?
              byProfile[profileName]
            : "default" in byProfile ? byProfile.default
            : Object.values(byProfile)[0]
          return resolve(value)
        }
        const out = {}
        for (const [k, v] of Object.entries(node)) out[k] = resolve(v)
        return out
      }
      return node
    }

    const { profiles, ...rest } = raw
    const resolved = resolve(rest)
    resolved.profiles = profiles // keep the original profile catalog around for the UI
    resolved.activeProfile = profileName
    return resolved
  }

  // Unhandled-rule-type logging for the shared RuleEngine.evalRule's ctx.MapEngine.warnOnce,
  // used by the live UI reachability pass (Reachability.computeReachability) so an
  // unmapped rule type is reported to console once instead of silently.
  static warnedTypes = new Set()
  static warnOnce(t) {
    if (!MapEngine.warnedTypes.has(t)) {
      MapEngine.warnedTypes.add(t)
      console.warn("Unhandled rule type:", t)
    }
  }

  static countHave(name) {
    return (
      (State.inventory[name] || 0) + (State.eventInventory[name] || 0)
    )
  }
}
