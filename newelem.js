function newelem(type, data = {}, inside = []) {
  const isSVG = type === "svg"

  const elem =
    isSVG ?
      document.createElementNS("http://www.w3.org/2000/svg", type)
    : document.createElement(type)

  /* -------------------------
     CLASS (string | array)
  ------------------------- */
  if (data.class) {
    const classes =
      Array.isArray(data.class) ?
        data.class
      : String(data.class).split(/\s+/)
    classes.filter(Boolean).forEach((c) => elem.classList.add(c))
    delete data.class
  }

  /* -------------------------
     DATASET
  ------------------------- */
  if (data.dataset && typeof data.dataset === "object") {
    Object.assign(elem.dataset, data.dataset)
    delete data.dataset
  }

  /* -------------------------
     STYLE
  ------------------------- */
  if (data.style && typeof data.style === "object") {
    Object.assign(elem.style, data.style)
    delete data.style
  } else {
    Object.assign(elem.style, data)
  }

  // /* -------------------------
  //    EVENTS (onClick → click)
  // ------------------------- */
  // Object.keys(data).forEach((key) => {
  //   if (key.startsWith("on") && typeof data[key] === "function") {
  //     const event = key.slice(2).toLowerCase()
  //     elem.addEventListener(event, data[key])
  //     delete data[key]
  //   }
  // })

  /* -------------------------
     REMAINING PROPS
  ------------------------- */
  Object.entries(data).forEach(([key, value]) => {
    if (key in elem) {
      elem[key] = value
    } else {
      elem.setAttribute(key, value)
    }
  })

  /* -------------------------
     CHILDREN (batched)
  ------------------------- */
  if (inside.length) {
    const frag = document.createDocumentFragment()
    inside.flat().forEach((child) => {
      if (child == null) return
      if (typeof child === "string" || typeof child === "number") {
        frag.appendChild(document.createTextNode(String(child)))
      } else {
        frag.appendChild(child)
      }
    })
    elem.appendChild(frag)
  }
  return elem
}
