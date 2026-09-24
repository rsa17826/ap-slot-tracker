class RequirementGroups {
  // Converts a location's rule tree into human-readable OR-of-AND requirement chips, and re-runs progression/reachability whenever a slot's inventory or checks change.

  // ---------------------------------------------------------------------
  // Rule -> requirement groups
  // Converts a location's rule tree (same shape RuleEngine.evalRule() in index.html
  // understands) into an OR-of-AND list of human-readable requirement
  // tokens, e.g. [["Bow"], ["Boomerang", "Hookshot"]] meaning "Bow, OR
  // Boomerang+Hookshot". Used to show *why* a check is currently obtainable
  // in the same via/or chip format progression_overlay.js used for the old
  // PROG-array format.
  // ---------------------------------------------------------------------
  static RULE_GROUP_CAP = 8 // max OR-groups to keep per rule, avoids blowup on big And-of-Or trees
  static AND_GROUP_CAP = 6 // max AND-members to keep per group

  static itemToken(name, count) {
    return count && count > 1 ? `${name} x${count}` : name
  }

  static capGroups(groups) {
    return groups.slice(0, RequirementGroups.RULE_GROUP_CAP)
  }

  static mergeGroups(a, b) {
    // cross product for And: every combination of one group from `a` with
    // one group from `b`, capped so nested Ands of large Ors can't explode.
    const out = []
    for (const ga of a) {
      for (const gb of b) {
        out.push(
          [...ga, ...gb].slice(0, RequirementGroups.AND_GROUP_CAP),
        )
        if (out.length >= RequirementGroups.RULE_GROUP_CAP) return out
      }
    }
    return out
  }

  static ruleToGroups(rule) {
    if (rule === null || rule === undefined) return [[]]
    if (typeof rule === "boolean") return rule ? [[]] : []
    switch (rule.type) {
      case "True_":
        return [[]]
      case "False_":
        return []
      case "Has":
        return [
          [RequirementGroups.itemToken(rule.item_name, rule.count)],
        ]
      case "HasAll":
        return [
          rule.item_names.map((n) => RequirementGroups.itemToken(n)),
        ]
      case "HasAny":
        return RequirementGroups.capGroups(
          rule.item_names.map((n) => [
            RequirementGroups.itemToken(n),
          ]),
        )
      case "HasAllCounts": {
        return [
          rule.item_counts.map(([n, c]) =>
            RequirementGroups.itemToken(n, c),
          ),
        ]
      }
      case "HasAnyCount": {
        return RequirementGroups.capGroups(
          rule.item_names.map(([name, need]) => [
            RequirementGroups.itemToken(name, need),
          ]),
        )
      }
      // case "HasFromList":
      // case "HasFromListUnique": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const names = rule.item_names || rule.items || []
      //   return [[`${need} of: ${names.join(", ")}`]]
      // }
      // case "HasGroup":
      // case "HasGroupUnique": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const groupItems = rule.items || rule.group_items || []
      //   return [[`${need} of: ${groupItems.join(", ")}`]]
      // }
      case "And": {
        return RequirementGroups.capGroups(
          rule.children.reduce(
            (acc, r) =>
              RequirementGroups.mergeGroups(
                acc,
                RequirementGroups.ruleToGroups(r),
              ),
            [[]],
          ),
        )
      }
      case "Or": {
        return RequirementGroups.capGroups(
          rule.children.flatMap((r) =>
            RequirementGroups.ruleToGroups(r),
          ),
        )
      }
      // case "AtLeast": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const subs = rule.rules || rule.sub_rules || rule.children || []
      //   return [
      //     [
      //       `${need} of: ${subs
      //         .map((r) => RequirementGroups.ruleToGroups(r)[0]?.join("+") ?? "?")
      //         .join(", ")}`,
      //     ],
      //   ]
      // }
      // case "Filtered":
      // case "WrapperRule":
      //   return RequirementGroups.ruleToGroups(rule.rule || rule.wrapped || rule.sub_rule)
      case "CanReachRegion":
        return [[`reach: ${rule.region_name || rule.name}`]]
      case "CanReachLocation":
        return [[`reach: ${rule.location_name || rule.name}`]]
      case "CanReachEntrance":
        return [[`reach: ${rule.entrance_name || rule.name}`]]
      default:
        return [[]] // permissive fallback, matches RuleEngine.evalRule's default case
    }
  }

  // A group's tokens are plain item/flag names (optionally "Name xN"), or
  // unverifiable forms like "N of: ..." / "reach: ...". We only drop a group
  // when every token in it is a plain item/flag we can check against
  // receivedCounts and it's NOT satisfied. Unverifiable tokens are left in
  // (we can't confirm or deny them from receivedCounts alone), so filtering
  // never hides a group we're unsure about.
  static tokenOwned(token, receivedCounts) {
    const m = token.match(/^(.+) x(\d+)$/)
    const name = m ? m[1] : token
    const count = m ? parseInt(m[2], 10) : 1
    return (receivedCounts[name] ?? 0) >= count
  }

  static tokenVerifiable(token) {
    return !token.startsWith("reach: ") && !token.includes(" of: ")
  }

  static filterGroupsByOwned(groups, receivedCounts) {
    return groups.filter((group) =>
      group.every(
        (tok) =>
          !RequirementGroups.tokenVerifiable(tok) ||
          RequirementGroups.tokenOwned(tok, receivedCounts),
      ),
    )
  }

  // Counts actually available to logic: received items plus flags/items
  // auto-granted by reachable event locations (e.g. "flag:beat stage1").
  // Only called once obtainable locations exist, which means
  // RequirementGroups.maybeRecomputeProgression has already run and set rt.eventInventory.
  static ownedCounts(rt) {
    const out = { ...rt.receivedCounts }
    for (const [name, count] of Object.entries(rt.eventInventory)) {
      out[name] = (out[name] || 0) + count
    }
    return out
  }

  static requirementGroupsFor(graph, locationName, receivedCounts) {
    const linfo = graph.locations[locationName]
    const groups = RequirementGroups.ruleToGroups(linfo.rule)
    return RequirementGroups.filterGroupsByOwned(
      groups,
      receivedCounts,
    )
  }

  static itemChip(text) {
    return newelem(
      "span",
      {
        display: "inline-block",
        padding: "1px 5px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: "500",
        margin: "1px 2px 1px 0",
        background: "#3b82f61a",
        color: "#3b82f6",
        border: "1px solid #3b82f640",
        whiteSpace: "nowrap",
      },
      [text],
    )
  }

  static checkRow(locationName, groups) {
    const row = newelem("div", {
      class: "row",
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      padding: "2px 0",
    })
    row.appendChild(
      newelem("div", { fontSize: "13px" }, [locationName]),
    )
    if (groups.length > 0) {
      const viaWrap = newelem("div", {
        display: "flex",
        flexDirection: "column",
        gap: "1px",
      })
      groups.forEach((group, idx) => {
        const groupRow = newelem("div", {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1px",
        })
        groupRow.appendChild(
          newelem(
            "span",
            {
              fontSize: "10px",
              color: "#6b7280",
              marginRight: "2px",
            },
            [idx === 0 ? "via:" : "or:"],
          ),
        )
        if (group.length === 0) {
          groupRow.appendChild(
            RequirementGroups.itemChip("(no requirements)"),
          )
        } else {
          group.forEach((tok) =>
            groupRow.appendChild(RequirementGroups.itemChip(tok)),
          )
        }
        viaWrap.appendChild(groupRow)
      })
      row.appendChild(viaWrap)
    }
    return row
  }

  static maybeRecomputeProgression(conn, rt) {
    const graph = ProgKeys.progForGame(conn.progKey, conn.profile)
    if (!graph) return
    const checkedNames = ProgKeys.checkedLocationNames(conn, rt)
    const { locations, eventInventory } =
      MapEngine.computeReachablePure(
        graph,
        rt.receivedCounts,
        checkedNames,
      )
    rt.eventInventory = eventInventory
    rt.prevObtainable = new Set(
      [...locations].filter(
        (l) => !checkedNames[l] && ProgKeys.isRealLocation(graph, l),
      ),
    )
    // Locations just got checked off (possibly clearing the last obtainable
    // one) -- re-sync BK status to match.
    SlotsUI.renderSlots()
  }
}
