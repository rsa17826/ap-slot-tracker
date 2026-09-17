const fs = require("fs")
const postcss = require("postcss")

const autoNestPlugin = () => {
  return {
    postcssPlugin: "auto-nest",
    Once(root) {
      let changed = true

      while (changed) {
        changed = false
        const rules = []

        // Grab only top-level rules in the current pass
        root.each((node) => {
          if (node.type === "rule") {
            rules.push(node)
          }
        })

        // Sort by selector length to match longest/deepest selectors first
        rules.sort((a, b) => b.selector.length - a.selector.length)

        for (const childRule of rules) {
          let bestParent = null
          let bestParentLength = 0
          let bestNestedSelector = ""

          // Parse comma-separated lists into arrays
          const childSels = childRule.selectors.map((s) => s.trim())

          for (const parentRule of rules) {
            if (childRule === parentRule) continue

            const parentSels = parentRule.selectors.map((s) =>
              s.trim(),
            )
            if (parentRule.selector.length <= bestParentLength)
              continue

            let nestedSelector = null

            // CASE 1: Single Parent Class -> Multi Child Classes
            // (e.g., .parent -> .parent .a, .parent .b)
            if (parentSels.length === 1) {
              const p = parentSels[0]
              let innerSels = []
              let valid = true

              for (const c of childSels) {
                if (c.startsWith(p + " ")) {
                  innerSels.push(c.slice(p.length).trim())
                } else if (
                  c.startsWith(p) &&
                  c.length > p.length &&
                  [".", ":", "["].includes(c[p.length])
                ) {
                  innerSels.push("&" + c.slice(p.length))
                } else {
                  valid = false
                  break
                }
              }

              if (valid && innerSels.length > 0) {
                nestedSelector = innerSels.join(", ")
              }
            }
            // CASE 2: Multi Parent Class -> Multi Child Class
            // (e.g., .a, .b -> .a:hover, .b:hover)
            else if (
              parentSels.length > 1 &&
              parentSels.length === childSels.length
            ) {
              // Sort arrays alphabetically so order doesn't matter (e.g., .a, .b matches .b:hover, .a:hover)
              const pSorted = [...parentSels].sort()
              const cSorted = [...childSels].sort()

              let commonSuffix = null
              let valid = true

              for (let i = 0; i < pSorted.length; i++) {
                const p = pSorted[i]
                const c = cSorted[i]

                if (c.startsWith(p) && c.length > p.length) {
                  const suffix = c.slice(p.length)
                  if (commonSuffix === null) {
                    commonSuffix = suffix
                  } else if (commonSuffix !== suffix) {
                    valid = false // Suffixes don't perfectly match across all comma items
                    break
                  }
                } else {
                  valid = false
                  break
                }
              }

              if (valid && commonSuffix) {
                if (commonSuffix.startsWith(" ")) {
                  nestedSelector = commonSuffix.trim()
                } else if (
                  [".", ":", "["].includes(commonSuffix[0])
                ) {
                  nestedSelector = "&" + commonSuffix
                }
              }
            }

            if (nestedSelector) {
              bestParent = parentRule
              bestParentLength = parentRule.selector.length
              bestNestedSelector = nestedSelector
            }
          }

          if (bestParent) {
            childRule.selector = bestNestedSelector
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

// Skip 'node' and 'fixcss.js' in the arguments to prevent it from parsing itself!
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("Please provide file paths.")
  process.exit(1)
}

for (let filePath of files) {
  const css = fs.readFileSync(filePath, "utf8")

  postcss([autoNestPlugin(), dedupePlugin()])
    .process(css, { from: filePath, to: filePath })
    .then((result) => {
      fs.writeFileSync(filePath, result.css)
      console.log(
        `Successfully processed and fully nested ${filePath}`,
      )
    })
    .catch((err) => {
      console.error(err)
    })
}
