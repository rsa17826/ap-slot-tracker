class CustomLayout {
  // Custom layout editor: lets the user supply a per-game sort(name)->{x,y} function and packs the resulting grid into pixel positions.

  static DEFAULT_SORT_FN_SRC = `function sort(name) {
  // Return a logical grid cell for this region. Regions sharing a
  // cell get packed side by side based on the column's widest node.
  // Example for a "stageN" naming scheme, 5 per row:
  //
  // if (name.startsWith("stage")) {
  //   const n = Number(name.replace("stage", ""))
  //   return { x: n % 5, y: 1 + ((n / 5) | 0) }
  // }

  return { x: 0, y: 0 }
}`

  static gameKeyOf() {
    return ProgKeys.progKeyFor(State.graph)
  }

  static compileSortFn(src) {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      `${src}\nif (typeof sort !== "function") throw new Error("expected a function named sort(name)"); return sort;`,
    )
    return fn()
  }

  static runCustomLayout(gameKey, src) {
    const sortFn = CustomLayout.compileSortFn(src) // throws on bad code

    const names = Reachability.visibleRegionNames()

    // Measure current on-screen node sizes (nodes must already be
    // rendered for the active game). Only visible nodes are on-screen
    // in focus mode, which is fine -- hidden nodes aren't being
    // positioned this pass anyway.
    const sizes = Layout.measureNodeSizes(names)

    const logical = {}
    for (const n of names) {
      const cell = sortFn(n)
      if (
        !cell ||
        typeof cell.x !== "number" ||
        typeof cell.y !== "number"
      ) {
        throw new Error(
          `sort("${n}") must return { x: number, y: number }`,
        )
      }
      logical[n] = cell
    }

    const columnWidths = {}
    const rowHeights = {}
    for (const n of names) {
      const { x, y } = logical[n]
      const w = sizes[n]?.width ?? 0
      const h = sizes[n]?.height ?? 0
      columnWidths[x] = Math.max(columnWidths[x] ?? 0, w)
      rowHeights[y] = Math.max(rowHeights[y] ?? 0, h)
    }

    const SPACING = 4
    const columnX = {}
    let cx = 0
    for (const key of Object.keys(columnWidths)
      .map(Number)
      .sort((a, b) => a - b)) {
      columnX[key] = cx
      cx += columnWidths[key] + SPACING
    }
    const rowY = {}
    let ry = 0
    for (const key of Object.keys(rowHeights)
      .map(Number)
      .sort((a, b) => a - b)) {
      rowY[key] = ry
      ry += rowHeights[key] + SPACING
    }

    for (const n of names) {
      const { x, y } = logical[n]
      State.positions[n] = { x: columnX[x], y: rowY[y] }
    }

    Persistence.saveLayout()
    Render.render()
  }

  static openSortEditor(src) {
    State.els.sortFnGameLabel.textContent = `(${CustomLayout.gameKeyOf()})`
    State.els.sortFnEditor.value =
      src ??
      db.customSortFns[CustomLayout.gameKeyOf()] ??
      db.customSortFns[State.graph.game] ??
      CustomLayout.DEFAULT_SORT_FN_SRC
    State.els.sortFnError.textContent = ""
    State.els.sortFnError.style.display = "none"
    State.els.sortFnModal.classList.add("visible")
  }
  static closeSortEditor() {
    State.els.sortFnModal.classList.remove("visible")
  }
  static showSortEditorError(err) {
    State.els.sortFnError.textContent = String(
      (err && err.message) || err,
    )
    State.els.sortFnError.style.display = "block"
  }

  static customLayoutClicked() {
    if (!State.graph) return
    const gameKey = CustomLayout.gameKeyOf()
    const src =
      db.customSortFns[gameKey] ?? db.customSortFns[State.graph.game]
    if (!src) {
      // No saved function for this game yet -- open the editor so
      // the user can write one.
      CustomLayout.openSortEditor(CustomLayout.DEFAULT_SORT_FN_SRC)
      return
    }
    try {
      CustomLayout.runCustomLayout(gameKey, src)
    } catch (err) {
      // Saved function broke (e.g. after editing rules JSON) --
      // surface it in the editor instead of failing silently.
      CustomLayout.openSortEditor(src)
      CustomLayout.showSortEditorError(err)
    }
  }
}
document
  .getElementById("customLayoutBtn")
  .addEventListener("click", CustomLayout.customLayoutClicked)
document
  .getElementById("editSortFnBtn")
  .addEventListener("click", () => {
    if (!State.graph) return
    CustomLayout.openSortEditor()
  })
document
  .getElementById("sortFnCancel")
  .addEventListener("click", CustomLayout.closeSortEditor)
document
  .getElementById("sortFnReset")
  .addEventListener("click", () => {
    State.els.sortFnEditor.value = CustomLayout.DEFAULT_SORT_FN_SRC
  })
document
  .getElementById("sortFnSaveRun")
  .addEventListener("click", () => {
    const gameKey = CustomLayout.gameKeyOf()
    const src = State.els.sortFnEditor.value
    try {
      CustomLayout.runCustomLayout(gameKey, src)
      db.customSortFns[State.graph.game] = db.customSortFns[gameKey] =
        src
      CustomLayout.closeSortEditor()
    } catch (err) {
      CustomLayout.showSortEditorError(err)
    }
  })
State.els.sortFnModal.addEventListener("pointerdown", (ev) => {
  if (ev.target === State.els.sortFnModal)
    CustomLayout.closeSortEditor()
})
