class SlotsUI {
  // Renders the slot cards: connection status, obtainable-checks log, per-slot controls (Connections.notify mode, ruleset/profile pickers, connect/disconnect), and the custom multi-version game picker widget used by the add-slot form.

  // ---------------------------------------------------------------------
  // UI: connections panel
  // ---------------------------------------------------------------------
  static slotsRoot = document.getElementById("slots")
  static progRoot = document.getElementById("progFiles")

  static gamesWithProg() {
    return Object.keys(window.db.progFiles || {}).sort((a, s) =>
      a.localeCompare(s, undefined, { numeric: true }),
    )
  }

  // Version comes from the rules JSON's own `.version` field, so each
  // loaded ruleset's dropdown entry can show which revision it is.
  static progVersion(progKey) {
    return window.db.progFiles[progKey]?.version ?? null
  }

  // The actual AP protocol game name for a loaded ruleset (used to connect
  // and to look up the data package), as opposed to the composite progKey
  // used to store/select that specific version of it.
  static progGameName(progKey) {
    return window.db.progFiles[progKey]?.game ?? progKey
  }

  // Keeps the "Add a slot" game picker in sync with whatever rules JSON
  // files have been loaded, showing each entry's name + version. Games
  // with a single loaded version are a plain one-click item; games with
  // multiple loaded versions become a nested group you expand to pick a
  // version from, like a titlebar menu.
  //
  // The picker is a custom widget (not a native <select>, which can't do
  // nested/expandable entries) but keeps the same #gameSelect id and
  // exposes its value through a hidden `game` form field, so
  // `f.game.value` in the add-slot submit handler keeps working unchanged.
  static gameSelectExpanded = null // which game name's submenu is open, if any

  static populateGameSelect() {
    let root = document.getElementById("gameSelect")
    if (!root) return

    // First run: the element in markup is still the old <select id="gameSelect">
    // (or nothing has replaced it yet) — swap it for our widget container,
    // preserving id/name so the rest of the app and the form keep working.
    if (
      root.tagName !== "DIV" ||
      !root.classList.contains("game-select")
    ) {
      const replacement = newelem("div", {
        id: "gameSelect",
        class: "game-select",
      })
      root.replaceWith(replacement)
      root = replacement
    }

    const prevValue = root.dataset.value || ""
    const progKeys = SlotsUI.gamesWithProg()
    const hasAny = progKeys.length > 0

    // Group progKeys by display game name, so games with >1 loaded
    // version become an expandable group and games with exactly one
    // stay a flat, single-click item.
    const groups = new Map() // name -> [progKey, ...]
    for (const progKey of progKeys) {
      const name = SlotsUI.progGameName(progKey)
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name).push(progKey)
    }

    const selectedValid = progKeys.includes(prevValue)
    const value = selectedValid ? prevValue : ""
    root.dataset.value = value

    const selectedLabel = (() => {
      if (!value) {
        return hasAny ? "Select a game" : (
            "Load a rules JSON below to select a game"
          )
      }
      const version = SlotsUI.progVersion(value)
      const name = SlotsUI.progGameName(value)
      return version ? `${name} (v${version})` : name
    })()

    function closeMenu() {
      SlotsUI.gameSelectExpanded = null
      const menu = root.querySelector(".game-select-menu")
      menu?.remove()
      root.classList.remove("open")
    }

    function selectValue(progKey) {
      root.dataset.value = progKey
      closeMenu()
      SlotsUI.populateGameSelect()
      root
        .querySelector('input[name="game"]')
        ?.dispatchEvent(new Event("change", { bubbles: true }))
    }

    function buildMenu() {
      if (groups.size === 0) {
        return newelem("div", { class: "game-select-menu" }, [
          newelem("div", { class: "game-select-empty" }, [
            "Load a rules JSON below to select a game",
          ]),
        ])
      }
      return newelem(
        "div",
        { class: "game-select-menu" },
        [...groups.entries()].map(([name, keys]) => {
          if (keys.length === 1) {
            const progKey = keys[0]
            return newelem(
              "div",
              {
                class: `game-select-item${progKey === value ? " selected" : ""}`,
                onclick: (e) => {
                  e.stopPropagation()
                  selectValue(progKey)
                },
              },
              [name],
            )
          }

          const expanded = SlotsUI.gameSelectExpanded === name
          return newelem("div", { class: "game-select-group" }, [
            newelem(
              "div",
              {
                class: `game-select-group-header${expanded ? " expanded" : ""}`,
                onclick: (e) => {
                  e.stopPropagation()
                  SlotsUI.gameSelectExpanded = expanded ? null : name
                  SlotsUI.populateGameSelect()
                },
              },
              [name, newelem("span", { class: "caret" }, ["▸"])],
            ),
            expanded ?
              newelem(
                "div",
                { class: "game-select-submenu" },
                keys.map((progKey) => {
                  const version = SlotsUI.progVersion(progKey)
                  return newelem(
                    "div",
                    {
                      class: `game-select-item${progKey === value ? " selected" : ""}`,
                      onclick: (e) => {
                        e.stopPropagation()
                        selectValue(progKey)
                      },
                    },
                    [version ? `v${version}` : "(unversioned)"],
                  )
                }),
              )
            : null,
          ])
        }),
      )
    }

    const wasOpen = root.classList.contains("open")

    root.replaceChildren(
      newelem("input", { type: "hidden", name: "game", value }),
      newelem(
        "button",
        {
          type: "button",
          class: "game-select-trigger",
          disabled: !hasAny,
          onclick: (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation()
            if (root.classList.contains("open")) closeMenu()
            else {
              root.classList.add("open")
              root.appendChild(buildMenu())
            }
          },
        },
        [selectedLabel, newelem("span", { class: "caret" }, ["▾"])],
      ),
    )

    if (wasOpen) {
      root.classList.add("open")
      root.appendChild(buildMenu())
    }
  }

  // Group key for a slot connection: all slots on the same AP server
  // (hostname+port) are grouped together, collapsible as a unit.
  static groupKeyFor(conn) {
    return `${conn.hostname}:${conn.port}`
  }

  static renderSlotCard(conn) {
    {
        const rt = Connections.runtime[conn.id]
        const status = rt?.status || "disconnected"

        const hasProg = SlotsUI.gamesWithProg().includes(conn.progKey)
        const graph =
          hasProg ?
            ProgKeys.progForGame(conn.progKey, conn.profile)
          : null
        const obtainable =
          graph ?
            [...(rt?.prevObtainable || [])].sort((a, b) =>
              a.localeCompare(b),
            )
          : []
        return newelem("div", { class: "slot-card" }, [
          newelem(
            "div",
            { class: "slot-log" },
            !graph ?
              [
                newelem(
                  "div",
                  { fontSize: "13px", color: "#6b7280" },
                  ["No map data loaded for this slot's game."],
                ),
              ]
            : obtainable.length === 0 ?
              [
                newelem(
                  "div",
                  { fontSize: "13px", color: "#6b7280" },
                  ["No obtainable checks right now."],
                ),
              ]
            : obtainable.map((locationName) =>
                RequirementGroups.checkRow(
                  locationName,
                  RequirementGroups.requirementGroupsFor(
                    graph,
                    locationName,
                    RequirementGroups.ownedCounts(rt),
                  ),
                ),
              ),
          ),
          newelem("div", { class: "slot-top" }, [
            newelem("div", {}, [
              newelem("div", { class: "slot-title" }, [
                newelem(
                  "span",
                  { class: `status-dot ${status}` },
                  [],
                ),
                `${conn.playerName} @ ${conn.hostname}${conn.port ? ":" + conn.port : ""}`,
              ]),
              newelem("div", { class: "slot-sub" }, [
                `${conn.game}${conn.progKey && hasProg ? " — v" + (SlotsUI.progVersion(conn.progKey) ?? "?") : ""}${rt?.statusDetail ? " — " + rt.statusDetail : ""}`,
              ]),
            ]),
            newelem("div", { class: "slot-controls" }, [
              (() => {
                const modeSelect = newelem("select", {
                  title:
                    hasProg ? "" : (
                      `Upload/load a rules JSON for "${conn.game}" to unlock progression-aware alerts`
                    ),
                  options: {
                    "Notify: none": "none",
                    "Notify: progression-unlocking only":
                      "progression",
                    "Notify: all (highlight progression)": "both",
                    "Notify: all items": "all",
                  },
                  value: conn.notifyMode || "all",
                })
                modeSelect.onchange = () => {
                  const cc = window.db.connections[conn.id]
                  if (!cc) return
                  cc.notifyMode = /** @type {NotifyMode} */ (
                    modeSelect.value
                  )
                }
                return modeSelect
              })(),
              (() => {
                // Only shown once more than one version of this slot's game
                // has a rules file loaded -- otherwise there's nothing to
                // choose between. Lets a slot switch which loaded ruleset
                // (progKey) it tracks against after creation, e.g. once a
                // re-rolled version's JSON has been uploaded.
                const versionKeys = SlotsUI.gamesWithProg().filter(
                  (k) => SlotsUI.progGameName(k) === conn.game,
                )
                if (versionKeys.length <= 1) return null

                /**@type {Record<string, *>} */
                const options = {}
                for (const k of versionKeys)
                  options[
                    `Version: v${SlotsUI.progVersion(k) ?? "?"}`
                  ] = k

                return newelem("select", {
                  title:
                    "Which loaded ruleset (version) this slot's logic (map + notifications) should use",
                  options,
                  value: conn.progKey,
                  onchange() {
                    const cc = window.db.connections[conn.id]
                    if (!cc) return
                    cc.progKey = this.value
                    if (Connections.runtime[conn.id]) {
                      RequirementGroups.maybeRecomputeProgression(
                        conn,
                        Connections.runtime[conn.id],
                      )
                      CheeseTrackers.ctAutoSync(conn)
                    }
                    if (db.currentMapConnId === conn.id) {
                      if (
                        SlotSync.appEl.classList.contains("visible")
                      )
                        SlotSync.openMapForSlot(cc)
                      else SlotSync.syncFromSlot(cc)
                    }
                    SlotsUI.renderSlots()
                  },
                })
              })(),
              (() => {
                // Only shown once a rules file is loaded for this slot's game
                // AND that file actually has more than one settings profile
                // baked in -- otherwise there's nothing to choose between.
                // Each slot keeps its own `conn.profile`, so two slots on the
                // same game+version file can independently track different
                // settings (e.g. one with walls_are_checks on, one off).
                const profileNames =
                  hasProg ?
                    ProgKeys.profileNamesFor(conn.progKey)
                  : []
                if (profileNames.length <= 1) return null

                /**@type {Record<string, *>} */
                const options = {}
                for (const n of profileNames)
                  options[`Profile: ${n}`] = n

                return newelem("select", {
                  title:
                    "Which settings profile this slot's logic (map + notifications) should use",
                  options,
                  value: ProgKeys.activeProfileFor(conn),
                  onchange() {
                    const cc = window.db.connections[conn.id]
                    if (!cc) return
                    cc.profile = this.value
                    if (Connections.runtime[conn.id]) {
                      RequirementGroups.maybeRecomputeProgression(
                        conn,
                        Connections.runtime[conn.id],
                      )
                      CheeseTrackers.ctAutoSync(conn)
                    }
                    if (db.currentMapConnId === conn.id) {
                      if (
                        SlotSync.appEl.classList.contains("visible")
                      )
                        SlotSync.openMapForSlot(cc)
                      else SlotSync.syncFromSlot(cc)
                    }
                    SlotsUI.renderSlots()
                  },
                })
              })(),
              newelem("div", { class: "h" }, [
                newelem(
                  "button",
                  {
                    onclick() {
                      if (
                        status === "disconnected" ||
                        status === "error" ||
                        !rt
                      ) {
                        conn.autoConnect = true
                        Connections.startConnection(conn)
                      } else {
                        conn.autoConnect = false
                        Connections.stopConnection(conn.id)
                      }
                    },
                  },
                  [
                    status === "disconnected" || status === "error" ?
                      "Connect"
                    : "Disconnect",
                  ],
                ),
                newelem(
                  "button",
                  {
                    class: "danger",
                    onclick() {
                      Connections.stopConnection(conn.id)
                      delete window.db.connections[conn.id]
                      SlotsUI.renderSlots()
                    },
                  },
                  ["Remove"],
                ),
                newelem(
                  "label",
                  {
                    class: "h",
                    checked: conn.locationScoutsEnabled,
                    flexGrow: 2,
                  },
                  [
                    newelem("input", {
                      type: "checkbox",
                      flexGrow: 0,
                      padding: 0,
                      margin: 0,
                      /** @this {HTMLInputElement} */
                      onclick() {
                        conn.locationScoutsEnabled = this.checked
                        const client =
                          Connections.runtime[conn.id].client
                        if (
                          !conn.scoutedLocations &&
                          conn.locationScoutsEnabled &&
                          client?.isAuthenticated
                        ) {
                          client.sendLocationScouts(
                            [
                              ...client.checkedLocations,
                              ...client.missingLocations,
                            ],
                            0,
                          )
                        }
                      },
                      checked: conn.locationScoutsEnabled,
                    }),
                    "Enable LocationScouts",
                  ],
                ),
                newelem(
                  "button",
                  {
                    flexGrow: 1,
                    onclick: async (e) => {
                      // Defined in index.html's map script: loads this game's
                      // rules JSON (if already known) and syncs the map's
                      // inventory/checked-locations from this slot's live AP
                      // state.
                      SlotSync.openMapForSlot(conn)
                    },
                  },
                  ["Show Map"],
                ),
              ]),
              newelem(
                "div",
                { class: "h" },
                CheeseTrackers.ctPanelFor(conn),
              ),
              newelem("div", { class: "h", flexGrow: "2" }, [
                newelem(
                  "button",
                  {
                    flexGrow: "2",
                    onclick: async (e) => {
                      LaunchUrlEditor.openLink(conn)
                    },
                  },
                  ["Launch Client"],
                ),
                newelem(
                  "button",
                  {
                    onclick: async (e) => {
                      LaunchUrlEditor.openURLEditor(conn.game)
                    },
                  },
                  ["✎"],
                ),
              ]),
            ]),
          ]),
        ])
    }
  }

  static renderSlots() {
    const conns = Object.values(window.db.connections)
    if (conns.length === 0) {
      SlotsUI.slotsRoot?.replaceChildren(
        newelem("div", { class: "empty" }, [
          "No slots yet — add one above.",
        ]),
      )
      return
    }

    // Group slots by hostname+port, preserving first-seen order both
    // of groups and of slots within a group.
    const groups = new Map() // groupKey -> conn[]
    for (const conn of conns) {
      const key = SlotsUI.groupKeyFor(conn)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(conn)
    }

    SlotsUI.slotsRoot?.replaceChildren(
      ...[...groups.entries()].map(([groupKey, groupConns]) => {
        const collapsed = !!db.groupCollapsed[groupKey]
        return newelem("div", { class: "slot-group" }, [
          newelem(
            "div",
            {
              class: "slot-group-header",
              onclick: () => {
                db.groupCollapsed[groupKey] = !db.groupCollapsed[
                  groupKey
                ]
                SlotsUI.renderSlots()
              },
            },
            [
              newelem("span", { class: "caret" }, [
                collapsed ? "▸" : "▾",
              ]),
              newelem("span", { class: "slot-group-title" }, [
                groupKey,
              ]),
              newelem("span", { class: "slot-group-count" }, [
                `${groupConns.length} slot${groupConns.length === 1 ? "" : "s"}`,
              ]),
            ],
          ),
          collapsed ? null : (
            newelem(
              "div",
              { class: "slot-group-body" },
              groupConns.map((conn) => SlotsUI.renderSlotCard(conn)),
            )
          ),
        ])
      }),
    )
  }
}
// Close the menu when clicking anywhere outside it.
document.addEventListener("click", (e) => {
  const root = document.getElementById("gameSelect")
  if (!root || !root.classList.contains("open")) return
  if (root.contains(/** @type {Node | null} */ (e.target))) return
  SlotsUI.gameSelectExpanded = null
  root.classList.remove("open")
  root.querySelector(".game-select-menu")?.remove()
})
