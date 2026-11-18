class SlotsUI {
  // Renders the slot cards: connection status, obtainable-checks log, per-slot controls (Connections.notify mode, ruleset/profile pickers, connect/disconnect), and the custom multi-version game picker widget used by the add-slot form.

  // ---------------------------------------------------------------------
  // UI: connections panel
  // ---------------------------------------------------------------------
  static slotsRoot = document.getElementById("slots")

  static populateGameSelect() {
    const sel = /** @type {HTMLSelectElement} */ (
      document.getElementById("gameSelect")
    )
    const prev = sel.value
    const first = document.createElement("option")
    first.value = ""
    first.disabled = true
    first.selected = true
    first.textContent =
      HostApi.worlds ? "Select an installed game" : "Loading installed worlds…"
    sel.replaceChildren(first)
    for (const w of HostApi.worlds ?? []) {
      const o = document.createElement("option")
      o.value = w.game
      o.textContent = `${w.game} (v${w.version})`
      sel.append(o)
    }
    if (HostApi.worlds?.some((w) => w.game === prev)) sel.value = prev
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

      const graph = ProgKeys.graphFor(conn)
      const hasProg = !!graph
      const buildError = HostApi.errors[conn.id]
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
              newelem("div", { fontSize: "13px", color: "#6b7280" }, [
                "No map data loaded for this slot's game.",
              ]),
            ]
          : obtainable.length === 0 ?
            [
              newelem("div", { fontSize: "13px", color: "#6b7280" }, [
                "No obtainable checks right now.",
              ]),
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
              newelem("span", { class: `status-dot ${status}` }, []),
              `${conn.playerName} @ ${conn.hostname}${conn.port ? ":" + conn.port : ""}`,
            ]),
            newelem("div", { class: "slot-sub" }, [
              `${conn.game}${graph ? " — v" + graph.version : ""}${HostApi.building.has(conn.id) ? " — generating…" : ""}${conn.optionsSource === "defaults" ? " — default options (no yaml found)" : ""}${rt?.statusDetail ? " — " + rt.statusDetail : ""}`,
            ]),
          ]),
          newelem("div", { class: "slot-controls" }, [
            (() => {
              const modeSelect = newelem("select", {
                title:
                  hasProg ? "" : (
                    `No graph for "${conn.game}" yet, progression-aware alerts need one`
                  ),
                options: {
                  "Notify: none": "none",
                  "Notify: progression-unlocking only": "progression",
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
            buildError ?
              newelem("div", { class: "slot-error", color: "#f87171", whiteSpace: "pre-wrap" }, [buildError])
            : null,
            newelem("div", { class: "h" }, [
              newelem(
                "button",
                {
                  flexGrow: 2,
                  title: conn.yamlPath ?? "no yaml, using world defaults",
                  async onclick() {
                    const path = await window.hostRpc.pick_yaml()
                    if (!path) return
                    const cc = window.db.connections[conn.id]
                    cc.yamlPath = path
                    await HostApi.regenerate(cc)
                  },
                },
                [conn.yamlPath ? `YAML: ${conn.yamlPath.split("/").pop()}` : "Select YAML"],
              ),
              newelem(
                "button",
                {
                  title: "Regenerate this slot's graph (re-reads the yaml and the world's code)",
                  disabled: HostApi.building.has(conn.id),
                  onclick() {
                    HostApi.regenerate(window.db.connections[conn.id])
                  },
                },
                ["Regenerate"],
              ),
            ]),
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
                    delete HostApi.graphs[conn.id]
                    SlotsUI.renderSlots()
                    HostApi.gc()
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
            LogicTest.panelFor(conn),
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

    // Every redraw rebuilds all cards, which would drop focus (and the caret)
    // from a text box being typed in. Inputs that opt in with
    // dataset.focusKey get focus and selection restored afterwards.
    const active = document.activeElement
    const focusKey =
      active instanceof HTMLInputElement ?
        active.dataset.focusKey
      : null
    const selStart = focusKey ? active.selectionStart : null
    const selEnd = focusKey ? active.selectionEnd : null

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
                db.groupCollapsed[groupKey] =
                  !db.groupCollapsed[groupKey]
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

    if (focusKey) {
      const el = /** @type {HTMLInputElement | null} */ (
        [...SlotsUI.slotsRoot.querySelectorAll("input")].find(
          (i) => i.dataset.focusKey === focusKey,
        )
      )
      // null when the card was removed or collapsed by this redraw
      if (el) {
        el.focus()
        el.setSelectionRange(selStart, selEnd)
      }
    }
  }
}
