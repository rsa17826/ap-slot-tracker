class Connections {
  // Live AP slot connection lifecycle: opening/closing connections and handling incoming items, wired into progression tracking, the map, notifications, and Cheese Trackers.

  // ---------------------------------------------------------------------
  // Runtime state (not persisted): live clients + derived tracking info
  // ---------------------------------------------------------------------
  static runtime = {} // connId -> { client, status, statusDetail, receivedNames:Set, prevObtainable:Set }
  static notify(title, body) {
    if (Notification.permission !== "granted") return
    try {
      new Notification(title, { body, icon: undefined })
    } catch (e) {
      console.error("Connections.notify failed", e)
    }
  }

  static startConnection(conn) {
    const rt = {
      client: null,
      status: "connecting",
      statusDetail: "",
      receivedNames: new Set(),
      receivedCounts: {}, // itemName -> count, for Has(count) rules in the map graph
      prevObtainable: new Set(),
    }
    Connections.runtime[conn.id] = rt

    const client = new APSlotClient(
      {
        hostname: conn.hostname,
        port: conn.port,
        game: conn.game,
        playerName: conn.playerName,
        password: conn.password,
      },
      {
        onStatus: (status, detail) => {
          rt.status = status
          rt.statusDetail = detail || ""
          SlotsUI.renderSlots()
        },
        onConnected: () => {
          SlotsUI.renderSlots()
          if (conn.locationScoutsEnabled)
            client.sendLocationScouts(
              [
                ...client.checkedLocations,
                ...client.missingLocations,
              ],
              0,
            )
        },
        onCheckedLocations: () => {
          RequirementGroups.maybeRecomputeProgression(conn, rt)
          SlotSync.notifyMapOfSlotUpdate(conn)
        },
        onScoutedItems: () => {
          SlotSync.syncFromSlot(conn)
        },
        onItems: (items) => {
          Connections.handleReceivedItems(conn, rt, items)
          RequirementGroups.maybeRecomputeProgression(conn, rt)
          SlotSync.notifyMapOfSlotUpdate(conn)
          CheeseTrackers.ctAutoSync(conn)
        },
      },
    )
    rt.client = client
    client.connect()
  }

  static stopConnection(connId) {
    Connections.runtime[connId]?.client?.disconnect()
    delete Connections.runtime[connId]
    SlotsUI.renderSlots()
  }
  static handleReceivedItems(conn, rt, items) {
    const graph = ProgKeys.progForGame(conn.progKey, conn.profile)

    items.forEach((item) => {
      rt.receivedNames.add(item.name)
      rt.receivedCounts[item.name] =
        (rt.receivedCounts[item.name] || 0) + 1
    })

    // Figure out, per item, whether it opened up anything new — only
    // meaningful if a map graph has been loaded for this game.
    let anyNewProgression = false
    let progDeltaTokens = []
    if (graph) {
      const checkedNames = ProgKeys.checkedLocationNames(conn, rt)
      const { locations } = MapEngine.computeReachablePure(
        graph,
        rt.receivedCounts,
        checkedNames,
      )
      const nowObtainable = new Set(
        [...locations].filter(
          (l) =>
            !checkedNames[l] && ProgKeys.isRealLocation(graph, l),
        ),
      )
      for (const key of nowObtainable) {
        if (!rt.prevObtainable.has(key)) progDeltaTokens.push(key)
      }
      anyNewProgression = progDeltaTokens.length > 0
      rt.prevObtainable = nowObtainable
    }

    // error(conn, 1)
    CheeseTrackers.ctAutoSync(conn)
    SlotsUI.renderSlots()

    const mode = conn.notifyMode || "all"
    const itemNames = items.map((i) => i.name).join(", ")

    if (mode === "none") {
      // Notifications disabled for this slot -- log entries above still
      // record what happened, we just skip the OS notification.
    } else if (mode === "all") {
      Connections.notify(
        `[${conn.playerName}] Item received`,
        itemNames,
      )
    } else if (mode === "progression") {
      if (anyNewProgression) {
        Connections.notify(
          `[${conn.playerName}] New progression!`,
          `${itemNames} unlocked ${progDeltaTokens.length} new location(s)`,
        )
      }
    } else if (mode === "both") {
      Connections.notify(
        `[${conn.playerName}] Item received${anyNewProgression ? " — unlocks progression!" : ""}`,
        itemNames,
      )
    }
  }
}
