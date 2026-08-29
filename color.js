const fs = require("fs")
const path = require("path")

function generateRandomName() {
  const chars = "abcdefghijklmnopqrstuvwxyz"
  let result = "color-"
  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function processCSSFiles(filePaths) {
  const colorMap = new Map() // colorValue -> varName
  const colorRegex =
    /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/g

  // Process each file, replace colors, and save in place
  filePaths.forEach((filePath) => {
    let content = fs.readFileSync(filePath, "utf8")

    content = content.replace(colorRegex, (match) => {
      const normalizedColor = match.toLowerCase()
      if (colorMap.has(normalizedColor)) {
        return `var(--${colorMap.get(normalizedColor)})`
      } else {
        let varName = generateRandomName()
        while ([...colorMap.values()].includes(varName)) {
          varName = generateRandomName()
        }
        colorMap.set(normalizedColor, varName)
        return `var(--${varName})`
      }
    })

    // Overwrite original file in place
    fs.writeFileSync(filePath, content, "utf8")
  })

  // Build the :root block containing only the extracted color variables
  let rootContent = ":root {\n"
  colorMap.forEach((varName, colorValue) => {
    rootContent += `  --${varName}: ${colorValue};\n`
  })
  rootContent += "}\n"

  // Write only the variables block to ./colors.css
  fs.writeFileSync("./colors.css", rootContent, "utf8")
  console.log(
    "Original files updated in place and variables written to ./colors.css",
  )
}

const args = process.argv.slice(2)
if (args.length > 0) {
  processCSSFiles(args)
} else {
  console.log("Please provide paths to the CSS files as arguments.")
}
