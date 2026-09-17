/**
 * Client for the Cheese Trackers API
 * (cheesetrackers.theincrediblewheelofchee.se), used to link an AP slot to
 * its tracker game and toggle its availability status ("BK") from here.
 *
 * We deliberately avoid hard-coding the exact spelling of status enum
 * values (e.g. whether "BK" is serialized as "bk", "Bk", "go_with_the_flow",
 * etc). Instead we read the real values back from GET /tracker/{id} and let
 * the user pick which one means BK, once, when linking a slot.
 */
// @ts-ignore
class CheeseTrackersClient {
  static BASE =
    "https://cheesetrackers.theincrediblewheelofchee.se/api"
  /** The literal progression_status value that means "blocked/BK". */
  static BK_VALUE = "bk"
  static NONBK_VALUE = "unblocked"

  /**
   * Accepts a full tracker URL, "tracker/AAA", or a bare "AAA" id.
   * @param {any} input
   */
  static parseTrackerId(input) {
    const raw = (input || "").trim()
    if (!raw) return ""
    try {
      const u = new URL(raw)
      const parts = u.pathname.split("/").filter(Boolean)
      return parts[parts.length - 1] || ""
    } catch (e) {
      const parts = raw.split("/").filter(Boolean)
      return parts[parts.length - 1] || ""
    }
  }

  /**
   * Best-effort auto-match of a tracker's games to an AP slot's player+game.
   * @param {any[]} games
   * @param {string} playerName
   * @param {string} apGameName
   */
  static guessGame(games, playerName, apGameName) {
    const target = (playerName || "").trim().toLowerCase()
    if (!target) return null
    const norm = (/** @type {any} */ s) =>
      (s || "").trim().toLowerCase().replace(/\s+/g, "")

    const nameMatches = games.filter(
      (/** @type {{ name: any; }} */ g) =>
        (g.name || "").trim().toLowerCase() === target,
    )
    if (nameMatches.length <= 1) return nameMatches[0] || null

    // Multiple games share this slot name (e.g. same name used across
    // different tracked rooms) — narrow down using the AP game name too.
    const gameTarget = norm(apGameName)
    return (
      nameMatches.find(
        (/** @type {{ game: any; }} */ g) =>
          norm(g.game) === gameTarget,
      ) || nameMatches[0]
    )
  }

  static nowTimestamp() {
    return new Date().toISOString()
  }

  /**
   * Builds a full UpdateGameRequest body from a freshly-fetched game object,
   * changing only progression_status. The server requires the complete
   * object on every PUT, and requires the claim fields (claimed_by_ct_user_id
   * / discord_username) to stay untouched unless an x-if-owner-is precondition
   * is sent — so we always echo them back unchanged here.
   * @param {{ claimed_by_ct_user_id: any; discord_username: any; discord_ping: any; availability_status: any; completion_status: any; notes: any; id: any; tracker_id: any; position: any; name: any; game: any; tracker_status: any; checks_done: any; checks_total: any; last_activity: any; effective_discord_username: any; user_is_away: any; }} game
   * @param {string} newProgressionStatus
   */
  static buildUpdatePayload(game, newProgressionStatus) {
    return {
      claimed_by_ct_user_id: game.claimed_by_ct_user_id ?? null,
      discord_username: game.discord_username ?? null,
      discord_ping: game.discord_ping,
      availability_status: game.availability_status,
      completion_status: game.completion_status,
      progression_status: newProgressionStatus,
      last_checked: CheeseTrackersClient.nowTimestamp(),
      notes: game.notes ?? "",
      id: game.id,
      tracker_id: game.tracker_id,
      position: game.position,
      name: game.name,
      game: game.game,
      tracker_status: game.tracker_status,
      checks_done: game.checks_done,
      checks_total: game.checks_total,
      last_activity: game.last_activity,
      effective_discord_username: game.effective_discord_username,
      user_is_away: game.user_is_away,
      $newnotes: "",
    }
  }

  /**
   * @param {string} apiKey - Cheese Trackers API key, used to authorize PUTs.
   *   Read fresh off window.db.ctApiKey by callers, since the key can change
   *   at any time while slots stay linked.
   */
  constructor(apiKey) {
    this.apiKey = apiKey
  }

  /**
   * @param {string} path
   */
  // @ts-ignore
  async request(path, { method = "GET", body, headers } = {}) {
    // GM_xmlhttpRequest (via the globalrequest wrapper) runs outside the
    // page's fetch/XHR sandbox, so it isn't subject to CORS the way a normal
    // fetch() call is — needed since the Cheese Trackers API doesn't send
    // CORS headers permitting cross-origin browser requests.
    let res
    try {
      // @ts-ignore
      res = await globalrequest(
        `${CheeseTrackersClient.BASE}${path}`,
        {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(this.apiKey ?
              { Authorization: `Bearer ${this.apiKey}` }
            : {}),
            ...(headers || {}),
          },
          data: body ? JSON.stringify(body) : undefined,
        },
      )
    } catch (e) {
      throw new Error(
        `Could not reach Cheese Trackers: ${e.message || e}`,
      )
    }

    const status = res.status
    if (status < 200 || status >= 300) {
      throw new Error(
        `Cheese Trackers ${method} ${path} failed: HTTP ${status}${res.text ? " — " + res.text : ""}`,
      )
    }
    if (status === 204 || !res.text) return null
    try {
      return JSON.parse(res.text)
    } catch (e) {
      throw new Error(
        `Cheese Trackers ${method} ${path}: bad JSON response`,
      )
    }
  }

  /**
   * @param {string | number | boolean} trackerId
   */
  getTracker(trackerId) {
    return this.request(`/tracker/${encodeURIComponent(trackerId)}`)
  }

  /**
   * @param {string | number | boolean} trackerId
   * @param {any} gameId
   * @param {{ claimed_by_ct_user_id: any; discord_username: any; discord_ping: any; availability_status: any; completion_status: any; progression_status: any; last_checked: string; notes: any; id: any; tracker_id: any; position: any; name: any; game: any; tracker_status: any; checks_done: any; checks_total: any; last_activity: any; effective_discord_username: any; user_is_away: any; $newnotes: string; }} gameUpdate
   * @param {undefined} [ownerCondition]
   */
  updateGame(trackerId, gameId, gameUpdate, ownerCondition) {
    return this.request(
      `/tracker/${encodeURIComponent(trackerId)}/game/${gameId}`,
      {
        method: "PUT",
        // @ts-ignore
        body: gameUpdate,
        headers:
          ownerCondition ?
            { "x-if-owner-is": JSON.stringify(ownerCondition) }
          : undefined,
      },
    )
  }

  /**
   * Sets or clears BK for a linked slot. Refetches the tracker first so we
   * both avoid clobbering a status someone else set in the meantime, and know
   * the exact prior value to restore when clearing BK.
   * @param {SlotConnection} conn
   * @param {boolean} toBk
   */
  async setBk(conn, toBk, shouldRefreshBkTimer = false) {
    const ct = conn.ct
    if (!ct?.trackerId || ct?.gameId == null) {
      throw new Error(
        "Slot isn't linked to a Cheese Tracker game yet",
      )
    }
    if (!this.apiKey) {
      throw new Error("Set your Cheese Trackers API key above first")
    }

    const tracker = await this.getTracker(ct.trackerId)
    const game = tracker.games.find(
      (/** @type {{ id: any; }} */ g) => g.id === ct.gameId,
    )
    if (!game)
      throw new Error("That game no longer exists on the tracker")

    const nextStatus =
      toBk ?
        CheeseTrackersClient.BK_VALUE
      : CheeseTrackersClient.NONBK_VALUE
    // NOTE allow still bk to update timestamp
    // TODO maybe good to also auto do if >1d?
    if (
      game.progression_status !== nextStatus ||
      (nextStatus === CheeseTrackersClient.BK_VALUE &&
        shouldRefreshBkTimer)
    ) {
      return this.updateGame(
        ct.trackerId,
        ct.gameId,
        CheeseTrackersClient.buildUpdatePayload(game, nextStatus),
      )
    }
  }
}
