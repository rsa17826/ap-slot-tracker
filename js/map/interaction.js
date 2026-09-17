class Interaction {
  // Node dragging and canvas pan/zoom input handling.

  static screenToWorld(clientX, clientY) {
    const rect = els.canvasWrap.getBoundingClientRect()
    const localX = clientX - rect.left,
      localY = clientY - rect.top
    return {
      x: (localX - view.x) / view.scale,
      y: (localY - view.y) / view.scale,
    }
  }

  // Topmost node whose bounding box contains this world point, or
  // null. Nodes rarely overlap in practice so plain last-match-wins
  // is enough -- this is a handful of comparisons per region, cheap
  // even at 1000+ regions, and only runs on pointerdown/hover, not
  // every frame.
  static findNodeAtWorldPoint(wx, wy) {
    let found = null
    for (const rname in nodeLayouts) {
      if (!Reachability.regionMatchesSearch(rname, searchQuery))
        continue // Render.draw() skips these too -- keep hit-testing in sync
      const pos = positions[rname]
      const layout = nodeLayouts[rname]
      if (!pos) continue
      if (
        wx >= pos.x &&
        wx <= pos.x + layout.w &&
        wy >= pos.y &&
        wy <= pos.y + layout.h
      )
        found = rname
    }
    return found
  }

  // Which location row (if any) sits under this world point, drilling
  // into the topmost node the same way Interaction.findNodeAtWorldPoint does, then
  // mapping the y offset within its body to a row index.
  static findRowAtWorldPoint(wx, wy) {
    const rname = Interaction.findNodeAtWorldPoint(wx, wy)
    if (!rname) return null
    const pos = positions[rname]
    const layout = nodeLayouts[rname]
    if (!pos || !layout) return null
    const bodyTop = pos.y + NODE_HEADER_H + NODE_BODY_PAD / 2
    if (wy < bodyTop) return null
    const idx = Math.floor((wy - bodyTop) / NODE_ROW_H)
    const row = layout.rows[idx]
    return row ? { rname, lname: row.lname } : null
  }

  // Same shape as app.js's RequirementGroups.ownedCounts(rt) (received items plus
  // anything auto-granted by reachable events), built from this map's
  // own inventory/eventInventory globals instead of a live slot's
  // runtime, so the hover popup can reuse app.js's RequirementGroups.ruleToGroups/
  // RequirementGroups.tokenOwned/RequirementGroups.tokenVerifiable exactly as they are.
  static mapOwnedCounts() {
    const out = { ...inventory }
    for (const [name, count] of Object.entries(eventInventory)) {
      out[name] = (out[name] || 0) + count
    }
    return out
  }

  // Same pill look as app.js's RequirementGroups.itemChip, but colored by whether the
  // token is currently owned -- labels in parens ("(no requirements)")
  // and unverifiable tokens (reach:/N of:) fall back to a neutral color
  // since ownership can't be determined for them from counts alone.
  static hoverChip(token, ownedCounts) {
    let cls = "unknown"
    if (
      !token.startsWith("(") &&
      RequirementGroups.tokenVerifiable(token)
    ) {
      cls =
        RequirementGroups.tokenOwned(token, ownedCounts) ? "have" : (
          "missing"
        )
    }
    return newelem("span", { class: `check-hover-chip ${cls}` }, [
      token,
    ])
  }

  static renderCheckHoverPopup(lname) {
    const linfo = graph.locations[lname]
    if (!linfo) return
    const groups = RequirementGroups.ruleToGroups(linfo.rule)
    const counts = Interaction.mapOwnedCounts()
    const body = [
      newelem("div", { class: "check-hover-title" }, [lname]),
    ]
    if (groups.length === 0) {
      body.push(
        newelem("div", { class: "check-hover-group" }, [
          Interaction.hoverChip("(unreachable)", counts),
        ]),
      )
    } else {
      groups.forEach((group, idx) => {
        const groupRow = newelem(
          "div",
          { class: "check-hover-group" },
          [
            newelem("span", { class: "check-hover-label" }, [
              idx === 0 ? "via:" : "or:",
            ]),
          ],
        )
        if (group.length === 0) {
          groupRow.appendChild(
            Interaction.hoverChip("(no requirements)", counts),
          )
        } else {
          group.forEach((tok) =>
            groupRow.appendChild(Interaction.hoverChip(tok, counts)),
          )
        }
        body.push(groupRow)
      })
    }
    els.checkHoverPopup.replaceChildren(...body)
    els.checkHoverPopup.classList.add("visible")
  }

  static hideCheckHoverPopup() {
    els.checkHoverPopup.classList.remove("visible")
  }

  static setupPanZoom() {
    let moveRAF = null
    let panning = false,
      dragging = false,
      draggingRegion = null,
      grabOffset = { x: 0, y: 0 },
      sx = 0,
      sy = 0

    function stopDragging() {
      if (!dragging) return
      dragging = false
      draggingRegion = null
      Persistence.saveLayout()
    }
    function stopPanning() {
      if (!panning) return
      panning = false
      els.canvasWrap.classList.remove("panning")
      if (document.pointerLockElement === els.canvas) {
        document.exitPointerLock()
      }
      Persistence.saveLayout()
    }
    function stopInteraction() {
      stopDragging()
      stopPanning()
      document.body.style.userSelect = ""
    }

    els.canvas.addEventListener("mousedown", (ev) => {
      const world = Interaction.screenToWorld(ev.clientX, ev.clientY)

      if (ev.button === 0 && !dragging) {
        const hit = Interaction.findNodeAtWorldPoint(world.x, world.y)
        if (hit) {
          dragging = true
          draggingRegion = hit
          const pos = positions[hit] || { x: 0, y: 0 }
          grabOffset = { x: pos.x - world.x, y: pos.y - world.y }
        }
      }

      if (ev.button === 2) {
        panning = true
        els.canvasWrap.classList.add("panning")
        // TODO find way to warp pointer when exiting the canvas - this doesn't work because pointer is in wrong location when exiting pan and is bad because can't see pointer when panning
        // if (document.pointerLockElement !== els.canvas) {
        //   els.canvas.requestPointerLock().catch(() => {})
        // }
      }

      sx = ev.clientX
      sy = ev.clientY
      ev.preventDefault()
    })

    els.canvas.addEventListener("contextmenu", (ev) => {
      ev.preventDefault()
    })

    els.canvas.addEventListener("pointermove", (ev) => {
      const isLeftDown = (ev.buttons & 1) !== 0
      const isRightDown = (ev.buttons & 2) !== 0

      if (!isLeftDown && !isRightDown) {
        if (!panning && !dragging) {
          const world = Interaction.screenToWorld(
            ev.clientX,
            ev.clientY,
          )
          const hit =
            graph ?
              Interaction.findRowAtWorldPoint(world.x, world.y)
            : null
          const changed =
            (hit ? hit.lname : null) !==
              (hoveredCheck ? hoveredCheck.lname : null) ||
            (hit ? hit.rname : null) !==
              (hoveredCheck ? hoveredCheck.rname : null)
          if (changed) {
            hoveredCheck = hit
            if (hit) Interaction.renderCheckHoverPopup(hit.lname)
            else Interaction.hideCheckHoverPopup()
          }
        }
        return
      }

      const isLocked = document.pointerLockElement === els.canvas
      const dx = isLocked ? ev.movementX : ev.clientX - sx
      const dy = isLocked ? ev.movementY : ev.clientY - sy

      if (isRightDown || panning) {
        view.x += dx
        view.y += dy
      }

      if (isLeftDown && dragging) {
        const world = Interaction.screenToWorld(
          ev.clientX,
          ev.clientY,
        )
        positions[draggingRegion] = {
          x: world.x + grabOffset.x,
          y: world.y + grabOffset.y,
        }
      }

      sx = ev.clientX
      sy = ev.clientY

      if (moveRAF === null) {
        moveRAF = requestAnimationFrame(() => {
          moveRAF = null
          Render.draw()
        })
      }
    })

    els.canvas.addEventListener("mouseup", (ev) => {
      if (ev.button === 0) {
        dragging = false
        draggingRegion = null
      }
      if (ev.button === 2) {
        panning = false
        els.canvasWrap.classList.remove("panning")
        if (document.pointerLockElement) {
          document.exitPointerLock()
        }
      }
    })

    els.canvas.addEventListener("pointercancel", () => {
      dragging = false
      draggingRegion = null
      panning = false
      els.canvasWrap.classList.remove("panning")
      document.body.style.userSelect = ""
    })
    els.canvas.addEventListener("pointerleave", () => {
      hoveredCheck = null
      Interaction.hideCheckHoverPopup()
    })
    els.canvas.addEventListener("lostpointercapture", stopInteraction)
    window.addEventListener("mouseup", (ev) => {
      const isLeftDown = (ev.buttons & 1) !== 0
      const isRightDown = (ev.buttons & 2) !== 0

      if (!isLeftDown) {
        dragging = false
        draggingRegion = null
      }

      if (!isRightDown) {
        panning = false
        els.canvasWrap.classList.remove("panning")
      }

      if (!isLeftDown && !isRightDown) {
        document.body.style.userSelect = ""
      }
      if (ev.button === 0) stopDragging()
      if (ev.button === 2) stopPanning()
      if (ev.buttons === 0) document.body.style.userSelect = ""
    })
    window.addEventListener("blur", stopInteraction)
    els.canvas.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault()
        const delta = -ev.deltaY * 0.001
        Interaction.zoomAt(ev.clientX, ev.clientY, delta)
      },
      { passive: false },
    )
    window.addEventListener("resize", () => {
      Render.resizeCanvas()
      Render.scheduleDraw()
    })

    document
      .getElementById("closeMapBtn")
      .addEventListener("click", () => SlotSync.setMapVisible(false))
    document
      .getElementById("zoomIn")
      .addEventListener("click", () =>
        Interaction.zoomAt(
          window.innerWidth / 2,
          window.innerHeight / 2,
          0.15,
        ),
      )
    document
      .getElementById("zoomOut")
      .addEventListener("click", () =>
        Interaction.zoomAt(
          window.innerWidth / 2,
          window.innerHeight / 2,
          -0.15,
        ),
      )
    document
      .getElementById("zoomReset")
      .addEventListener("click", () => {
        view = { x: 40, y: 40, scale: 1 }
        Interaction.applyView()
        Persistence.saveLayout()
      })
  }
  static zoomAt(clientX, clientY, delta) {
    const rect = els.canvasWrap.getBoundingClientRect()
    const localX = clientX - rect.left,
      localY = clientY - rect.top
    const worldX = (localX - view.x) / view.scale
    const worldY = (localY - view.y) / view.scale
    view.scale = Math.min(2.2, Math.max(0.05, view.scale + delta))
    view.x = localX - worldX * view.scale
    view.y = localY - worldY * view.scale
    Interaction.applyView()
    Persistence.saveLayout()
  }

  static applyView() {
    Render.scheduleDraw()
  }
}
