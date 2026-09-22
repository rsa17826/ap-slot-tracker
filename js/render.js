class Render {
  // Canvas rendering: draws nodes/edges/inventory list for the current graph, reach state, and view transform.

  static buildItemList(itemNames) {
    State.els.itemList.replaceChildren(
      ...itemNames.map((name) => {
        const maxCount = State.itemMaxCounts[name] ?? 1
        const isEvent = State.eventItemNames.has(name)
        return newelem(
          "div",
          {
            class: "item-row" + (isEvent ? " event-item" : ""),
            dataset: { name },
            title:
              isEvent ?
                "Event item — auto-collected once reachable"
              : "",
          },
          [
            newelem("span", { class: "name" }, [name]),
            newelem("span", { class: "count" }, [0]),
            newelem("span", { class: "sep" }, ["/"]),
            newelem("span", { class: "count-max" }, [maxCount]),
          ],
        )
      }),
    )
    Render.syncItemListUI()
    Reachability.applySearchFilter()
  }

  static syncItemListUI() {
    State.els.itemList
      .querySelectorAll(".item-row")
      .forEach((rowEl) => {
        const row = /** @type {HTMLElement} */ (rowEl)
        const name = row.dataset.name
        const isEvent = State.eventItemNames.has(name)
        const v =
          isEvent ?
            Math.max(
              State.inventory[name] || 0,
              State.eventInventory[name] || 0,
            )
          : State.inventory[name] || 0
        const maxCount = State.itemMaxCounts[name] ?? 1
        const countEl = row.querySelector(".count")
        if (countEl) countEl.textContent = String(v)
        row.classList.toggle("collected", v > 0)
        row.classList.toggle("maxed", maxCount > 1 && v >= maxCount)
      })
  }

  static onInventoryChange() {
    Render.render()
  }

  static render() {
    if (!State.graph) return
    Reachability.computeReachability()
    Render.syncItemListUI()
    Render.renderNodes()
    Render.renderEdges()
    Reachability.applySearchFilter() // also schedules a redraw
    // Keep the requirements popup's ownership colors in sync when
    // inventory changes without the pointer moving (e.g. clicking an
    // item checkbox while still hovering a check).
    if (State.hoveredCheck) {
      if (State.graph.locations[State.hoveredCheck.lname]) {
        Interaction.renderCheckHoverPopup(State.hoveredCheck.lname)
      } else {
        State.hoveredCheck = null
        Interaction.hideCheckHoverPopup()
      }
    }
  }

  // ------------------------------------------------------------
  // CANVAS RENDERING
  //
  // Region nodes used to be one real DOM element per region (plus one
  // per visible location row inside it). At 1000+ regions that means
  // thousands of styled boxes with box-shadow/gradients that the
  // browser has to lay out, paint, and re-rasterize as soon as a pan
  // exposes new screen area -- that per-pixel paint cost, not any of
  // our own JS, was the actual source of the lag, and no amount of
  // throttling JS writes fixes it.
  //
  // Instead, nodes/edges are now drawn directly onto a single
  // <canvas> every frame. Off-screen content is simply never drawn
  // (a couple of comparisons per region to check), so cost scales
  // with how much is actually on screen, not with the total graph
  // size -- this is the same approach tools like Figma/Obsidian's
  // graph view use for large canvases.
  //
  // Render.renderNodes()/Render.renderEdges() still run only when the underlying
  // data changes (same call sites as before); they build plain data
  // (nodeLayouts/edgeList), not DOM. Render.draw() is the only thing that
  // runs every frame, and it's cheap: iterate + cull + drawing calls.
  // ------------------------------------------------------------
  static ctx = State.els.canvas.getContext("2d")
  static drawScheduled = false

  static scheduleDraw() {
    if (Render.drawScheduled) return
    Render.drawScheduled = true
    requestAnimationFrame(() => {
      Render.drawScheduled = false
      Render.draw()
    })
  }

  static resizeCanvas() {
    const rect = State.els.canvasWrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (
      State.els.canvas.width !== w ||
      State.els.canvas.height !== h
    ) {
      State.els.canvas.width = w
      State.els.canvas.height = h
    }
    State.els.canvas.style.width = rect.width + "px"
    State.els.canvas.style.height = rect.height + "px"
    return { rect, dpr }
  }

  // Colors read once from the CSS custom properties in colors.css so
  // the canvas stays in sync with the theme without hardcoding hex
  // values here.
  static COLORS = {}
  static loadColors() {
    const s = getComputedStyle(document.documentElement)
    const get = (name) => {
      var r = (s.getPropertyValue(name) || "").trim()
      if (r) return r
      throw new Error(name)
    }
    Render.COLORS.nodeBg = get("--node-bg")
    Render.COLORS.borderDim = get("--danger-dim")
    Render.COLORS.accent = get("--accent")
    Render.COLORS.text = get("--text")
    Render.COLORS.textDim = get("--text-dim")
    Render.COLORS.event = get("--event")
    Render.COLORS.panelBorder = get("--panel-border")
    Render.COLORS.danger = get("--danger")
  }

  static roundRectPath(x, y, w, h, r) {
    Render.ctx.beginPath()
    if (Render.ctx.roundRect) {
      Render.ctx.roundRect(x, y, w, h, r)
      return
    }
    Render.ctx.moveTo(x + r, y)
    Render.ctx.arcTo(x + w, y, x + w, y + h, r)
    Render.ctx.arcTo(x + w, y + h, x, y + h, r)
    Render.ctx.arcTo(x, y + h, x, y, r)
    Render.ctx.arcTo(x, y, x + w, y, r)
    Render.ctx.closePath()
  }

  // Draws text truncated with an ellipsis to fit maxWidth, optionally
  // with a strikethrough (for checked locations) or right-aligned
  // (for the scouted-item label). Returns nothing -- draws directly.
  /**
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {number} maxWidth
   * @param {{ strike?: boolean, align?: CanvasTextAlign }} [opts]
   */
  static drawFitText(
    text,
    x,
    y,
    maxWidth,
    { strike = false, align = "left" } = {},
  ) {
    let t = text
    if (Render.ctx.measureText(t).width > maxWidth) {
      while (
        t.length > 1 &&
        Render.ctx.measureText(t + "\u2026").width > maxWidth
      )
        t = t.slice(0, -1)
      t = t.length > 1 ? t + "\u2026" : t
    }
    const prevAlign = Render.ctx.textAlign
    Render.ctx.textAlign = align
    Render.ctx.fillText(t, x, y)
    if (strike) {
      const w = Render.ctx.measureText(t).width
      const startX = align === "right" ? x - w : x
      Render.ctx.save()
      Render.ctx.strokeStyle = Render.ctx.fillStyle
      Render.ctx.lineWidth = 1
      Render.ctx.beginPath()
      Render.ctx.moveTo(startX, y)
      Render.ctx.lineTo(startX + w, y)
      Render.ctx.stroke()
      Render.ctx.restore()
    }
    Render.ctx.textAlign = prevAlign
  }

  static renderNodes() {
    State.nodeLayouts = {}
    for (const rname of Object.keys(State.graph.regions)) {
      if (!Reachability.isRegionVisible(rname)) continue
      State.nodeLayouts[rname] = Layout.computeNodeLayout(rname)
    }
    Render.scheduleDraw()
  }

  // When noTransit is on, walks forward from `target` through any
  // chain of transit regions (regions with no locations) following
  // their exits, until it reaches non-transit regions -- those are
  // the effective endpoints an edge should be drawn to. A chain edge
  // is only "traversable" if every hop along the way is. Cycle-safe
  // via `visited`.
  // Walks forward through chains of transit rooms to find the real,
  // non-transit endpoints an edge should connect to. Iterative (not
  // recursive) so long chains don't blow the call stack, and it
  // memoizes which transit regions it has already expanded so that
  // graphs with diamond-shaped transit connections (multiple paths
  // reconverging on the same room) don't get re-expanded down every
  // branch -- that combinatorial blowup was producing a huge/inf
  // "out" array. A transit region is only ever expanded once per
  // traversability tier (traversable first, since that's strictly
  // the best case -- traversable can only AND its way down to false
  // further along a chain, never back up to true).
  static resolveEdgeTargets(startTarget, startTraversable, visited) {
    const results = new Map() // to -> traversable

    function expand(seedTarget, wantTraversable, seedVisited) {
      const seen = new Set(seedVisited)
      let stack = [seedTarget]
      while (stack.length) {
        const target = stack.pop()
        if (seen.has(target)) continue
        if (db.noTransit && Reachability.isTransitRegion(target)) {
          seen.add(target)
          const tregion = State.graph.regions[target]
          for (const nextExit of tregion.exits || []) {
            const ninfo = State.graph.entrances[nextExit]
            if (!ninfo || !ninfo.connects_to) continue
            if (
              wantTraversable &&
              !State.reach.entrances.has(nextExit)
            )
              continue // this branch stays non-traversable; leave it for the second pass
            stack.push(ninfo.connects_to)
          }
        } else if (!results.has(target)) {
          results.set(target, wantTraversable)
        }
      }
    }

    // Pass 1: best case -- only follow hops that are traversable, so
    // any endpoint reachable this way is marked traversable (solid
    // line).
    if (startTraversable) expand(startTarget, true, visited)
    // Pass 2: full topology regardless of traversability, so every
    // structurally-connected endpoint still gets an (at worst dashed)
    // edge even if pass 1 already found some of them.
    expand(startTarget, false, visited)

    return [...results].map(([to, traversable]) => ({
      to,
      traversable,
    }))
  }

  static renderEdges() {
    State.edgeList = []
    for (const [rname, region] of Object.entries(
      State.graph.regions,
    )) {
      if (!State.nodeLayouts[rname]) continue // skip hidden (focus-mode/transit) source nodes
      for (const exitName of region.exits || []) {
        const einfo = State.graph.entrances[exitName]
        if (!einfo || !einfo.connects_to) continue
        const targets = Render.resolveEdgeTargets(
          einfo.connects_to,
          State.reach.entrances.has(exitName),
          new Set([rname]),
        )
        for (const { to, traversable } of targets) {
          if (!State.positions[rname] || !State.positions[to])
            continue
          if (!State.nodeLayouts[rname] || !State.nodeLayouts[to])
            continue // skip edges touching a hidden (focus-mode) node
          State.edgeList.push({ from: rname, to, traversable })
        }
      }
    }
    Render.scheduleDraw()
  }

  static findRegionForEntrance(ename) {
    for (const [rname, region] of Object.entries(
      State.graph.regions,
    )) {
      if ((region.exits || []).includes(ename)) return rname
    }
    return null
  }

  // Right-edge, roughly-vertical-center anchor point for an edge
  // endpoint. Uses the real node size when it's currently laid out
  // (nodeLayouts), else falls back to the same deterministic formula
  // -- there's no DOM element to measure any more either way.
  static centerOf(rname) {
    const pos = State.positions[rname] || { x: 0, y: 0 }
    const layout = State.nodeLayouts[rname]
    const size =
      layout ?
        { w: layout.w, h: layout.h }
      : Layout.computeNodeSize(rname)
    return { x: pos.x + size.w, y: pos.y + size.h / 2 }
  }

  static escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    )
  }
  static cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&")
  }

  static rectsIntersect(ax0, ay0, ax1, ay1, bx0, by0, bx1, by1) {
    return ax0 <= bx1 && ax1 >= bx0 && ay0 <= by1 && ay1 >= by0
  }

  // World-space rect currently on screen, expanded by a small margin
  // so nodes/edges just outside the edge of the viewport are drawn
  // too (avoids a visible pop-in strip while panning).
  static visibleWorldRect(marginPx = 150) {
    const rect = State.els.canvasWrap.getBoundingClientRect()
    return {
      x0: (-State.view.x - marginPx) / State.view.scale,
      y0: (-State.view.y - marginPx) / State.view.scale,
      x1: (-State.view.x + rect.width + marginPx) / State.view.scale,
      y1: (-State.view.y + rect.height + marginPx) / State.view.scale,
    }
  }

  static drawEdge(p1, p2, traversable) {
    const dx = (p2.x - p1.x) * 0.5
    Render.ctx.beginPath()
    Render.ctx.moveTo(p1.x, p1.y)
    Render.ctx.bezierCurveTo(
      p1.x + dx,
      p1.y,
      p2.x - dx,
      p2.y,
      p2.x,
      p2.y,
    )
    Render.ctx.strokeStyle =
      traversable ? Render.COLORS.accent : "#2a3040"
    Render.ctx.lineWidth = traversable ? 2 : 1.4
    Render.ctx.globalAlpha = traversable ? 0.9 : 0.45
    Render.ctx.setLineDash(traversable ? [] : [4, 4])
    Render.ctx.stroke()
    Render.ctx.setLineDash([])
    Render.ctx.globalAlpha = 1
  }

  static drawNode(rname, pos, layout) {
    const { x, y } = pos
    const w = layout.w,
      h = layout.h

    Render.roundRectPath(x, y, w, h, 10)
    Render.ctx.fillStyle = Render.COLORS.nodeBg
    Render.ctx.fill()
    Render.ctx.lineWidth = 1.5
    Render.ctx.strokeStyle =
      layout.reachable ?
        Render.COLORS.accent
      : Render.COLORS.borderDim
    Render.ctx.stroke()

    if (layout.reachable) {
      Render.ctx.save()
      Render.roundRectPath(x, y, w, h, 10)
      Render.ctx.clip()
      Render.ctx.fillStyle = "rgba(94, 230, 180, 0.10)"
      Render.ctx.fillRect(x, y, w, Layout.NODE_HEADER_H)
      Render.ctx.restore()
    }

    Render.ctx.beginPath()
    Render.ctx.moveTo(x, y + Layout.NODE_HEADER_H)
    Render.ctx.lineTo(x + w, y + Layout.NODE_HEADER_H)
    Render.ctx.strokeStyle = Render.COLORS.panelBorder
    Render.ctx.lineWidth = 1
    Render.ctx.stroke()

    const headMidY = y + Layout.NODE_HEADER_H / 2
    Render.ctx.beginPath()
    Render.ctx.arc(x + 15, headMidY, 3.5, 0, Math.PI * 2)
    Render.ctx.fillStyle =
      layout.reachable ? Render.COLORS.accent : Render.COLORS.danger
    Render.ctx.fill()

    Render.ctx.textBaseline = "middle"
    Render.ctx.font = `600 12px ${Render.COLORS.mono}, monospace`
    Render.ctx.fillStyle = Render.COLORS.text
    Render.drawFitText(rname, x + 27, headMidY, w - 37)

    let rowY = y + Layout.NODE_HEADER_H + Layout.NODE_BODY_PAD / 2
    for (const row of layout.rows) {
      const cy = rowY + Layout.NODE_ROW_H / 2

      let dotColor = Render.COLORS.textDim
      if (row.isReach) dotColor = Render.COLORS.accent
      else dotColor = Render.COLORS.danger
      if (row.isEvent) dotColor = Render.COLORS.event
      Render.ctx.beginPath()
      Render.ctx.arc(x + 13, cy, 2.5, 0, Math.PI * 2)
      Render.ctx.fillStyle = dotColor
      Render.ctx.fill()

      let textColor = Render.COLORS.textDim
      if (row.isReach) textColor = Render.COLORS.text
      if (row.isEvent) textColor = Render.COLORS.event
      Render.ctx.font =
        (row.isEvent ? "italic " : "") +
        `11px ${Render.COLORS.mono}, monospace`
      Render.ctx.fillStyle = textColor
      Render.ctx.globalAlpha = row.isChecked ? 0.4 : 1
      Render.drawFitText(row.displayText, x + 21, cy, row.textAlloc, {
        strike: row.isChecked,
      })
      Render.ctx.globalAlpha = 1

      if (row.scoutStar) {
        Render.ctx.font = "11px sans-serif"
        Render.ctx.fillStyle =
          row.scoutStar === "yellow" ? "#f5d33c" : "#4ade80"
        Render.ctx.textAlign = "right"
        Render.ctx.fillText("★", x + w - Layout.ROW_RIGHT_PAD, cy)
        Render.ctx.textAlign = "left"
      }

      if (row.scoutText) {
        Render.ctx.font = `10px ${Render.COLORS.mono}, monospace`
        Render.ctx.fillStyle =
          row.scoutClass === "progression" ? Render.COLORS.accent
          : row.scoutClass === "trap" ? Render.COLORS.danger
          : Render.COLORS.textDim
        Render.drawFitText(
          row.scoutText,
          x +
            w -
            Layout.ROW_RIGHT_PAD -
            (row.scoutStar ? Layout.ROW_STAR_W : 0),
          cy,
          row.scoutAlloc,
          {
            align: "right",
            strike: row.isChecked,
          },
        )
      }

      rowY += Layout.NODE_ROW_H
    }
  }

  static draw() {
    const { rect, dpr } = Render.resizeCanvas()
    Render.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    Render.ctx.clearRect(0, 0, rect.width, rect.height)
    if (!State.graph) return

    Render.ctx.save()
    Render.ctx.translate(State.view.x, State.view.y)
    Render.ctx.scale(State.view.scale, State.view.scale)

    const vp = Render.visibleWorldRect()
    for (const { from, to, traversable } of State.edgeList) {
      if (
        !Reachability.regionMatchesSearch(from, State.searchQuery) ||
        !Reachability.regionMatchesSearch(to, State.searchQuery)
      )
        continue
      const p1 = Render.centerOf(from),
        p2 = Render.centerOf(to)
      if (
        !Render.rectsIntersect(
          Math.min(p1.x, p2.x),
          Math.min(p1.y, p2.y),
          Math.max(p1.x, p2.x),
          Math.max(p1.y, p2.y),
          vp.x0,
          vp.y0,
          vp.x1,
          vp.y1,
        )
      )
        continue
      Render.drawEdge(p1, p2, traversable)
    }

    for (const rname in State.nodeLayouts) {
      if (!Reachability.regionMatchesSearch(rname, State.searchQuery))
        continue
      const pos = State.positions[rname]
      const layout = State.nodeLayouts[rname]
      if (!pos) continue
      if (
        !Render.rectsIntersect(
          pos.x,
          pos.y,
          pos.x + layout.w,
          pos.y + layout.h,
          vp.x0,
          vp.y0,
          vp.x1,
          vp.y1,
        )
      )
        continue
      Render.drawNode(rname, pos, layout)
    }

    Render.ctx.restore()
  }
}
