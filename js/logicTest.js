/**
 * @typedef {Object} LTSphere
 * @property {string} key_item
 * @property {number} key_id
 * @property {number} required
 * @property {number[]} locations
 * @property {[number, number][]} key_locations
 */

/**
 * @typedef {Object} LTItem
 * @property {string} name
 * @property {number} id
 * @property {number} index
 * @property {number} player
 * @property {number} location
 */

/**
 * @typedef {Object} LTRuntime
 * @property {APSlotClient | null} client null only when the slot name is missing
 * @property {string} status
 * @property {string} statusDetail
 * @property {LTSphere[]} spheres
 * @property {number} currentSphere index of the next sphere to open
 * @property {Record<number, number>} keyCounts key item id -> copies received
 * @property {Record<string, number[]>} leaks sphere number we were on -> early key sphere numbers
 * @property {Record<string, true>} alerted "player:location" of unreachable markers already notified
 * @property {boolean} storageLoaded true once leaks/alerts were read from server data storage
 * @property {LTItem[]} pending items received before storage was loaded
 */

class LogicTest {
  // Acts as the Logic Test client for a tracked slot: connects to the Logic Test slot
  // (same server as the tracked slot) in place of the native client, follows its
  // KEY_i spheres, notifies on out-of-order keys (logic leaks) and unreachable
  // markers (out-of-logic checks), and opens spheres (automatically or via button).

  static GAME = "Logic Test"
  static MARKER_NAME = "Logic Test Unreachable Marker"

  /** @type {Record<string, LTRuntime>} */
  static runtime = {} // connId -> LTRuntime

  /** @param {APSlotClient} client */
  static leaksKey(client) {
    // same key the native Logic Test client uses, so both clients share leak history
    return `LogicTest_leaks_${client.team}_${client.slot}`
  }
  /** @param {APSlotClient} client */
  static alertsKey(client) {
    return `LogicTestTracker_alerts_${client.team}_${client.slot}`
  }

  /**
   * @param {SlotConnection} conn
   * @param {string} title
   * @param {string} body
   */
  static alert(conn, title, body) {
    console.warn(`[${conn.playerName}] ${title}: ${body}`)
    Connections.notify(`[${conn.playerName}] ${title}`, body)
  }

  /**
   * (Re)starts the Logic Test connection for a tracked slot.
   * @param {SlotConnection} conn
   */
  static start(conn) {
    LogicTest.stop(conn.id)
    /** @type {LTRuntime} */
    const rt = {
      client: null,
      status: "connecting",
      statusDetail: "",
      spheres: [],
      currentSphere: 0,
      keyCounts: {},
      leaks: {},
      alerted: {},
      storageLoaded: false,
      pending: [],
    }
    LogicTest.runtime[conn.id] = rt
    if (!conn.ltSlotName) {
      rt.status = "error"
      rt.statusDetail = "enter the Logic Test slot name"
      SlotsUI.renderSlots()
      return
    }
    const client = new APSlotClient(
      {
        hostname: conn.hostname,
        port: conn.port,
        game: LogicTest.GAME,
        playerName: conn.ltSlotName,
        password: conn.password,
        connId: `${conn.id}:lt`,
        tags: ["AP"], // not "Tracker": this client sends LocationChecks
        slotData: true,
      },
      {
        onStatus: (status, detail) => {
          rt.status = status
          rt.statusDetail = detail || ""
          SlotsUI.renderSlots()
        },
        onConnected: () => LogicTest.onConnected(rt),
        onCheckedLocations: () =>
          LogicTest.onCheckedLocations(conn, rt),
        onScoutedItems: () => {}, // required by the callbacks type; never scouts
        onItems: (items) => LogicTest.onItems(conn, rt, items),
        onPacket: (packet) => LogicTest.onPacket(conn, rt, packet),
      },
    )
    rt.client = client
    client.connect()
    SlotsUI.renderSlots()
  }

  /** @param {string} connId */
  static stop(connId) {
    const rt = LogicTest.runtime[connId]
    // client is null when start() bailed out for a missing slot name
    rt?.client?.disconnect()
    delete LogicTest.runtime[connId]
  }

  /** @param {LTRuntime} rt */
  static onConnected(rt) {
    const client = rt.client
    if (!Array.isArray(client.slotData.spheres)) {
      rt.status = "error"
      rt.statusDetail =
        "slot has no sphere data - is it a Logic Test slot?"
      console.error(
        "Logic Test slot_data has no spheres",
        client.slotData,
      )
      SlotsUI.renderSlots()
      return
    }
    rt.spheres = client.slotData.spheres
    const keys = [
      LogicTest.leaksKey(client),
      LogicTest.alertsKey(client),
    ]
    client.sendPackets([
      { cmd: "Get", keys },
      { cmd: "SetNotify", keys },
    ])
    SlotsUI.renderSlots()
  }

  /**
   * @param {SlotConnection} conn
   * @param {LTRuntime} rt
   */
  static onCheckedLocations(conn, rt) {
    const before = rt.currentSphere
    LogicTest.syncSphere(rt)
    if (rt.storageLoaded && conn.ltAutoProceed)
      LogicTest.proceedWhileReady(rt)
    if (rt.currentSphere !== before) SlotsUI.renderSlots()
  }

  // Resume at the first sphere whose locations aren't all checked yet. Never
  // moves backwards, so a stale RoomUpdate can't undo a local proceed.
  /** @param {LTRuntime} rt */
  static syncSphere(rt) {
    const checked = new Set(rt.client.checkedLocations)
    let i = 0
    while (
      i < rt.spheres.length &&
      rt.spheres[i].locations.every((l) => checked.has(l))
    )
      i++
    rt.currentSphere = Math.max(rt.currentSphere, i)
  }

  /**
   * @param {SlotConnection} conn
   * @param {LTRuntime} rt
   * @param {LTItem[]} items
   */
  static onItems(conn, rt, items) {
    if (rt.status === "error") return
    // Leak/marker history lives in server storage; items are replayed on every
    // reconnect, so hold them until it has been read or old leaks re-fire.
    if (!rt.storageLoaded) {
      rt.pending.push(...items)
      return
    }
    LogicTest.processItems(conn, rt, items)
    SlotsUI.renderSlots()
  }

  /**
   * @param {SlotConnection} conn
   * @param {LTRuntime} rt
   * @param {any} packet
   */
  static onPacket(conn, rt, packet) {
    if (rt.status === "error") return
    const client = rt.client
    const leaksKey = LogicTest.leaksKey(client)
    const alertsKey = LogicTest.alertsKey(client)
    if (packet.cmd === "Retrieved") {
      if (!(leaksKey in packet.keys)) return // the hints reply, not ours
      // a key that was never written comes back null
      rt.leaks = packet.keys[leaksKey] ?? {}
      rt.alerted = packet.keys[alertsKey] ?? {}
      rt.storageLoaded = true
      const pending = rt.pending
      rt.pending = []
      LogicTest.processItems(conn, rt, pending)
      LogicTest.syncSphere(rt)
      if (conn.ltAutoProceed) LogicTest.proceedWhileReady(rt)
      SlotsUI.renderSlots()
    } else if (packet.cmd === "SetReply") {
      if (packet.key === leaksKey) rt.leaks = packet.value
      else if (packet.key === alertsKey) rt.alerted = packet.value
      else return
      SlotsUI.renderSlots()
    }
  }

  // sphere number (1-based) of an early key -> sphere number we were on when it arrived
  /** @param {LTRuntime} rt */
  static leakOrigin(rt) {
    /** @type {Record<number, number>} */
    const origin = {}
    for (const [on, nums] of Object.entries(rt.leaks))
      for (const n of nums) origin[n] = Number(on)
    return origin
  }

  /**
   * Items are handled one at a time so that, with auto proceed, a key that
   * arrives right after the sphere before it opened is not called a leak.
   * @param {SlotConnection} conn
   * @param {LTRuntime} rt
   * @param {LTItem[]} items
   */
  static processItems(conn, rt, items) {
    const client = rt.client
    let leaksChanged = false
    /** @type {Record<string, true>} */
    const newAlerts = {}
    for (const item of items) {
      const sphereIdx = rt.spheres.findIndex(
        (s) => s.key_id === item.id,
      )
      if (sphereIdx !== -1) {
        rt.keyCounts[item.id] = (rt.keyCounts[item.id] || 0) + 1
        // a key for a sphere after the current one = the location was reachable
        // earlier than the logic model allows
        if (
          sphereIdx > rt.currentSphere &&
          !(sphereIdx + 1 in LogicTest.leakOrigin(rt))
        ) {
          ;(rt.leaks[String(rt.currentSphere + 1)] ??= []).push(
            sphereIdx + 1,
          )
          leaksChanged = true
          LogicTest.alert(
            conn,
            "Logic leak: key out of order",
            `${rt.spheres[sphereIdx].key_item} received while on sphere ${rt.currentSphere + 1} - ${LogicTest.describeFind(rt, item)}`,
          )
        }
      } else if (item.name === LogicTest.MARKER_NAME) {
        // the real game let us reach a check the logic model proved unreachable
        const id = `${item.player}:${item.location}`
        if (!rt.alerted[id]) {
          rt.alerted[id] = true
          newAlerts[id] = true
          LogicTest.alert(
            conn,
            "Out-of-logic check",
            LogicTest.describeFind(rt, item),
          )
        }
      }
      if (conn.ltAutoProceed) LogicTest.proceedWhileReady(rt)
    }
    // "update" merges into the stored dict so a concurrent writer's keys aren't dropped
    if (leaksChanged)
      client.sendPackets([
        {
          cmd: "Set",
          key: LogicTest.leaksKey(client),
          default: {},
          want_reply: true,
          operations: [{ operation: "update", value: rt.leaks }],
        },
      ])
    if (Object.keys(newAlerts).length)
      client.sendPackets([
        {
          cmd: "Set",
          key: LogicTest.alertsKey(client),
          default: {},
          want_reply: true,
          operations: [{ operation: "update", value: newAlerts }],
        },
      ])
  }

  // "Location name (Player name)" for the location that sent an item
  /**
   * @param {LTRuntime} rt
   * @param {LTItem} item
   */
  static describeFind(rt, item) {
    const client = rt.client
    const game = client.slotInfo[item.player].game
    const location = client.locationIdToName[game][item.location]
    const player = client.players.find(
      (p) => p.team === client.team && p.slot === item.player,
    ).name
    return `${location} (${player})`
  }

  /** @param {LTRuntime} rt */
  static isReady(rt) {
    const sphere = rt.spheres[rt.currentSphere]
    return (
      sphere !== undefined &&
      (rt.keyCounts[sphere.key_id] || 0) >= sphere.required
    )
  }

  // Sends the checks for the current sphere, releasing its items. Returns whether it did.
  /** @param {LTRuntime} rt */
  static proceed(rt) {
    if (rt.status !== "connected" || !LogicTest.isReady(rt))
      return false
    rt.client.sendLocationChecks(
      rt.spheres[rt.currentSphere].locations,
    )
    rt.currentSphere++
    return true
  }

  /** @param {LTRuntime} rt */
  static proceedWhileReady(rt) {
    while (LogicTest.proceed(rt));
  }

  /** @param {SlotConnection} conn */
  static panelFor(conn) {
    const rt = LogicTest.runtime[conn.id]
    const live = () => window.db.connections[conn.id]
    // only restart when the tracked slot itself is connected
    const restart = () => {
      if (Connections.runtime[conn.id]) LogicTest.start(live())
    }

    const enableChk = newelem(
      "label",
      {
        class: "h",
        title: "Connect to a Logic Test slot and follow its spheres",
      },
      [
        newelem("input", {
          type: "checkbox",
          flexGrow: 0,
          padding: 0,
          margin: 0,
          checked: conn.ltEnabled,
          /** @this {HTMLInputElement} */
          onclick() {
            live().ltEnabled = this.checked
            if (this.checked) restart()
            else LogicTest.stop(conn.id)
            SlotsUI.renderSlots()
          },
        }),
        "Logic test",
      ],
    )
    if (!conn.ltEnabled)
      return newelem("div", { class: "h" }, [enableChk])

    const nameInput = newelem("input", { type: "text" })
    nameInput.placeholder = "Logic Test slot name"
    nameInput.value = conn.ltSlotName ?? ""
    nameInput.dataset.focusKey = `${conn.id}:ltName` // see SlotsUI.renderSlots
    nameInput.style.flexGrow = "1"
    nameInput.style.minWidth = "0"
    nameInput.oninput = () => {
      live().ltSlotName = nameInput.value.trim()
    }
    nameInput.onchange = () => {
      restart()
      SlotsUI.renderSlots()
    }

    const autoChk = newelem(
      "label",
      {
        class: "h",
        title: "Open each sphere as soon as all of its keys are in",
      },
      [
        newelem("input", {
          type: "checkbox",
          flexGrow: 0,
          padding: 0,
          margin: 0,
          checked: conn.ltAutoProceed,
          /** @this {HTMLInputElement} */
          onclick() {
            live().ltAutoProceed = this.checked
            if (this.checked && rt) LogicTest.proceedWhileReady(rt)
            SlotsUI.renderSlots()
          },
        }),
        "Auto proceed",
      ],
    )

    const row = [enableChk, nameInput, autoChk]
    if (!conn.ltAutoProceed) {
      const ready =
        !!rt && rt.status === "connected" && LogicTest.isReady(rt)
      const btn = newelem(
        "button",
        {
          disabled: !ready,
          onclick() {
            LogicTest.proceed(rt)
            SlotsUI.renderSlots()
          },
        },
        [
          ready ?
            `Proceed (sphere ${rt.currentSphere + 1})`
          : "Proceed",
        ],
      )
      row.push(btn)
    }
    return newelem("div", { class: "v" }, [
      newelem("div", { class: "h" }, row),
      LogicTest.statusLine(rt),
    ])
  }

  /** @param {LTRuntime | undefined} rt */
  static statusLine(rt) {
    const line = (/** @type {string} */ text, color = "#6b7280") =>
      newelem("div", { fontSize: "13px", color }, [text])
    if (!rt) return line("Logic Test: not connected")
    if (rt.status !== "connected")
      return line(
        `Logic Test: ${rt.status}${rt.statusDetail ? " - " + rt.statusDetail : ""}`,
        rt.status === "error" ? "var(--danger)" : "#6b7280",
      )
    const total = rt.spheres.length
    const leakOrigin = LogicTest.leakOrigin(rt)
    const leakCount = Object.keys(leakOrigin).length
    const oolCount = Object.keys(rt.alerted).length
    let text
    if (rt.currentSphere >= total)
      text = `Complete: all ${total} spheres opened`
    else {
      const s = rt.spheres[rt.currentSphere]
      const have = rt.keyCounts[s.key_id] || 0
      text = `Sphere ${rt.currentSphere + 1}/${total}: ${have}/${s.required} ${s.key_item}${have >= s.required ? " - ready" : ""}`
    }
    if (leakCount)
      text += ` | ${leakCount} leak${leakCount === 1 ? "" : "s"}`
    if (oolCount)
      text += ` | ${oolCount} OOL check${oolCount === 1 ? "" : "s"}`
    const el = line(
      text,
      leakCount || oolCount ? "var(--danger)" : "#6b7280",
    )
    el.title = Object.entries(leakOrigin)
      .map(([n, on]) => `KEY_${n} received on sphere ${on}`)
      .join("\n")
    return el
  }
}
