;(() => {
  const spacing = 0
  const sizes = {}

  document.querySelectorAll(".node").forEach((e) => {
    const name = e.querySelector(".node-head")?.textContent?.trim()

    if (!name) return

    const rect = e.getBoundingClientRect()

    sizes[name] = {
      width: rect.width / mapdb.view.scale,
      height: rect.height / mapdb.view.scale,
    }
  })

  function sort(name) {
    if (name.startsWith("stage"))
      return {
        x: Number(name.replace("stage", "")) % 5,
        y: 1 + ((Number(name.replace("stage", "")) / 5) | 0),
      }

    return { x: 0, y: 0 }
  }

  const layout = mapdb.layout[mapdb.state.gameKey]
  const positions = {}

  // Logical positions
  for (const name in layout) {
    positions[name] = sort(name)
  }

  /*
   * Find the size of every logical column.
   *
   * Example:
   *
   * x=0 -> widest node is 100px
   * x=1 -> widest node is 150px
   * x=2 -> widest node is 80px
   *
   * Result:
   * x=0 -> 0
   * x=1 -> 104
   * x=2 -> 258
   */
  const columnWidths = {}

  for (const name in positions) {
    const { x } = positions[name]
    const width = sizes[name]?.width ?? 0

    columnWidths[x] = Math.max(columnWidths[x] ?? 0, width)
  }

  /*
   * Same thing for rows, but using height.
   */
  const rowHeights = {}

  for (const name in positions) {
    const { y } = positions[name]
    const height = sizes[name]?.height ?? 0

    rowHeights[y] = Math.max(rowHeights[y] ?? 0, height)
  }

  // Convert logical X → pixel X
  const columnX = {}
  let x = 0

  for (const key of Object.keys(columnWidths).sort((a, b) => a - b)) {
    columnX[key] = x
    x += columnWidths[key] + spacing
  }

  // Convert logical Y → pixel Y
  const rowY = {}
  let y = 0

  for (const key of Object.keys(rowHeights).sort((a, b) => a - b)) {
    rowY[key] = y
    y += rowHeights[key] + spacing
  }

  // Apply transformed positions
  for (const name in positions) {
    const { x, y } = positions[name]

    layout[name] = {
      x: columnX[x],
      y: rowY[y],
    }
  }

  tryLoadFile(mapdb.state.gameKey)
})()
