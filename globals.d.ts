// Ambient declarations for globals provided by scripts outside this
// checkout (newelem.js, indexeddbProxy.js, apMulti.js,
// CheeseTrackersClient.js, a.js) plus a couple of not-yet-widely-typed
// browser APIs (File System Access) that this app relies on.
export {}

declare global {
  /** Rule tree node shape used throughout ruleEngine/requirementGroups/dataLoading. Loosely typed since the rules JSON is externally generated and highly polymorphic per rule "type". */
  interface RuleNode {
    type?: string
    item_name?: string
    item_names?: string[] | [string, number][]
    item_counts?: [string, number][] | Record<string, number>
    counts?: Record<string, number>
    count?: number
    items?: string[]
    group_items?: string[]
    children?: RuleNode[]
    rules?: RuleNode[]
    sub_rules?: RuleNode[]
    rule?: RuleNode
    wrapped?: RuleNode
    sub_rule?: RuleNode
    region_name?: string
    location_name?: string
    entrance_name?: string
    name?: string
  }

  interface LocationInfo {
    region: string
    rule: RuleNode
    is_event?: boolean
    item?: string
  }

  interface EntranceInfo {
    rule: RuleNode
    connects_to?: string
  }

  interface RegionInfo {
    exits?: string[]
    locations: string[]
    isTransit?: boolean
  }

  interface ItemInfo {
    count?: number
  }

  /** A rules-JSON "graph": either raw (possibly with `_by_profile` markers and a `profiles` map) or already resolved to one profile. */
  interface RulesGraph {
    game?: string
    version?: string | number
    origin_region_name: string
    regions: Record<string, RegionInfo>
    entrances: Record<string, EntranceInfo>
    locations: Record<string, LocationInfo>
    items?: Record<string, ItemInfo>
    profiles?: Record<string, unknown>
    activeProfile?: string | null
  }

  interface CTLinkInfo {
    trackerId: string
    gameId: number | string
    lastKnownStatus?: string
    isBk: boolean
  }

  type NotifyMode = "none" | "all" | "progression" | "both"

  // { id: string | number; playerName: any; game: any; ct: { trackerId: any; gameId: any; lastKnownStatus: any; isBk: boolean; }; }
  interface SlotConnection {
    autoConnect: bool
    id: string
    hostname: string
    port: string
    game: string
    progKey: string
    playerName: string
    password: string
    notifyMode?: NotifyMode
    profile: string | null
    ct: CTLinkInfo | null
    autoUpdateCTStatus?: boolean
    locationScoutsEnabled?: boolean
    scoutedLocations?: boolean
  }

  interface ScoutedItemEntry {
    locationName: string
    itemName: string
    itemPlayer: number
    flags: number
  }

  interface APPlayer {
    slot: number
    team: number
    name: string
  }

  interface APSlotClientOptions {
    hostname: string
    port: string
    game: string
    playerName: string
    password: string
  }

  interface APSlotClientCallbacks {
    onStatus: (status: string, detail?: string) => void
    onConnected: () => void
    onCheckedLocations: () => void
    onScoutedItems: () => void
    onItems: (items: { name: string }[]) => void
  }

  interface CTGame {
    id: number | string
    progression_status: string
  }

  interface CTTracker {
    games: CTGame[]
  }

  /** Cheese Trackers HTTP client, provided by CheeseTrackersClient.js (not part of this checkout). */
  class CheeseTrackersClient {
    static BK_VALUE: string
    static parseTrackerId(input: string): string | null
    static guessGame(
      games: CTGame[],
      playerName: string,
      game: string,
    ): CTGame | null
    constructor(apiKey: string | undefined)
    getTracker(trackerId: string): Promise<CTTracker>
    setBk(
      conn: SlotConnection,
      toBk: boolean,
      shouldRefreshBkTimer: boolean,
    ): Promise<CTGame | null>
  }

  /** Attribute bag accepted by newelem: a mix of DOM properties, dataset,
   * inline style shorthands, and event handlers, so it's intentionally
   * permissive (this is a dynamically-typed helper, not a fixed shape). */
  type NewElemAttrs = Record<string, unknown> & {
    class?: string
    dataset?: Record<string, string>
    options?: Record<string, string>
    onclick?: (ev: MouseEvent) => void
    oninput?: (this: HTMLInputElement) => void
    onchange?: (this: HTMLInputElement | HTMLSelectElement) => void
  }

  /** DOM-builder helper from newelem.js (not part of this checkout). Return
   * type is deliberately the union of element kinds this codebase actually
   * builds with it, since callers rely on .value/.checked/.dataset. */
  function newelem(
    tag: string,
    attrs?: NewElemAttrs,
    children?: (Node | string | number | null)[],
  ): HTMLElement & {
    value: string
    checked: boolean
    dataset: DOMStringMap
  }

  /** IndexedDB-backed proxy object from indexeddbProxy.js (not part of this checkout): a plain object whose property writes are persisted. */
  interface Db {
    connections: Record<string, SlotConnection>
    progFiles: Record<string, RulesGraph>
    ctApiKey: string
    launchURLs: Record<string, string>
    customSortFns: Record<string, string>
    fileHandles: Record<string, FileSystemFileHandle>
    progFolderHandle: FileSystemDirectoryHandle
    currentMapConnId: string | null
    layout: Record<string, Record<string, { x: number; y: number }>>
    view: Record<string, { x: number; y: number; scale: number }>
    hideEvents: boolean
    hideEmptyNodes: boolean
    hideOOL: boolean
    hideCleared: boolean
    noTransit: boolean
    showScouts: boolean
  }

  function createDB(name: string): Promise<Db>
  var db: Db

  interface Window {
    db: Db
  }

  /** Logging globals installed via `Object.assign(window, console)` in index.html. */
  function error(...args: unknown[]): void
  function warn(...args: unknown[]): void

  /** File System Access API helper from a.js (not part of this checkout). */
  var a: {
    getfileperms(handle: FileSystemHandle): Promise<PermissionState>
  }

  function showOpenFilePicker(options?: {
    types?: {
      description: string
      accept: Record<string, string[]>
    }[]
    excludeAcceptAllOption?: boolean
    multiple?: boolean
  }): Promise<FileSystemFileHandle[]>

  function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>
}
