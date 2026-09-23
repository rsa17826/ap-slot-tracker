/**
 * @typedef {Object} Row
 * @property {string} lname
 * @property {string} displayText
 * @property {boolean} isReach
 * @property {boolean} isChecked
 * @property {boolean} isEvent
 * @property {boolean} isLocationHinted
 * @property {boolean} isItemHinted
 * @property {null|string} scoutText
 * @property {null|string} scoutClass
 * @property {null|string} scoutStar
 * @property {number} textWidth
 * @property {number} scoutWidth
 * @property {number} textAlloc
 * @property {number} scoutAlloc
 */

class Layout {
  // Simple automatic layout: BFS layers from the start region to place nodes on the canvas.

  static layoutIfNeeded() {
    const names = Object.keys(State.graph.regions)
    const missing = names.some((n) => !State.positions[n])
    if (missing) Layout.autoLayout()
  }

  // Location rows actually shown inside a region's node, after
  // hideEvents/hideOOL filtering -- shared by node-size calculations
  // (layout algorithms + canvas Render.draw sizing) and by the canvas Render.draw
  // itself, so they never disagree about how tall a node is.
  static computeNodeRows(region) {
    return (region.locations || []).filter(
      (/** @type {string | number} */ lname) => {
        const linfo = State.graph.locations[lname]
        const isEvent = !!(linfo && linfo.is_event)
        if (db.hideEvents && isEvent) return false
        if (
          db.hideOOL &&
          !isEvent &&
          !State.reach.locations.has(lname)
        )
          return false // out of logic
        if (db.hideCleared && Reachability.isLocationDone(lname))
          return false
        return true
      },
    )
  }

  static NODE_MIN_WIDTH = 190
  static NODE_MAX_WIDTH = 520
  static NODE_HEADER_H = 33
  static NODE_BODY_PAD = 12
  static NODE_ROW_H = 20
  static ROW_LEFT_PAD = 21 // dot + gap before the location text
  static ROW_RIGHT_PAD = 8
  static ROW_SCOUT_GAP = 14 // gap between location text and scout label
  static ROW_STAR_W = 12 // width reserved for the scout star icon + its gap

  /**
   * @param {string} lname
   */
  static buildRowData(lname) {
    const linfo = State.graph.locations[lname]
    const isEvent = !!(linfo && linfo.is_event)
    const scout = State.scoutedItems[lname]
    let scoutText = null,
      scoutClass = null,
      scoutStar = null
    if (db.showScouts && scout) {
      scoutClass =
        scout.flags & 1 ? "progression"
        : scout.flags & 4 ? "trap"
        : null
      scoutText =
        scout.itemPlayer !== State.scoutOwnSlot ?
          `${scout.itemName} (for ${State.scoutPlayerNames[scout.itemPlayer] ?? `Player ${scout.itemPlayer}`})`
        : scout.itemName
      scoutStar =
        scout.itemPlayer === State.scoutOwnSlot ? "yellow"
        : State.scoutTrackedSlots.has(scout.itemPlayer) ? "green"
        : null
    }

    const hints = State.hints
    const locHints = hints.filter(
      (h) =>
        h &&
        (h.locationName === lname ||
          String(h.location) === String(lname)),
    )
    const isLocationHinted = locHints.length > 0
    const isLocationHintFound =
      isLocationHinted && locHints.every((h) => h.found)

    // Check item hints (if scouted)
    let isItemHinted = false
    let isItemHintFound = false
    if (scout) {
      const itemHints = hints.filter(
        (h) =>
          h &&
          (h.itemName === scout.itemName ||
            String(h.item) === String(scout.itemName)),
      )
      isItemHinted = itemHints.length > 0
      isItemHintFound =
        isItemHinted && itemHints.every((h) => h.found)
    }

    const isHintFound =
      (isLocationHinted && isLocationHintFound) ||
      (isItemHinted && isItemHintFound)
    const isReach = State.reach.locations.has(lname)

    let isChecked =
      !!State.checkedLocations[lname] || (isEvent && isReach)
    return {
      lname,
      displayText:
        lname.includes(" - ") ?
          lname.split(" - ").slice(1).join(" - ")
        : lname,
      isReach,
      isChecked,
      isEvent,
      isLocationHinted,
      isItemHinted,
      isHintFound, // Pass found state to layout
      scoutText,
      scoutClass,
      scoutStar,
    }
  }

  // Given a row's actual available budget (after paddings/star/gap are
  // already subtracted) and how much room the location text and the
  // scout label would each like, split the budget "water-filling"
  // style: each side gets up to half, but if one side needs less than
  // its half, the unused remainder rolls over to the other side (up to
  // what it actually needs). Only once BOTH sides still want more than
  // their half does the split become a flat 50/50, and only then does
  // either side actually get trimmed.
  /**
   * @param {number} budget
   * @param {number} need1
   * @param {number} need2
   */
  static splitRowBudget(budget, need1, need2) {
    const half = budget / 2
    if (need1 <= half) return [need1, Math.min(need2, budget - need1)]
    if (need2 <= half) return [Math.min(need1, budget - need2), need2]
    return [half, half]
  }

  // Builds the full layout (size + row data) for a region's node.
  // Width is derived from actual content -- the header title and the
  // widest row (location text, plus its scout label if shown) --
  // rather than a fixed box, so a node with short labels and no
  // scout text shrinks instead of leaving blank space, and a node
  // that needs more room for a scout label gets it (up to
  // NODE_MAX_WIDTH). Once a node hits that cap, each row's location
  // text and scout label fair-share the remaining space instead of
  // the location text hogging it (see Layout.splitRowBudget).
  /**
   * @param {string} rname
   * @returns {NodeLayout}
   */
  static computeNodeLayout(rname) {
    const region = State.graph.regions[rname]
    if (!region)
      return {
        reachable: false,
        w: Layout.NODE_MIN_WIDTH,
        h: Layout.NODE_HEADER_H,
        rows: [],
      }
    const rows = Layout.computeNodeRows(region).map(
      Layout.buildRowData,
    )

    Render.ctx.font = `600 12px ${Render.COLORS.mono}, monospace`
    let w = Math.max(
      Layout.NODE_MIN_WIDTH,
      Render.ctx.measureText(rname).width + 27 + 10,
    )
    for (const row of rows) {
      Render.ctx.font =
        (row.isEvent ? "italic " : "") +
        `11px ${Render.COLORS.mono}, monospace`
      row.textWidth = Render.ctx.measureText(row.displayText).width
      row.scoutWidth = 0
      if (row.scoutText) {
        Render.ctx.font = `10px ${Render.COLORS.mono}, monospace`
        row.scoutWidth = Render.ctx.measureText(row.scoutText).width
      }
      let rowW =
        Layout.ROW_LEFT_PAD + row.textWidth + Layout.ROW_RIGHT_PAD
      if (row.scoutText) rowW += Layout.ROW_SCOUT_GAP + row.scoutWidth
      if (row.scoutStar) rowW += Layout.ROW_STAR_W
      if (row.isLocationHinted) rowW += 14
      if (row.isItemHinted) rowW += 14
      w = Math.max(w, rowW)
    }
    w = Math.min(w, Layout.NODE_MAX_WIDTH)

    for (const row of rows) {
      Render.ctx.font =
        (row.isEvent ? "italic " : "") +
        `11px ${Render.COLORS.mono}, monospace`
      row.textWidth = Render.ctx.measureText(row.displayText).width
      row.scoutWidth = 0
      if (row.scoutText) {
        Render.ctx.font = `10px ${Render.COLORS.mono}, monospace`
        row.scoutWidth = Render.ctx.measureText(row.scoutText).width
      }
      let rowW =
        Layout.ROW_LEFT_PAD + row.textWidth + Layout.ROW_RIGHT_PAD
      if (row.scoutText) rowW += Layout.ROW_SCOUT_GAP + row.scoutWidth
      if (row.scoutStar) rowW += Layout.ROW_STAR_W
      if (row.isLocationHinted || row.isItemHinted) rowW += 14
      w = Math.max(w, rowW)
    }
    w = Math.min(w, Layout.NODE_MAX_WIDTH)

    for (const row of rows) {
      const fixed =
        Layout.ROW_LEFT_PAD +
        Layout.ROW_RIGHT_PAD +
        (row.scoutStar ? Layout.ROW_STAR_W : 0) +
        (row.isLocationHinted || row.isItemHinted ? 14 : 0) +
        (row.scoutText ? Layout.ROW_SCOUT_GAP : 0)
      const budget = w - fixed
      if (row.scoutText) {
        const [textAlloc, scoutAlloc] = Layout.splitRowBudget(
          budget,
          row.textWidth,
          row.scoutWidth,
        )
        row.textAlloc = textAlloc
        row.scoutAlloc = scoutAlloc
      } else {
        row.textAlloc = Math.min(row.textWidth, budget)
        row.scoutAlloc = 0
      }
    }

    return {
      reachable: State.reach.regions.has(rname),
      w,
      h:
        Layout.NODE_HEADER_H +
        Layout.NODE_BODY_PAD +
        rows.length * Layout.NODE_ROW_H,
      rows,
    }
  }

  // Deterministic size for a region's node, used by layout algorithms
  // (Layout.autoLayout/customLayout) before any canvas Render.draw has happened.
  /**
   * @param {string} rname
   */
  static computeNodeSize(rname) {
    const layout = Layout.computeNodeLayout(rname)
    return { w: layout.w, h: layout.h }
  }

  /**
   * @param {string[]} names
   */
  static measureNodeSizes(names) {
    const sizes = {}
    for (const n of names) {
      const { w, h } = Layout.computeNodeSize(n)
      sizes[n] = { width: w, height: h }
    }
    return sizes
  }

  static autoLayout() {
    const names = Object.keys(State.graph.regions)
    const visibleSet = new Set(names)
    const start = State.graph.origin_region_name
    const layers = {}
    const visited = new Set(visibleSet.has(start) ? [start] : [])
    let frontier = [...visited]
    if (frontier.length) layers[start] = 0
    let depth = 0
    while (frontier.length) {
      const next = []
      for (const rname of frontier) {
        for (const exitName of State.graph.regions[rname].exits ||
          []) {
          const e = State.graph.entrances[exitName]
          const target = e && e.connects_to
          if (
            target &&
            visibleSet.has(target) &&
            !visited.has(target)
          ) {
            visited.add(target)
            layers[target] = depth + 1
            next.push(target)
          }
        }
      }
      frontier = next
      depth++
    }
    let orphanDepth = depth + 1
    for (const n of names) if (!(n in layers)) layers[n] = orphanDepth

    const byLayer = {}
    for (const n of names) {
      ;(byLayer[layers[n]] = byLayer[layers[n]] || []).push(n)
    }

    // Each node gets a logical (column, row) cell -- column is its BFS
    // layer, row is its order within that layer -- then columns/rows
    // are packed by the actual measured size of the nodes in them
    // (same technique as the custom layout) so nodes never overlap,
    // however long their name or however many locations they list.
    const cellOf = {}
    for (const list of Object.values(byLayer)) {
      list.forEach(
        (/** @type {string | number} */ n, /** @type {any} */ i) => {
          cellOf[n] = { x: layers[n], y: i }
        },
      )
    }

    const sizes = Layout.measureNodeSizes(names)
    const columnWidths = {}
    const rowHeights = {}
    for (const n of names) {
      const { x, y } = cellOf[n]
      columnWidths[x] = Math.max(columnWidths[x] ?? 0, sizes[n].width)
      rowHeights[y] = Math.max(rowHeights[y] ?? 0, sizes[n].height)
    }

    const COLUMN_GAP = 90,
      ROW_GAP = 40
    const columnX = {}
    let cx = 40
    for (const key of Object.keys(columnWidths)
      .map(Number)
      .sort((a, b) => a - b)) {
      columnX[key] = cx
      cx += columnWidths[key] + COLUMN_GAP
    }
    const rowY = {}
    let ry = 40
    for (const key of Object.keys(rowHeights)
      .map(Number)
      .sort((a, b) => a - b)) {
      rowY[key] = ry
      ry += rowHeights[key] + ROW_GAP
    }

    for (const n of names) {
      const { x, y } = cellOf[n]
      State.positions[n] = { x: columnX[x], y: rowY[y] }
    }
    Persistence.saveLayout()
  }
}
