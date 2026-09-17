class RuleEngine {
  // Shared rule-tree evaluator (RuleEngine.evalRule) used by both the live UI reachability pass and the headless MapEngine pass.

  static evalRule(rule, ctx) {
    const { countHave, reach, warnOnce } = ctx
    if (rule === null || rule === undefined) return true
    if (typeof rule === "boolean") return rule
    const t = rule.type
    switch (t) {
      case "True_":
        return true
      case "False_":
        return false
      case "Has":
        return countHave(rule.item_name) >= (rule.count ?? 1)
      case "HasAll":
        return rule.item_names.every((n) => countHave(n) >= 1)
      case "HasAny":
        return rule.item_names.some((n) => countHave(n) >= 1)
      case "HasAllCounts": {
        return rule.item_counts.every(([n, c]) => countHave(n) >= c)
      }
      case "HasAnyCount": {
        return rule.item_counts.some(
          ([name, need]) => countHave(name) >= need,
        )
      }
      // case "HasFromList": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const names = rule.item_names || rule.items || []
      //   const have = names.reduce(
      //     (s, n) => s + (countHave(n) > 0 ? 1 : 0),
      //     0,
      //   )
      //   return have >= need
      // }
      // case "HasFromListUnique": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const names = rule.item_names || rule.items || []
      //   return (
      //     names.filter((n) => countHave(n) > 0).length >= need
      //   )
      // }
      // case "HasGroup": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const groupItems = rule.items || rule.group_items || []
      //   return (
      //     groupItems.reduce((s, n) => s + countHave(n), 0) >= need
      //   )
      // }
      // case "HasGroupUnique": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const groupItems = rule.items || rule.group_items || []
      //   return (
      //     groupItems.filter((n) => countHave(n) > 0).length >=
      //     need
      //   )
      // }
      case "And":
        return rule.children.every((r) => RuleEngine.evalRule(r, ctx))
      case "Or":
        return rule.children.some((r) => RuleEngine.evalRule(r, ctx))
      // case "AtLeast": {
      //   debugger
      //   const need = rule.count ?? 1
      //   const subs =
      //     rule.rules || rule.sub_rules || rule.children || []
      //   return subs.filter((r) => RuleEngine.evalRule(r, ctx)).length >= need
      // }
      // case "Filtered":
      // case "WrapperRule":
      //   debugger
      //   return RuleEngine.evalRule(
      //     rule.rule || rule.wrapped || rule.sub_rule,
      //     ctx,
      //   )
      // case "CanReachRegion":
      //   debugger
      //   return reach.regions.has(rule.region_name || rule.name)
      // case "CanReachLocation":
      //   debugger
      //   return reach.locations.has(
      //     rule.location_name || rule.name,
      //   )
      // case "CanReachEntrance":
      //   debugger
      //   return reach.entrances.has(
      //     rule.entrance_name || rule.name,
      //   )
      default:
        if (warnOnce) warnOnce(t, JSON.stringify(rule))
        return true // permissive fallback for unrecognized/unserializable rule shapes
    }
  }
}
