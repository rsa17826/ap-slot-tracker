/**
 * Parses a progression file's source text into a PROG array. A prog file is
 * expected to define `PROG` (const/let/var/window.PROG =) as an array of
 * { room, requires: [[token,...],...], receive: [token,...] } nodes, using
 * the same "kind:name" token convention as progression_overlay.js
 * (move:, level:, flag:, star:, achievement:, ...).
 */
function parseProgSource(source) {
  // Wrapped in its own function scope (not "use strict" at top level) so a
  // `const/let PROG = ...` inside the uploaded file doesn't collide with
  // anything here. We read the result back off `this.PROG` in case the file
  // used `var`/bare assignment, and fall back to a local PROG declared by
  // the file itself via the returned completion value.
  const fn = new Function(`
    ${source}
    try { return PROG; } catch (e) { return undefined; }
  `)
  const prog = fn()
  if (!Array.isArray(prog)) throw new Error("PROG must be an array")
  return prog
}

function kindOf(token) {
  return token.split(":")[0]
}

function requiresSatisfied(requires, owned) {
  if (!requires || requires.length === 0) return true
  return requires.some((group) => group.every((tok) => owned.has(tok)))
}

function locationIdFor(slotData, room, token) {
  try {
    return slotData.AP_LOCATION_IDS[`${room} - ${token}`]
  } catch (e) {
    return undefined
  }
}

function isChecked(slotData, checkedSet, room, token) {
  const id = locationIdFor(slotData, room, token)
  if (id === undefined) return false
  return checkedSet.has(id)
}

/**
 * Builds the "owned" token set for a slot: every item name we've actually
 * received (matched 1:1 against the token vocabulary), plus flag tokens
 * whose associated location has been checked.
 */
function ownedFromSlot(prog, receivedNames, slotData, checkedLocations) {
  const owned = new Set(receivedNames)
  const checkedSet = new Set(checkedLocations || [])
  prog.forEach((node) => {
    ;(node.receive || []).forEach((tok) => {
      if (kindOf(tok) === "flag" && isChecked(slotData, checkedSet, node.room, tok)) {
        owned.add(tok)
      }
    })
  })
  return owned
}

/**
 * Mirrors progression_overlay.js's render(): the list of not-yet-checked,
 * currently-reachable receive tokens. Returned as a Set of "room|token"
 * strings so callers can diff two snapshots cheaply.
 */
function obtainableNow(prog, owned, slotData, checkedLocations) {
  const checkedSet = new Set(checkedLocations || [])
  const rows = new Set()
  prog.forEach((node) => {
    if (!requiresSatisfied(node.requires, owned)) return
    ;(node.receive || []).forEach((token) => {
      if (kindOf(token) === "flag") return
      if (isChecked(slotData, checkedSet, node.room, token)) return
      if (node.room !== "hub" && !owned.has(`level:${node.room}`)) return
      rows.add(`${node.room}|${token}`)
    })
  })
  return rows
}

window.ProgLib = {
  parseProgSource,
  kindOf,
  requiresSatisfied,
  ownedFromSlot,
  obtainableNow,
}
