class ProgKeys {
  // Resolves which loaded rules-JSON (progKey) and settings profile a slot uses, and maps its checked AP location ids to map-graph location names.

  // "progFiles" now holds the same rules-JSON graph the map (index.html)
  // loads — regions/entrances/locations with rule trees — rather than the
  // old prog.js PROG-array format. The map writes into this store itself
  // whenever a rules JSON is loaded, so nothing else needs to upload it.
  //
  // Multiple rules files for the *same* game are allowed as long as their
  // `.version` differs (e.g. re-rolling a game's logic between releases),
  // so progFiles/fileHandles/layout are all keyed by a composite
  // "game@vVERSION" key rather than by game name alone.
  static progKeyFor(raw) {
    const game = raw?.game
    const version = raw?.version
    if (!game || !version) return null
    return `${game}@v${version}`
  }

  // Rules JSON can now bundle multiple settings profiles (see
  // generate-global-tracker-data.py --options / --profiles): any rule field
  // that differs between profiles is stored as { "_by_profile": { name:
  // value, ... } } instead of a flat value. ProgKeys.progForGame() resolves that down
  // to a plain graph for whichever profile a *slot* has picked (see the
  // profile <select> in SlotsUI.renderSlots below) -- different slots can share the
  // same rules file (progKey) but each ask for a different profile, so the
  // resolved-graph cache is keyed by progKey+profile, not just progKey.
  static _resolvedGraphCache = {} // "progKey::profile" -> { srcRef, resolved }
  static progForGame(progKey, requestedProfile) {
    const src = window.db.progFiles[progKey]
    if (!src) return null
    let raw
    try {
      raw = typeof src === "string" ? JSON.parse(src) : src
    } catch (e) {
      console.error("Failed to parse map graph for", progKey, e)
      return null
    }

    const names = MapEngine.profileNamesOf(raw)
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
  static profileNamesFor(progKey) {
    const raw = window.db.progFiles?.[progKey]
    return MapEngine.profileNamesOf(raw)
  }

  // Which profile name a slot is actually using right now: its own explicit
  // choice if still valid for the currently-loaded file, else that file's
  // default profile.
  static activeProfileFor(conn) {
    const names = ProgKeys.profileNamesFor(conn.progKey)
    if (names.length === 0) return null
    const raw = window.db.progFiles[conn.progKey]
    return names.includes(conn.profile) ?
        conn.profile
      : MapEngine.defaultProfileName(raw)
  }

  // Maps this slot's checked AP location ids to the "Room - Token" names the
  // map graph uses, via the data package the client already downloaded.
  static checkedLocationNames(conn, rt) {
    const idToName = rt.client.locationIdToName?.[conn.game] || {}
    const out = {}
    for (const id of rt.client.checkedLocations || []) {
      const name = idToName[id]
      if (name) out[name] = true
    }
    return out
  }
  // Progression notifications only care about real, checkable locations --
  // event locations (flag/beat-stage tokens etc.) aren't in the item pool
  // and can't be "checked" by the player, so they shouldn't count toward
  // "new obtainable location(s)".
  static isRealLocation(graph, name) {
    const linfo = graph.locations[name]
    return !!linfo && !linfo.is_event
  }
}
