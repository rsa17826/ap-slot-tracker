/**
 * @typedef {Object} Hint
 * @property {number} receiving_player
 * @property {number} finding_player
 * @property {number} location
 * @property {string} [locationName]
 * @property {number} item
 * @property {string} [itemName]
 * @property {boolean} found
 * @property {string} entrance
 * @property {number} item_flags
 * @property {number} status
 * @property {boolean} hidden
 * @property {boolean} item_hidden
 * @property {string} [ownerName]
 * @property {string} [finderName]
 * @property {string} class
 */

/**
 * Minimal, generic Archipelago protocol client meant for running many
 * connections side-by-side in a tracker UI. Unlike a full game client this
 * never sends LocationChecks — it only listens.
 */

class APSlotClient {
  /**
   * @param {APSlotClientOptions} opts
   * @param {APSlotClientCallbacks} callbacks
   */
  // @ts-ignore
  constructor(opts, callbacks = {}) {
    this.opts = opts
    this.cb = callbacks
    this.connId = opts.connId
    this.itemIdToName = {}
    /**@type {Record<string, Record<string | number, string>>} */
    this.locationIdToName = {}
    /**@type {number[]} */
    this.checkedLocations = []
    /**@type {number[]} */
    this.missingLocations = []
    this.slotData = {}
    this.slotInfo = {}
    /**@type {Record<string, ScoutedItemEntry>} */
    this.scoutedItems = {}
    /**@type {number | null} */
    this.slot = null
    /**@type {number} */
    this.team = -1
    /**@type {APPlayer[]} */
    this.players = []
    /**@type {boolean} */
    this.isAuthenticated = false
    this.itemCount = 0
    this._closedByUser = false
    /** @type {Hint[]} */
    this.hints = []
  }

  get url() {
    const { hostname, port } = this.opts
    return `wss://${hostname}${port ? `:${port}` : ""}`
  }

  connect() {
    this._closedByUser = false
    this.cb.onStatus?.("connecting")
    let url = this.url
    let triedInsecure = false
    const tryOpen = (/** @type {string | URL} */ u) => {
      this.socket = new WebSocket(u)
      this.socket.onopen = () => this.cb.onStatus?.("socket-open")
      this.socket.onmessage = (event) => {
        try {
          const packets = JSON.parse(event.data)
          for (const packet of packets) this.handlePacket(packet)
        } catch (e) {
          console.error("AP parse error", e)
        }
      }
      this.socket.onclose = () => {
        if (this._closedByUser) {
          this.cb.onStatus?.("disconnected")
          return
        }
        this.cb.onStatus?.("error", "connection closed")
      }
      this.socket.onerror = () => {
        if (!triedInsecure) {
          triedInsecure = true
          const fallback = `ws://${this.opts.hostname}${this.opts.port ? `:${this.opts.port}` : ""}`
          this.cb.onStatus?.("connecting", "retrying without TLS")
          tryOpen(fallback)
        } else {
          this.cb.onStatus?.("error", "could not reach server")
        }
      }
    }
    tryOpen(url)
  }

  disconnect() {
    this._closedByUser = true
    try {
      this.socket?.close()
    } catch (e) {}
  }

  /**
   * @param {string | number} itemId
   * @param {string | number} sendingSlot
   */
  getItemName(itemId, sendingSlot) {
    // log(itemId, this.slotInfo?.[sendingSlot]?.game, format, "itemId, sendingSlot, format")
    const game = this.slotInfo?.[sendingSlot]?.game
    const name = game && this.itemIdToName?.[game]?.[itemId]
    return name ?? `Unknown Item ${game} - (${itemId})`
  }

  /**
   * @param {{ cmd: string; locations: number[]; create_as_hint: number; }[] | ({ cmd: string; games: any; password?: undefined; game?: undefined; name?: undefined; uuid?: undefined; version?: undefined; items_handling?: undefined; tags?: undefined; slot_data?: undefined; } | { cmd: string; password: string; game: string; name: string; uuid: string; version: { major: number; minor: number; build: number; class: string; }; items_handling: number; tags: string[]; slot_data: boolean; games?: undefined; })[] | { cmd: string; keys: string[]; }[] | { cmd: string; text: string; }[]} arr
   */
  sendPackets(arr) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(arr))
    }
  }
  /**
   * Scout locations to see what item they contain, optionally creating a hint.
   * @param {number[]} locationIds - Array of location IDs to scout.
   * @param {number} createAsHint - 0: Don't hint, 1: Hint & broadcast all, 2: Hint & broadcast only new.
   */
  sendLocationScouts(locationIds, createAsHint = 0) {
    this.sendPackets([
      {
        cmd: "LocationScouts",
        locations: locationIds,
        create_as_hint: createAsHint,
      },
    ])
  }

  /**
   * @param {{ cmd: any; games: any; data: { games: { [s: string]: any; } | ArrayLike<any>; }; team: number; slot: number; missing_locations: number[]; checked_locations: number[]; slot_info: {}; players: APPlayer[]; slot_data: {}; errors: any; locations: any; items: any[]; index: any; key: string; value: any[]; keys: { [x: string]: any; }; }} packet
   */
  handlePacket(packet) {
    switch (packet.cmd) {
      case "RoomInfo":
        this.sendPackets([
          { cmd: "GetDataPackage", games: packet.games },
          {
            cmd: "Connect",
            password: this.opts.password || "",
            game: this.opts.game,
            name: this.opts.playerName,
            uuid: Math.random().toString(36).slice(2, 15),
            version: {
              major: 0,
              minor: 6,
              build: 8,
              class: "Version",
            },
            items_handling: 7,
            tags: ["Tracker", "AP"],
            slot_data: false,
          },
        ])
        break
      case "DataPackage":
        for (const [game, gameData] of Object.entries(
          packet.data.games,
        )) {
          this.itemIdToName[game] = {}
          for (const [name, id] of Object.entries(
            gameData.item_name_to_id,
          )) {
            this.itemIdToName[game][id] = name
          }
          this.locationIdToName[game] = {}
          for (const [name, id] of Object.entries(
            gameData.location_name_to_id,
          )) {
            this.locationIdToName[game][id] = name
          }
        }
        break
      case "Connected":
        this.isAuthenticated = true
        this.team = packet.team
        this.slot = packet.slot
        this.missingLocations = packet.missing_locations
        this.checkedLocations = packet.checked_locations
        this.slotInfo = packet.slot_info
        this.players = packet.players
        this.slotData = packet.slot_data ?? {}
        this.cb.onStatus?.("connected")
        this.cb.onConnected?.()
        this.cb.onCheckedLocations?.()
        const key = `_read_hints_${this.team}_${this.slot}`
        this.sendPackets([
          { cmd: "Get", keys: [key] },
          { cmd: "SetNotify", keys: [key] },
        ])
        break
      case "ConnectionRefused":
        this.cb.onStatus?.(
          "error",
          (packet.errors || []).join(", ") || "connection refused",
        )
        break
      case "LocationInfo":
        const myGame = this.slotInfo?.[this.slot]?.game

        for (const entry of packet.locations || []) {
          const { location, item, player, flags } = entry
          const itemName = this.getItemName(item, player)
          const locationName =
            (myGame && this.locationIdToName?.[myGame]?.[location]) ??
            `Unknown Location (${location})`

          this.scoutedItems[location] = {
            itemName,
            itemPlayer: player,
            locationName,
            flags,
          }
        }
        this.cb?.onScoutedItems()
        break
      case "ReceivedItems": {
        const items = []
        packet.items.forEach((item, offset) => {
          this.itemCount += 1
          const idx = packet.index + offset
          const name =
            this.itemIdToName?.[this.opts.game]?.[item.item]
          items.push({
            name: name ?? `Unknown Item (${item.item})`,
            id: item.item,
            index: idx,
            player: item.player,
          })
        })
        this.cb.onItems?.(items)
        break
      }
      case "RoomUpdate":
        if (packet.checked_locations) {
          this.checkedLocations = [
            ...new Set([
              ...(this.checkedLocations || []),
              ...packet.checked_locations,
            ]),
          ]
          this.cb.onCheckedLocations?.()
        }
        break
      case "SetReply": {
        const key = `_read_hints_${this.team}_${this.slot}`
        if (packet.key === key && Array.isArray(packet.value)) {
          this.hints = packet.value.map((/** @type {Hint} */ h) => {
            const { name: ownerName, game: finderGame } =
              this.slotInfo?.[h.finding_player]
            const { game: receiverGame, name: finderName } =
              this.slotInfo?.[h.receiving_player]

            return {
              ...h,
              finderName,
              ownerName,
              locationName:
                finderGame ?
                  this.locationIdToName?.[finderGame]?.[h.location]
                : null,
              itemName:
                receiverGame ?
                  this.itemIdToName?.[receiverGame]?.[h.item]
                : null,
            }
          })

          if (this.connId === db.currentMapConnId) {
            State.hints = this.hints
            Render.render()
          }
        }
        break
      }
      case "Retrieved": {
        const key = `_read_hints_${this.team}_${this.slot}`
        if (packet.keys?.[key]) {
          this.hints = packet.keys[key].map(
            (/** @type {Hint} */ h) => {
              const { name: ownerName, game: finderGame } =
                this.slotInfo?.[h.finding_player]
              const { game: receiverGame, name: finderName } =
                this.slotInfo?.[h.receiving_player]
              return {
                ...h,
                finderName,
                ownerName,
                locationName:
                  finderGame ?
                    this.locationIdToName?.[finderGame]?.[h.location]
                  : null,
                itemName:
                  receiverGame ?
                    this.itemIdToName?.[receiverGame]?.[h.item]
                  : null,
              }
            },
          )

          if (this.connId === db.currentMapConnId) {
            State.hints = this.hints
            Render.render()
          }
        }
        break
      }
      default:
        break
    }
  }
  /**
   * Requests a hint from the server using the in-game text command system.
   * @param {string} searchString - The name of the item or location you want a hint for.
   */
  requestItemHint(searchString) {
    this.sendPackets([
      {
        cmd: "Say",
        text: `!hint ${searchString}`,
      },
    ])
  }
}
