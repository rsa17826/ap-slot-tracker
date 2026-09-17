class ProgFilesUI {
  // Renders the loaded rules-JSON files list (regions/locations counts, update/remove) and keeps the add-slot game picker in sync with it.

  static renderProgFiles() {
    const progKeys = SlotsUI.gamesWithProg()
    SlotsUI.progRoot.replaceChildren(
      ...(progKeys.length === 0 ?
        [
          newelem("div", { class: "empty" }, [
            'No map data yet — open a slot\'s "Show Map" and load its rules JSON there.',
          ]),
        ]
      : progKeys.map((progKey) => {
          const g = window.db.progFiles[progKey]
          const regionCount =
            g?.regions ? Object.keys(g.regions).length : 0
          const locCount =
            g?.locations ? Object.keys(g.locations).length : 0
          const version = SlotsUI.progVersion(progKey)
          const name = SlotsUI.progGameName(progKey)
          const profileNames =
            g?.profiles ? Object.keys(g.profiles) : []
          return newelem("div", { class: "prog-row" }, [
            newelem("div", {}, [
              version ? `${name} — v${version}` : name,
              newelem("div", { class: "file-name" }, [
                `${regionCount} regions · ${locCount} locations` +
                  (profileNames.length > 1 ?
                    ` · ${profileNames.length} settings profiles (choose per-slot below)`
                  : ""),
              ]),
            ]),
            newelem("div", {}, [
              newelem(
                "button",
                {
                  marginRight: "8px",
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
                    delete window.db.progFiles[progKey]
                    ProgFilesUI.renderProgFiles()
                    SlotsUI.renderSlots()
                  },
                },
                ["Remove"],
              ),
            ]),
          ])
        })),
    )
    SlotsUI.populateGameSelect()
  }
}
