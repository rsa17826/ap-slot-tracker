/**
 * Minimal client for the Cheese Trackers API
 * (cheesetrackers.theincrediblewheelofchee.se), used to link an AP slot to
 * its tracker game and toggle its availability status ("BK") from here.
 *
 * We deliberately avoid hard-coding the exact spelling of status enum
 * values (e.g. whether "BK" is serialized as "bk", "Bk", "go_with_the_flow",
 * etc). Instead we read the real values back from GET /tracker/{id} and let
 * the user pick which one means BK, once, when linking a slot.
 */
const CT_BASE =
  "https://cheesetrackers.theincrediblewheelofchee.se/api"

/** Accepts a full tracker URL, "tracker/AAA", or a bare "AAA" id. */
function ctParseTrackerId(input) {
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

async function ctRequest(
  path,
  { method = "GET", apiKey, body, headers } = {},
) {
  // GM_xmlhttpRequest (via the globalrequest wrapper) runs outside the
  // page's fetch/XHR sandbox, so it isn't subject to CORS the way a normal
  // fetch() call is — needed since the Cheese Trackers API doesn't send
  // CORS headers permitting cross-origin browser requests.
  let res
  try {
    res = await globalrequest(`${CT_BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(headers || {}),
      },
      data: body ? JSON.stringify(body) : undefined,
    })
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

function ctGetTracker(trackerId) {
  return ctRequest(`/tracker/${encodeURIComponent(trackerId)}`)
}

function ctUpdateGame(
  trackerId,
  gameId,
  apiKey,
  gameUpdate,
  ownerCondition,
) {
  return ctRequest(
    `/tracker/${encodeURIComponent(trackerId)}/game/${gameId}`,
    {
      method: "PUT",
      apiKey,
      body: gameUpdate,
      headers:
        ownerCondition ?
          { "x-if-owner-is": JSON.stringify(ownerCondition) }
        : undefined,
    },
  )
}

/** Best-effort auto-match of a tracker's games to an AP slot's player+game. */
function ctGuessGame(games, playerName, apGameName) {
  const target = (playerName || "").trim().toLowerCase()
  if (!target) return null
  const norm = (s) =>
    (s || "").trim().toLowerCase().replace(/\s+/g, "")

  const nameMatches = games.filter(
    (g) => (g.name || "").trim().toLowerCase() === target,
  )
  if (nameMatches.length <= 1) return nameMatches[0] || null

  // Multiple games share this slot name (e.g. same name used across
  // different tracked rooms) — narrow down using the AP game name too.
  const gameTarget = norm(apGameName)
  return (
    nameMatches.find((g) => norm(g.game) === gameTarget) ||
    nameMatches[0]
  )
}

/** The literal progression_status value that means "blocked/BK". */
const CT_BK_VALUE = "bk"
const CT_NONBK_VALUE = "unblocked"

function ctNowTimestamp() {
  return new Date().toISOString()
}

/**
 * Builds a full UpdateGameRequest body from a freshly-fetched game object,
 * changing only progression_status. The server requires the complete
 * object on every PUT, and requires the claim fields (claimed_by_ct_user_id
 * / discord_username) to stay untouched unless an x-if-owner-is precondition
 * is sent — so we always echo them back unchanged here.
 */
function ctBuildUpdatePayload(game, newProgressionStatus) {
  return {
    claimed_by_ct_user_id: game.claimed_by_ct_user_id ?? null,
    discord_username: game.discord_username ?? null,
    discord_ping: game.discord_ping,
    availability_status: game.availability_status,
    completion_status: game.completion_status,
    progression_status: newProgressionStatus,
    last_checked: ctNowTimestamp(),
    notes: game.notes ?? "",
  }
}

/**
 * Sets or clears BK for a linked slot. Refetches the tracker first so we
 * both avoid clobbering a status someone else set in the meantime, and know
 * the exact prior value to restore when clearing BK.
 */
async function ctSetBk(conn, toBk) {
  const ct = conn.ct
  const apiKey = window.db?.ctApiKey
  if (!ct?.trackerId || ct?.gameId == null) {
    throw new Error("Slot isn't linked to a Cheese Tracker game yet")
  }
  if (!apiKey) {
    throw new Error("Set your Cheese Trackers API key above first")
  }

  const tracker = await ctGetTracker(ct.trackerId)
  const game = tracker.games.find((g) => g.id === ct.gameId)
  if (!game)
    throw new Error("That game no longer exists on the tracker")

  let nextStatus = toBk ? CT_BK_VALUE : CT_NONBK_VALUE
  if (game.progression_status !== nextStatus) {
    return ctUpdateGame(
      ct.trackerId,
      ct.gameId,
      apiKey,
      ctBuildUpdatePayload(game, nextStatus),
    )
  }
}
