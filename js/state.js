/**
 * @typedef {Object} NodeLayout
 * @property {boolean} reachable
 * @property {number} w
 * @property {number} h
 * @property {Array<Row>} rows
 */
/**
 * @typedef {Object} Els
 * @property {HTMLElement} sidebar
 * @property {HTMLElement} itemList
 * @property {HTMLElement} status
 * @property {HTMLInputElement} search
 * @property {HTMLCanvasElement} canvas
 * @property {HTMLElement} canvasWrap
 * @property {HTMLElement} checkHoverPopup
 * @property {HTMLElement} emptyMsg
 * @property {HTMLInputElement} hideEventsChk
 * @property {HTMLInputElement} hideEmptyNodesChk
 * @property {HTMLInputElement} hideOOLChk
 * @property {HTMLInputElement} hideClearedChk
 * @property {HTMLInputElement} noTransitChk
 * @property {HTMLInputElement} showScoutsChk
 * @property {HTMLElement} sortFnModal
 * @property {HTMLTextAreaElement} sortFnEditor
 * @property {HTMLElement} sortFnError
 * @property {HTMLElement} sortFnGameLabel
 * @property {HTMLElement} launchURLModal
 * @property {HTMLInputElement} launchURLEditor
 * @property {HTMLElement} launchURLError
 * @property {HTMLElement} launchURLGameLabel
 */

class State {
  // Map view state: the mutable globals the map screen renders from/writes to (graph, inventory, view transform, UI toggles, DOM element refs).

  static graph = null // rules JSON, resolved to the currently active settings profile
  static rawGraph = null // last-loaded rules JSON as-is (still has any _by_profile markers), kept so switching profiles can re-resolve without reloading the file
  /**@type {Hint[]} */
  static hints = []
  /**@type {Record<string,Hint[]>} */
  static hintsBySlot = {}
  static inventory = {} // itemName -> count (int)
  static eventInventory = {} // itemName -> count auto-granted by reachable event locations
  static eventItemNames = new Set() // item names that come from is_event locations (colored + read-only)
  static itemMaxCounts = {} // itemName -> highest count ever required by a rule
  static checkedLocations = {} // locationName -> bool
  static scoutedItems = {} // locationName -> {itemName, itemPlayer, flags}, from AP LocationScouts (synced from a live slot)
  static showScouts = false // View toggle: show scouted item names in the location rows
  static scoutOwnSlot = null // this slot's own AP slot number, for telling "your item" apart from other players'
  static scoutPlayerNames = {} // slot number -> player name, for labeling scouted items that belong to other players
  static scoutTrackedSlots = new Set() // slot numbers, on the same hostname:port as the synced slot, that also have an open/tracked connection -- used to star scouted items bound for a slot we're already tracking
  /**@type {Record<string, { x: number; y: number; }>} */
  static positions = {} // regionName -> {x,y}
  /** @type {Record<string,NodeLayout>} */
  static nodeLayouts = {} // regionName -> {w,h,reachable,rows:[...]} (rebuilt by Render.renderNodes; drawn fresh onto canvas every frame, not kept as DOM elements)
  /**
   * @type {{ from: string; to: any; traversable: any; }[]}
   */
  static edgeList = [] // [{from,to,traversable}] (rebuilt by Render.renderEdges; drawn fresh onto canvas every frame)
  static view = { x: 0, y: 0, scale: 1 }
  static hideEvents = false
  static hideEmptyNodes = false
  static hideOOL = false // hide nodes that are out-of-logic or fully collected already
  static hideCleared = false // hide nodes that are out-of-logic or fully collected already
  static noTransit = false
  static searchQuery = "" // lowercase; filters both the inventory list and map nodes
  /**@type {Record<string,string>} */
  static customSortFns = {} // gameKey -> function source (string)
  static reach = {
    regions: new Set(),
    locations: new Set(),
    entrances: new Set(),
  }
  static hoveredCheck = null // {rname, lname} | null -- row the pointer is currently over, for the requirements popup

  // The rules JSON has no explicit "item for this event location" field,
  // so by convention the event's item is named after the location: its
  // full name, or (for "Region - Token" style names) just the token.
  // `linfo.item` is honored first in case a future export adds it.
  static eventItemNameFor(lname, linfo) {
    if (linfo && linfo.item) return linfo.item
    return lname.includes(" - ") ?
        lname.split(" - ").slice(1).join(" - ")
      : lname
  }

  /** @type {Els} */
  static els = {
    sidebar: document.getElementById("sidebar"),
    itemList: document.getElementById("itemList"),
    status: document.getElementById("status"),
    search: /** @type {HTMLInputElement} */ (
      document.getElementById("search")
    ),
    canvas: /** @type {HTMLCanvasElement} */ (
      document.getElementById("mapCanvas")
    ),
    canvasWrap: document.getElementById("canvasWrap"),
    checkHoverPopup: document.getElementById("checkHoverPopup"),
    emptyMsg: document.getElementById("emptyMsg"),
    hideEventsChk: /** @type {HTMLInputElement} */ (
      document.getElementById("hideEventsChk")
    ),
    hideEmptyNodesChk: /** @type {HTMLInputElement} */ (
      document.getElementById("hideEmptyNodesChk")
    ),
    hideOOLChk: /** @type {HTMLInputElement} */ (
      document.getElementById("hideOOLChk")
    ),
    hideClearedChk: /** @type {HTMLInputElement} */ (
      document.getElementById("hideClearedChk")
    ),
    noTransitChk: /** @type {HTMLInputElement} */ (
      document.getElementById("noTransitChk")
    ),
    showScoutsChk: /** @type {HTMLInputElement} */ (
      document.getElementById("showScoutsChk")
    ),
    sortFnModal: document.getElementById("sortFnModal"),
    sortFnEditor: /** @type {HTMLTextAreaElement} */ (
      document.getElementById("sortFnEditor")
    ),
    sortFnError: document.getElementById("sortFnError"),
    sortFnGameLabel: document.getElementById("sortFnGameLabel"),
    launchURLModal: document.getElementById("launchURLModal"),
    launchURLEditor: /** @type {HTMLInputElement} */ (
      document.getElementById("launchURLEditor")
    ),
    launchURLError: document.getElementById("launchURLError"),
    launchURLGameLabel: document.getElementById("launchURLGameLabel"),
  }
}
