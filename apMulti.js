/**
 * Minimal, generic Archipelago protocol client meant for running many
 * connections side-by-side in a tracker UI. Unlike a full game client this
 * never sends LocationChecks — it only listens.
 */
class APSlotClient {
  /**
   * @param {{hostname:string, port:string|number, game:string, playerName:string, password?:string}} opts
   * @param {{
   *   onStatus?: (status:string, detail?:string)=>void,
   *   onConnected?: (info:object)=>void,
   *   onItems?: (items:{name:string, id:number, index:number}[])=>void,
   *   onCheckedLocations?: (ids:number[])=>void,
   * }} callbacks
   */
  constructor(opts, callbacks = {}) {
    this.opts = opts
    this.cb = callbacks
    this.itemIdToName = {}
    this.locationIdToName = {}
    this.checkedLocations = []
    this.missingLocations = []
    this.slotData = {}
    this.slotInfo = {}
    this.scoutedItems = {}
    this.players = []
    this.isAuthenticated = false
    this.itemCount = 0
    this._closedByUser = false
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
    const tryOpen = (u) => {
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

  getItemName(itemId, sendingSlot) {
    // log(itemId, this.slotInfo?.[sendingSlot]?.game, format, "itemId, sendingSlot, format")
    const game = this.slotInfo?.[sendingSlot]?.game
    const name = game && this.itemIdToName?.[game]?.[itemId]
    return name ?? `Unknown Item ${game} - (${itemId})`
  }

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
        this.cb.onConnected?.({
          team: this.team,
          slot: this.slot,
          game: this.opts.game,
        })
        this.cb.onCheckedLocations?.(this.checkedLocations)
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
          this.cb.onCheckedLocations?.(this.checkedLocations)
        }
        break
      default:
        break
    }
  }
}
