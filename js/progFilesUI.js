class ProgFilesUI {
  // Renders the loaded rules-JSON files list (regions/locations counts, update/remove) and keeps the add-slot game picker in sync with it.
  // Files are grouped by game name, each group's versions laid out as a
  // horizontally-flowing (wrapping) row of chips rather than one-per-line.

  // Deletes the actual file from disk via its FileSystemFileHandle
  // (requesting readwrite permission first), then drops it from
  // db.fileHandles/db.progFiles. There's no sensible fallback if the
  // handle is missing -- that means this progKey was never loaded from a
  // real file on disk, so surface that instead of silently only removing
  // it from the in-memory list.
  static async removeProgFile(progKey) {
    const handle = window.db.fileHandles[progKey]
    if (!handle) {
      alert(
        `No file handle for "${progKey}" -- can't delete it from disk. Not removing it from the list either.`,
      )
      return
    }
    const perm = await handle.requestPermission({ mode: "readwrite" })
    if (perm !== "granted") {
      alert(
        `Permission denied -- can't delete "${progKey}" from disk.`,
      )
      return
    }
    try {
      await handle.remove()
    } catch (error) {
      if (error.name === "NotFoundError") {
        warn("file not found")
      } else {
        throw error
      }
    }
    delete window.db.fileHandles[progKey]
    delete window.db.progFiles[progKey]
    ProgFilesUI.renderProgFiles()
    SlotsUI.renderSlots()
  }

  static renderProgItem(progKey) {
    const g = window.db.progFiles[progKey]
    const regionCount = g?.regions ? Object.keys(g.regions).length : 0
    const locCount =
      g?.locations ? Object.keys(g.locations).length : 0
    const version = SlotsUI.progVersion(progKey)
    const profileNames = g?.profiles ? Object.keys(g.profiles) : []
    return newelem("div", { class: "prog-item" }, [
      newelem("div", { class: "prog-item-version" }, [
        version ? `v${version}` : "(unversioned)",
      ]),
      newelem("div", { class: "file-name" }, [
        `${regionCount} regions · ${locCount} locations` +
          (profileNames.length > 1 ?
            ` · ${profileNames.length} settings profiles`
          : ""),
      ]),
      newelem("div", { class: "prog-item-actions" }, [
        newelem(
          "button",
          {
            onclick() {
              Main.updateSavedText(progKey).then(() => {
                // If this row is the map's currently active graph,
                // feed the freshly-reread JSON straight into it so the
                // view (reachability, item list, positions) reflects
                // the update immediately instead of only updating on
                // next load. DataLoading.loadGraph() reuses saved inventory/
                // checked-locations/layout for a matching gameKey, so
                // this is safe to call again on the same graph.
                if (CustomLayout.gameKeyOf() === progKey) {
                  // preserve whichever profile the map is currently
                  // showing for this file, rather than snapping back to
                  // the file's default.
                  DataLoading.loadGraph(
                    window.db.progFiles[progKey],
                    State.graph?.activeProfile,
                  )
                } else {
                  ProgFilesUI.renderProgFiles()
                }
              })
            },
          },
          ["Update"],
        ),
        newelem(
          "button",
          {
            class: "danger",
            onclick() {
              ProgFilesUI.removeProgFile(progKey)
            },
          },
          ["Remove"],
        ),
      ]),
    ])
  }

  static renderProgFiles() {
    const progKeys = SlotsUI.gamesWithProg()
    if (progKeys.length === 0) {
      SlotsUI.progRoot.replaceChildren(
        newelem("div", { class: "empty" }, [
          'No map data yet — open a slot\'s "Show Map" and load its rules JSON there.',
        ]),
      )
      SlotsUI.populateGameSelect()
      return
    }

    const groups = new Map() // game name -> progKey[]
    for (const progKey of progKeys) {
      const name = SlotsUI.progGameName(progKey)
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name).push(progKey)
    }

    SlotsUI.progRoot.replaceChildren(
      ...[...groups.entries()].map(([name, keys]) =>
        newelem("div", { class: "prog-group" }, [
          newelem("div", { class: "prog-group-title" }, [name]),
          newelem(
            "div",
            { class: "prog-flow" },
            keys.map((progKey) =>
              ProgFilesUI.renderProgItem(progKey),
            ),
          ),
        ]),
      ),
    )
    SlotsUI.populateGameSelect()
  }
}
