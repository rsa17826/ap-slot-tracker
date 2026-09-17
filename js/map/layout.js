class Layout {
  // Simple automatic layout: BFS layers from the start region to place nodes on the canvas.

  static layoutIfNeeded() {
    const names = Object.keys(graph.regions)
    const missing = names.some((n) => !positions[n])
    if (missing) Layout.autoLayout()
  }

  // Location rows actually shown inside a region's node, after
  // hideEvents/hideOOL filtering -- shared by node-size calculations
  // (layout algorithms + canvas Render.draw sizing) and by the canvas Render.draw
  // itself, so they never disagree about how tall a node is.
  static computeNodeRows(region) {
    return (region.locations || []).filter((lname) => {
      const linfo = graph.locations[lname]
      const isEvent = !!(linfo && linfo.is_event)
      if (hideEvents && isEvent) return false
      if (hideOOL && !isEvent && !reach.locations.has(lname))
        return false // out of logic
      if (hideCleared && Reachability.isLocationDone(lname))
        return false // already cleared / auto-granted
      return true
    })
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

  static buildRowData(lname) {
    const linfo = graph.locations[lname]
    const isEvent = !!(linfo && linfo.is_event)
    const scout = scoutedItems[lname]
    let scoutText = null,
      scoutClass = null,
      scoutStar = null
    if (showScouts && scout) {
      scoutClass =
        scout.flags & 1 ? "progression"
        : scout.flags & 4 ? "trap"
        : null
      scoutText =
        scout.itemPlayer !== scoutOwnSlot ?
          `${scout.itemName} (for ${scoutPlayerNames[scout.itemPlayer] ?? `Player ${scout.itemPlayer}`})`
        : scout.itemName
      scoutStar =
        scout.itemPlayer === scoutOwnSlot ? "yellow"
        : scoutTrackedSlots.has(scout.itemPlayer) ? "green"
        : null
    }
    return {
      lname,
      displayText:
        lname.includes(" - ") ?
          lname.split(" - ").slice(1).join(" - ")
        : lname,
      isReach: reach.locations.has(lname),
      isChecked: !!checkedLocations[lname],
      isEvent,
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
  static computeNodeLayout(rname) {
    const region = graph.regions[rname]
    if (!region)
      return {
        reachable: false,
        w: NODE_MIN_WIDTH,
        h: NODE_HEADER_H,
        rows: [],
      }
    const rows = Layout.computeNodeRows(region).map(
      Layout.buildRowData,
    )

    ctx.font = `600 12px ${COLORS.mono}, monospace`
    let w = Math.max(
      NODE_MIN_WIDTH,
      ctx.measureText(rname).width + 27 + 10,
    )
    for (const row of rows) {
      ctx.font =
        (row.isEvent ? "italic " : "") +
        `11px ${COLORS.mono}, monospace`
      row.textWidth = ctx.measureText(row.displayText).width
      row.scoutWidth = 0
      if (row.scoutText) {
        ctx.font = `10px ${COLORS.mono}, monospace`
        row.scoutWidth = ctx.measureText(row.scoutText).width
      }
      let rowW = ROW_LEFT_PAD + row.textWidth + ROW_RIGHT_PAD
      if (row.scoutText) rowW += ROW_SCOUT_GAP + row.scoutWidth
      if (row.scoutStar) rowW += ROW_STAR_W
      w = Math.max(w, rowW)
    }
    w = Math.min(w, NODE_MAX_WIDTH)

    // Second pass: now that the node's final width is locked in, give
    // each row its real allocation. A row only needs fair-sharing once
    // its ideal width doesn't fit -- otherwise both sides just get
    // exactly what they asked for.
    for (const row of rows) {
      const fixed =
        ROW_LEFT_PAD +
        ROW_RIGHT_PAD +
        (row.scoutStar ? ROW_STAR_W : 0) +
        (row.scoutText ? ROW_SCOUT_GAP : 0)
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
      reachable: reach.regions.has(rname),
      w,
      h: NODE_HEADER_H + NODE_BODY_PAD + rows.length * NODE_ROW_H,
      rows,
    }
  }

  // Deterministic size for a region's node, used by layout algorithms
  // (Layout.autoLayout/customLayout) before any canvas Render.draw has happened.
  static computeNodeSize(rname) {
    const layout = Layout.computeNodeLayout(rname)
    return { w: layout.w, h: layout.h }
  }

  static measureNodeSizes(names) {
    const sizes = {}
    for (const n of names) {
      const { w, h } = Layout.computeNodeSize(n)
      sizes[n] = { width: w, height: h }
    }
    return sizes
  }

  static autoLayout() {
    const names = Reachability.visibleRegionNames()
    const visibleSet = new Set(names)
    const start = graph.origin_region_name
    const layers = {}
    const visited = new Set(visibleSet.has(start) ? [start] : [])
    let frontier = [...visited]
    if (frontier.length) layers[start] = 0
    let depth = 0
    while (frontier.length) {
      const next = []
      for (const rname of frontier) {
        for (const exitName of graph.regions[rname].exits || []) {
          const e = graph.entrances[exitName]
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
      list.forEach((n, i) => {
        cellOf[n] = { x: layers[n], y: i }
      })
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
      positions[n] = { x: columnX[x], y: rowY[y] }
    }
    Persistence.saveLayout()
  }
}
