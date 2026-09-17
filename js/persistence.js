class Persistence {
  // Saving/restoring map view state (positions, toggles, etc.) to the local db.

  static layoutTimer = null
  static saveLayout() {
    db.layout ??= {}
    var k = ProgKeys.progKeyFor(graph)
    if (!k) {
      error(name, "not valid")
      return
    }
    db.layout[k] = positions
    db.view = view
  }
}
