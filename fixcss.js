const fs = require("fs")
const postcss = require("postcss")

const autoNestPlugin = () => {
  return {
    postcssPlugin: "auto-nest",
    Once(root) {
      let changed = true

      // Keep looping until the tree is fully collapsed
      while (changed) {
        changed = false
        const rules = []

        // Only evaluate top-level rules in the current pass
        root.each((node) => {
          if (node.type === "rule") {
            rules.push(node)
          }
        })

        // Sort by length descending to match deepest/longest selectors first
        // (e.g., handles .loc-row.event.reachable BEFORE .loc-row.event)
        rules.sort((a, b) => b.selector.length - a.selector.length)

        for (const childRule of rules) {
          const childSel = childRule.selector

          let bestParent = null
          let bestParentLength = 0
          let nestedSelector = ""

          for (const parentRule of rules) {
            if (childRule === parentRule) continue

            const parentSel = parentRule.selector

            // We want the longest matching prefix parent
            if (parentSel.length <= bestParentLength) continue

            // Direct descendant match (e.g., ".loc-row .ck" -> ".loc-row")
            if (childSel.startsWith(parentSel + " ")) {
              bestParent = parentRule
              bestParentLength = parentSel.length
              nestedSelector = childSel.slice(parentSel.length).trim()
            }
            // Modifier match (e.g., ".loc-row.event" -> ".loc-row")
            else if (
              childSel.startsWith(parentSel) &&
              childSel.length > parentSel.length
            ) {
              const suffix = childSel.slice(parentSel.length)
              // Ensure it's a real modifier, not just a similarly named class (e.g. .loc-row-container)
              if ([".", ":", "["].includes(suffix[0])) {
                bestParent = parentRule
                bestParentLength = parentSel.length
                nestedSelector = "&" + suffix
              }
            }
          }

          if (bestParent) {
            childRule.selector = nestedSelector
            bestParent.append(childRule)
            changed = true
            break // Break and restart the tree evaluation safely
          }
        }
      }
    },
  }
}
autoNestPlugin.postcss = true

const dedupePlugin = () => {
  return {
    postcssPlugin: "dedupe-props",
    Rule(rule) {
      const seenProps = new Map()
      rule.each((node) => {
        if (node.type === "decl") {
          if (seenProps.has(node.prop)) {
            seenProps.get(node.prop).remove()
          }
          seenProps.set(node.prop, node)
        }
      })
    },
  }
}
dedupePlugin.postcss = true

for (let filePath of process.argv.slice(2)) {
  const css = fs.readFileSync(filePath, "utf8")

  // Notice postcssNested is removed. We don't want to un-nest our hard work!
  postcss([autoNestPlugin(), dedupePlugin()])
    .process(css, { from: filePath, to: filePath })
    .then((result) => {
      fs.writeFileSync(filePath, result.css)
      console.log(
        `Successfully processed and fully nested ${filePath}`,
      )
    })
    .catch((err) => {
      console.error(err, filePath)
    })
}
