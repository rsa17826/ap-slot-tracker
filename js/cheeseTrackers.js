class CheeseTrackers {
  // Cheese Trackers integration: linking a slot to a tracker game and toggling/auto-syncing its BK (blocked) status from here.

  // ---------------------------------------------------------------------
  // Cheese Trackers integration: link a slot to a tracker/game so its BK
  // (blocked) status can be toggled from here instead of the tracker site.
  // The API key is global (one field, used for every linked slot); linking
  // only needs a tracker link/ID since the game is auto-matched by slot name.
  // ---------------------------------------------------------------------
  static ctUiState = {} // connId -> ephemeral link-flow state (not persisted)

  // A fresh client per call, since the API key can change at any time while
  // slots stay linked.
  static ctClient() {
    return new CheeseTrackersClient(window.db?.ctApiKey)
  }

  /**
   * @param {string | number} connId
   */
  static ctUi(connId) {
    return (CheeseTrackers.ctUiState[connId] ??= {
      trackerInput: "",
      busy: false,
      error: "",
    })
  }

  /**
   * @param {SlotConnection} conn
   */
  static ctSaveConn(conn) {
    const cc = window.db.connections[conn.id]
    if (cc) cc.ct = conn.ct
  }

  /**
   * @param {SlotConnection} conn
   */
  static async ctDoLink(conn) {
    const ui = CheeseTrackers.ctUi(conn.id)
    const trackerId = CheeseTrackersClient.parseTrackerId(
      ui.trackerInput,
    )
    if (!trackerId) {
      ui.error = "Enter a tracker link or ID first"
      SlotsUI.renderSlots()
      return
    }
    ui.busy = true
    ui.error = ""
    SlotsUI.renderSlots()
    try {
      const tracker =
        await CheeseTrackers.ctClient().getTracker(trackerId)
      const game = CheeseTrackersClient.guessGame(
        tracker.games,
        conn.playerName,
        conn.game,
      )
      if (!game) {
        ui.error = `No game on that tracker matches slot name "${conn.playerName}"`
        return
      }
      conn.ct = {
        trackerId,
        gameId: game.id,
        lastKnownStatus: game.progression_status,
        isBk:
          game.progression_status === CheeseTrackersClient.BK_VALUE,
      }
      CheeseTrackers.ctSaveConn(conn)
      delete CheeseTrackers.ctUiState[conn.id]
    } catch (e) {
      console.error(e)
      ui.error = e.message || "Failed to fetch tracker"
    } finally {
      ui.busy = false
      SlotsUI.renderSlots()
    }
  }

  /**
   * @param {SlotConnection} conn
   */
  static ctUnlink(conn) {
    conn.ct = null
    CheeseTrackers.ctSaveConn(conn)
    delete CheeseTrackers.ctUiState[conn.id]
    SlotsUI.renderSlots()
  }

  // Whether this slot currently has any obtainable-but-unchecked locations,
  // per its loaded rules graph. null means we can't tell (no graph loaded
  // yet), in which case BK can only be set manually.
  /**
   * @param {{ progKey: any; profile: any; id: string | number; }} conn
   */
  static ctObtainableState(conn) {
    const graph = ProgKeys.progForGame(conn.progKey, conn.profile)
    const rt = Connections.runtime[conn.id]
    if (!graph || !rt?.prevObtainable) return null
    return rt.prevObtainable.size > 0
  }

  // Forces the linked slot's tracker status to the given BK state.
  /**
   * @param {SlotConnection} conn
   * @param {boolean} toBk
   */
  static async ctApplyStatus(
    conn,
    toBk,
    shouldRefreshBkTimer = false,
  ) {
    if (!conn.ct) return
    const ui = CheeseTrackers.ctUi(conn.id)
    ui.busy = true
    ui.error = ""
    SlotsUI.renderSlots()
    try {
      warn(conn, toBk, shouldRefreshBkTimer)
      const updated = await CheeseTrackers.ctClient().setBk(
        conn,
        toBk,
        shouldRefreshBkTimer,
      )
      conn.ct.isBk = toBk
      conn.ct.lastKnownStatus =
        updated ? updated.progression_status : conn.ct.lastKnownStatus
      CheeseTrackers.ctSaveConn(conn)
    } catch (e) {
      console.error(e)
      ui.error = e.message || "Failed to update status"
    } finally {
      ui.busy = false
      SlotsUI.renderSlots()
    }
  }

  // Called whenever a slot's obtainable-locations set may have changed
  // (items received or locations checked off). Silently re-syncs the
  // tracker's BK status to match the current logic state, if we can tell
  // what it should be and it's not already correct.
  /**
   * @param {SlotConnection} conn
   */
  static ctAutoSync(conn) {
    if (!conn.ct) return
    if (!conn.autoUpdateCTStatus) return
    const state = CheeseTrackers.ctObtainableState(conn)
    if (state === null) return
    const shouldBeBk = !state
    if (conn.ct.isBk === shouldBeBk) return
    CheeseTrackers.ctApplyStatus(conn, shouldBeBk, false)
  }

  /**
   * @param {SlotConnection} conn
   */
  static ctPanelFor(conn) {
    const ui = CheeseTrackers.ctUi(conn.id)

    // Already linked: one button that always reflects (and applies) the
    // status the current logic says this slot should have. With no rules
    // graph loaded we can't compute that, so it falls back to a manual
    // toggle of whatever it's currently set to.
    var connected = conn.ct?.trackerId && conn.ct?.gameId != null
    if (connected) {
      var state = CheeseTrackers.ctObtainableState(conn)
      var targetIsBk = state === null ? !conn.ct.isBk : !state
    }

    return [
      newelem("label", { class: "v" }, [
        newelem(
          "label",
          { class: "h" },
          connected ?
            [
              newelem(
                "button",
                {
                  disabled: ui.busy,
                  onclick: () =>
                    CheeseTrackers.ctApplyStatus(
                      conn,
                      targetIsBk,
                      true,
                    ),
                },
                [
                  ui.busy ? "…"
                  : state === null ?
                    conn.ct.isBk ?
                      "Marked BK'd (tap to clear)"
                    : "Mark BK'd"
                  : targetIsBk ? "Mark BK'd"
                  : "Mark Unblocked",
                ],
              ),
              newelem(
                "button",
                {
                  class: "danger",
                  onclick: () => CheeseTrackers.ctUnlink(conn),
                },
                ["Unlink"],
              ),
              newelem("label", { class: "h" }, [
                newelem("input", {
                  type: "checkbox",
                  /** @this {HTMLInputElement} */
                  onchange() {
                    conn.autoUpdateCTStatus = this.checked
                  },
                  checked: conn.autoUpdateCTStatus,
                }),
                "Auto Update Status",
              ]),
            ]
          : [
              newelem("input", {
                flexGrow: 2,
                placeholder:
                  "Tracker link or ID (e.g. .../tracker/AAA or AAA)",
                value: ui.trackerInput,
                width: "300px",
                oninput() {
                  ui.trackerInput = this.value
                },
              }),
              newelem(
                "button",
                {
                  disabled: ui.busy,
                  onclick: () => CheeseTrackers.ctDoLink(conn),
                },
                [ui.busy ? "…" : "Link Cheese Tracker"],
              ),
            ],
        ),
        ui.error ?
          newelem("label", { class: "h" }, [
            newelem("span", { class: "slot-sub" }, [ui.error]),
          ])
        : null,
      ]),
    ]
  }
}
