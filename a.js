// ==UserScript==
// @name         lib:allfuncs
// @version      28
// @description  none
// @run-at       document-start
// @author       rssaromeo
// @license      AGPLv3
// @match        *://*/*
// @include      *
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAAXNSR0IB2cksfwAAAAlwSFlzAAAOxAAADsQBlSsOGwAAAHJQTFRFAAAAEIijAo2yAI60BYyuF4WaFIifAY6zBI2wB4usGIaZEYigIoiZCIyrE4igG4iYD4mjEomhFoedCoqpDIqnDomlBYyvE4efEYmiDYqlA42xBoytD4mkCYqqGYSUFYidC4qoC4upAo6yCoupDYqmCYur4zowOQAAACZ0Uk5TAO////9vr////1+/D/+/L+/Pf/////+f3///////H4////////+5G91rAAACgUlEQVR4nM2Y22KjIBCGidg1264liZqDadK03X3/V2wNKHMC7MpF/xthHD5mgERAqZhWhfYqH6K+Qf2qNNf625hCoFj9/gblMUi5q5jLkXLCKudgyiRm0FMK82cWJp1fLbV5VmvJbCIc0GCYaFqqlDJgADdBjncqAXYobm1xh72aFMflbysteFfdy2Yi1XGOm5HGBzQ1dq7TzEoxjeNTjQZb7VA3e1c7+ImgasAgQ9+xusNVNZIo5xmOMgihIS2PbCQIiHEUdTvhxCcS/kPomfFI2zHy2PkWmA6aNatIJpKFJyekyy02xh5Y3DI9T4aOT6VhIUrsNTFp1pf79Z4SIIVDegl6IJO6cHiL/GimIZDhgTu/BlYWCQzHMl0zBWT/T3KAhtxOuUB9FtBrpsz0RV4xsjHmW+UCaffcSy/5viMGer0/6HdFNMZBq/vjJL38H9Dqx4Fuy0Em12DbZy+9pGtiDijbglwAehyj11n0tRD3WUBm+lwulE/8h4BuA+iWAQQnteg2Xm63WQLTpnMnpjdge0Mgu/GRPsV4xdjQ94Lfi624fabhDkfUqIKNrM64Q837v8yL0prasepCgrtvw1sJpoqanGEX7b5mQboNW8eawXaWXTMfMGxub472hzWzHSn6Sg2G9+6TAyRruE71s+zAzjWaknoyJCQzwxrghH2k5FDT4eqWunuNxyN9QCGcxVod5oADbYnIUkDTGZEf1xDJnSFteQ3KdsT8zYDMQXcHxsevcLH1TrsABzkNPyA/L7b0jg704viMMlpQI96WsHknCt/3YH0kOEo9zcGkwrFK39ck72rmoehmKqo2RKlilzSy/nJKEV45CT38myJp456fezktHjN5aeMAAAAASUVORK5CYII=
// @grant        unsafeWindow
// @namespace https://greasyfork.org/users/1184528
// @downloadURL https://update.greasyfork.org/scripts/489763/lib%3Aallfuncs.user.js
// @updateURL https://update.greasyfork.org/scripts/489763/lib%3Aallfuncs.meta.js
// ==/UserScript==

class a {
  static wait(ms) {
    return new Promise(function (done) {
      var last = Date.now()
      setTimeout(() => done(Date.now() - last - ms), ms)
    })
  }
  static waituntil(q, cb) {
    return new Promise((resolve) => {
      var last = Date.now()
      var int = setInterval(
        function (q, cb) {
          if (!!q()) {
            clearInterval(int)
            try {
              cb(Date.now() - last)
            } catch (e) {}
            resolve(Date.now() - last)
          }
        },
        0,
        q,
        cb,
      )
    })
  }
  static keeponlyone(arr) {
    return [...new Set(arr)]
  }

  static matchall(x, y) {
    return [...x.matchAll(y)].map((e) =>
      e[1] !== undefined ? [...e] : e[0],
    )
  }
  static randfrom(min, max) {
    if (max === undefined)
      return min.length ? min[this(0, min.length - 1)] : this(0, min)
    if (min == max) return min
    if (max) return Math.round(Math.random() * (max - min)) + min
    return min[Math.round(Math.random() * (min.length - 1))]
  }
  static foreachobj(arr, func) {
    Reflect.ownKeys(arr).forEach((e, i) => {
      func(e, arr[e], i)
    })
  }
  static listen(elem, type, cb, istrue = false) {
    var all = []
    if (a.gettype(elem, "array")) {
      return [...elem].map(listen).flat()
    } else {
      return listen(elem)
    }
    function listen(elem) {
      if (a.gettype(type, "array")) {
        var temp = {}
        a.foreach(type, (e) => (temp[e] = cb))
        type = temp
      }
      if (a.gettype(type, "object")) {
        istrue = cb
        a.foreachobj(type, function (type, cb) {
          if (a.gettype(type, "string"))
            type = a.matchall(type, /[a-z]+/g)
          type.forEach((type) => {
            const newcb = function (...e) {
              cb.call(elem, ...e)
            }
            elem.addEventListener(type, newcb, istrue)
            all.push([elem, type, newcb, istrue])
          })
        })
      } else if (a.gettype(type, "string")) {
        type = a.matchall(type, /[a-z]+/g)
        type.forEach((type) => {
          const newcb = function (e) {
            cb.call(elem, e, type)
          }
          elem.addEventListener(type, newcb, istrue)
          all.push([elem, type, newcb, istrue])
        })
      }
      return all
    }
  }
  static unlisten(all) {
    for (var l of all) {
      l[0].removeEventListener(l[1], l[2], l[3])
    }
  }
  static toelem(elem, single) {
    if (a.gettype(elem, "element")) return elem
    switch (a.gettype(elem)) {
      case "string":
        return single ? a.qs(elem) : a.qsa(elem)
      case "array":
        return elem.map((elem) => {
          return a.toelem(elem, single)
        })
      case "object":
        var newobj = {
          ...elem,
        }
        if (single)
          return {
            [Object.keys(newobj)[0]]: a.toelem(
              newobj[Object.keys(newobj)[0]],
              single,
            ),
          }
        a.foreach(newobj, function (a, s) {
          newobj[a] = a.toelem(s)
        })
        return newobj
      default:
        error(elem, "inside [toelem] - not an element?")
        return undefined
    }
  }
  static geturlperams(e = location.href) {
    var arr = {}
    ;[
      ...e.matchAll(/[?&]([^&\s]+?)(?:=([^&\s]*?))?(?=&|$|\s)/g),
    ].forEach((e) => {
      if (e[1].includes("#")) arr["#"] = e[1].match(/#(.*$)/)[1]
      if (e[2].includes("#")) arr["#"] = e[2].match(/#(.*$)/)[1]
      e[1] = e[1].replace(/#.*$/, "")
      e[2] = e[2].replace(/#.*$/, "")
      arr[decodeURIComponent(e[1]).replaceAll("+", " ")] =
        e[2] === undefined ?
          undefined
        : decodeURIComponent(e[2]).replaceAll("+", " ")
    })
    return arr
  }
  static updateurlperam(key, value, cangoback) {
    var g = a.geturlperams()
    if (g[key] == value && !cangoback) return
    g[key] = value
    var k = ""
    var hash = ""
    a.foreach(g, function (key, value) {
      if (key == "#") return (hash = key + value)
      key = encodeURIComponent(key)
      value = encodeURIComponent(value)
      k += "&" + (value === undefined ? key : key + "=" + value)
    })
    k = k.replace("&", "?")
    k += hash
    cangoback ?
      history.pushState(null, null, k)
    : history.replaceState(null, null, k)
    return key
  }
  static rerange(val, low1, high1, low2, high2) {
    return ((val - low1) / (high1 - low1)) * (high2 - low2) + low2
  }
  static destring(inp) {
    var out = inp
    if (/^[\-0-9]+$/.test(inp)) return Number(inp)
    if (a.gettype((out = JSON.parse(inp)), "array")) return out
    if (
      a.gettype(
        (out = JSON.parse(
          inp.replaceAll("'", '"').replaceAll("`", '"'),
        )),
        "object",
      )
    )
      return out
    if (inp == "true") return true
    if (inp == "false") return false
    if (inp == "undefined") return undefined
    if (inp == "NaN") return NaN
    return inp
  }
  static eachelem(arr1, cb) {
    var arr = []
    var elem = []
    if (a.gettype(arr1, "array")) {
      arr1.foreach((e) => {
        elem = [...elem, ...(a.gettype(e, "string") ? a.qsa(e) : [e])]
      })
    } else {
      elem = a.gettype(arr1, "string") ? a.qsa(ar1) : [arr1]
    }
    elem = elem.filter((e) => {
      return e instanceof Element
    })
    elem.foreach(function (...a) {
      arr.push(cb(...a))
    })
    if (arr.length == 1) arr = arr[0]
    return arr
  }
  static remove(arr, idx, isidx) {
    arr = [...arr]
    idx = isidx ? idx : arr.indexOf(idx)
    if (idx < 0 || typeof idx !== "number") return arr
    arr.splice(idx, 1)
    return arr
  }
  static createelem(parent, elem, data = {}) {
    var type = elem
    var issvg =
      elem == "svg" || parent?.tagName?.toLowerCase?.() == "svg"
    elem =
      issvg ?
        document.createElementNS("http://www.w3.org/2000/svg", elem)
      : document.createElement(elem)
    if (data.class)
      data.class.split(" ").forEach((e) => {
        elem.classList.add(e)
      })
    if (data.options && type == "select")
      data.options = data.options.map((e) =>
        a.gettype(e, "array") ?
          a.createelem(elem, "option", {
            innerHTML: e[0],
            value: e[1],
          })
        : a.createelem(elem, "option", {
            innerHTML: e,
            value: e,
          }),
      )
    if (type == "label" && "for" in data) {
      data.htmlFor = data.for
    }
    Object.assign(elem.style, data)
    if (type == "select") {
      a.foreach(data, function (a, s) {
        elem[a] = s
      })
    } else if (issvg) {
      Object.keys(data).forEach((e) => (elem[e] = data[e]))
    } else {
      Object.assign(elem, data)
    }
    if (parent !== null) {
      if (typeof parent == "string") parent = a.qs(parent)
      parent.appendChild(elem)
    }
    return elem
  }
  static newelem(type, data = {}, inside = []) {
    var parent = a.createelem(null, type, data)
    inside.forEach((elem) => {
      parent.appendChild(elem)
    })
    return parent
  }
  static gettype(thing, match) {
    if (
      !match ||
      (Object.prototype.toString
        .call(match)
        .toLowerCase()
        .match(/^\[[a-z]+ (.+)\]$/)[1] == "string" &&
        !match.includes("|"))
    ) {
      var type = Object.prototype.toString
        .call(thing)
        .toLowerCase()
        .match(/^\[[a-z]+ (.+)\]$/)[1]
      if (type !== "function") if (type == match) return true
      if (match == "normal function") return type == "function"
      if (type == "htmldocument" && match == "document") return true
      if (match == "body" && type == "htmlbodyelement") return true
      if (match && new RegExp(`^html${match}element$`).test(type))
        return true
      if (/^html\w+element$/.test(type)) type = "element"
      if (type == "htmldocument") type = "element"
      if (type == "async function") type = "function"
      if (type == "generator function") type = "function"
      if (type == "regexp") type = "regex"
      if (match == "regexp") match = "regex"
      if (match == "element" && type == "window") return true
      if (match == "element" && type == "shadowroot") return true
      if (match == "event" && /\w+event$/.test(type)) return true
      if (/^(html|svg).*element$/.test(type)) type = "element"
      if (type == "function") {
        type =
          (
            /^\s*class\s/.test(
              Function.prototype.toString.call(thing),
            )
          ) ?
            "class"
          : "function"
      }
      if (match == "none")
        return type == "nan" || type == "undefined" || type == "null"
      try {
        if (type === "number" && isNaN(thing) && match == "nan")
          return true
      } catch (e) {
        error(thing)
      }
      return match ? match === type : type
    } else {
      if (match.includes("|")) match = match.split("|")
      match = [...new Set(match)]
      return match.filter((e) => a.gettype(thing, e)).length > 0
    }
  }
  static async waitforelem(selector) {
    if (a.gettype(selector, "string")) {
      selector = [selector]
    }
    await a.bodyload()
    var g = false
    return new Promise((resolve) => {
      var observer = new MutationObserver(check)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: false,
      })
      check()
      function check() {
        if (g) return
        if (selector.find((selector) => !a.qs(selector))) return
        observer.disconnect()
        resolve(
          selector.length == 1 ?
            a.qs(selector[0])
          : selector.map((e) => a.qs(e)),
        )
      }
    })
  }
  static getallvars() {
    var obj = {}
    var variables = []
    for (var name in this)
      if (
        !`window self document name location customElements history locationbar menubar personalbar scrollbars statusbar toolbar status closed frames length top opener parent frameElement navigator origin external screen innerWidth innerHeight scrollX pageXOffset scrollY pageYOffset visualViewport screenX screenY outerWidth outerHeight devicePixelRatio clientInformation screenLeft screenTop styleMedia onsearch isSecureContext trustedTypes performance onappinstalled onbeforeinstallprompt crypto indexedDB sessionStorage localStorage onbeforexrselect onabort onbeforeinput onblur oncancel oncanplay oncanplaythrough onchange onclick onclose oncontextlost oncontextmenu oncontextrestored oncuechange ondblclick ondrag ondragend ondragenter ondragleave ondragover ondragstart ondrop ondurationchange onemptied onended onerror onfocus onformdata oninput oninvalid onkeydown onkeypress onkeyup onload onloadeddata onloadedmetadata onloadstart onmousedown onmouseenter onmouseleave onmousemove onmouseout onmouseover onmouseup onmousewheel onpause onplay onplaying onprogress onratechange onreset onresize onscroll onsecuritypolicyviolation onseeked onseeking onselect onslotchange onstalled onsubmit onsuspend ontimeupdate ontoggle onvolumechange onwaiting onwebkitanimationend onwebkitanimationiteration onwebkitanimationstart onwebkittransitionend onwheel onauxclick ongotpointercapture onlostpointercapture onpointerdown onpointermove onpointerrawupdate onpointerup onpointercancel onpointerover onpointerout onpointerenter onpointerleave onselectstart onselectionchange onanimationend onanimationiteration onanimationstart ontransitionrun ontransitionstart ontransitionend ontransitioncancel onafterprint onbeforeprint onbeforeunload onhashchange onlanguagechange onmessage onmessageerror onoffline ononline onpagehide onpageshow onpopstate onrejectionhandled onstorage onunhandledrejection onunload crossOriginIsolated scheduler alert atob blur btoa cancelAnimationFrame cancelIdleCallback captureEvents clearInterval clearTimeout close confirm createImageBitmap fetch find focus getComputedStyle getSelection matchMedia moveBy moveTo open postMessage print prompt queueMicrotask releaseEvents reportError requestAnimationFrame requestIdleCallback resizeBy resizeTo scroll scrollBy scrollTo setInterval setTimeout stop structuredClone webkitCancelAnimationFrame webkitRequestAnimationFrame originAgentCluster navigation webkitStorageInfo speechSynthesis oncontentvisibilityautostatechange openDatabase webkitRequestFileSystem webkitResolveLocalFileSystemURL chrome caches cookieStore ondevicemotion ondeviceorientation ondeviceorientationabsolute launchQueue onbeforematch getDigitalGoodsService getScreenDetails queryLocalFonts showDirectoryPicker showOpenFilePicker showSaveFilePicker TEMPORARY PERSISTENT addEventListener dispatchEvent removeEventListener`
          .split(" ")
          .includes(name)
      )
        variables.push(name)
    variables.forEach((e) => {
      var c = String(a.gettype(this[e]))
      if (c === "object") c = "variable"
      if (!obj[c]) obj[c] = []
      obj[c].push(e)
    })
    return obj
  }
  static sha(s = "", includesymbols) {
    var tab
    if (typeof includesymbols == "string") {
      tab = includesymbols
    } else if (includesymbols) {
      tab =
        "`~\\|[];',./{}:<>?\"!@#$%^&*ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    } else {
      tab =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    }
    return binb2b64(core_sha1(str2binb(s), s.length * 8))
    function core_sha1(x, len) {
      x[len >> 5] |= 0x80 << (24 - len)
      x[(((len + 64) >> 9) << 4) + 15] = len
      var w = Array(80)
      var a = 1732584193
      var b = -271733879
      var c = -1732584194
      var d = 271733878
      var e = -1009589776
      for (var i = 0; i < x.length; i += 16) {
        var olda = a
        var oldb = b
        var oldc = c
        var oldd = d
        var olde = e
        for (var j = 0; j < 80; j++) {
          if (j < 16) w[j] = x[i + j]
          else
            w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1)
          var t = safe_add(
            safe_add(rol(a, 5), sha1_ft(j, b, c, d)),
            safe_add(safe_add(e, w[j]), sha1_kt(j)),
          )
          e = d
          d = c
          c = rol(b, 30)
          b = a
          a = t
        }
        a = safe_add(a, olda)
        b = safe_add(b, oldb)
        c = safe_add(c, oldc)
        d = safe_add(d, oldd)
        e = safe_add(e, olde)
      }
      return Array(a, b, c, d, e)
    }
    function sha1_ft(t, b, c, d) {
      if (t < 20) return (b & c) | (~b & d)
      if (t < 40) return b ^ c ^ d
      if (t < 60) return (b & c) | (b & d) | (c & d)
      return b ^ c ^ d
    }
    function sha1_kt(t) {
      return (
        t < 20 ? 1518500249
        : t < 40 ? 1859775393
        : t < 60 ? -1894007588
        : -899497514
      )
    }
    function safe_add(x, y) {
      var lsw = (x & 0xffff) + (y & 0xffff)
      var msw = (x >> 16) + (y >> 16) + (lsw >> 16)
      return (msw << 16) | (lsw & 0xffff)
    }
    function rol(num, cnt) {
      return (num << cnt) | (num >>> (32 - cnt))
    }
    function str2binb(str) {
      var bin = Array()
      var mask = (1 << 8) - 1
      for (var i = 0; i < str.length * 8; i += 8)
        bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (24 - i)
      return bin
    }
    function binb2b64(binarray) {
      var str = ""
      for (var i = 0; i < binarray.length * 4; i += 3) {
        var triplet =
          (((binarray[i >> 2] >> (8 * (3 - (i % 4)))) & 0xff) << 16) |
          (((binarray[(i + 1) >> 2] >> (8 * (3 - ((i + 1) % 4)))) &
            0xff) <<
            8) |
          ((binarray[(i + 2) >> 2] >> (8 * (3 - ((i + 2) % 4)))) &
            0xff)
        for (var j = 0; j < 4; j++) {
          if (i * 8 + j * 6 > binarray.length * 32) str += ""
          else str += tab.charAt((triplet >> (6 * (3 - j))) & 0x3f)
        }
      }
      return str
    }
  }
  static qs(text, parent = document) {
    return parent.querySelector(text)
  }
  static qsa(text, parent = document) {
    return Array.from(parent.querySelectorAll(text))
  }
  static csspath(el) {
    if (a.gettype(el, "array")) return a.map(el, (e) => a.csspath(e))
    if (!(el instanceof Element)) return
    var path = []
    while (el.nodeType === Node.ELEMENT_NODE) {
      var selector = el.nodeName.toLowerCase()
      if (el.id) {
        selector += "#" + el.id
        path.unshift(selector)
        break
      } else {
        var sib = el,
          nth = 1
        while ((sib = sib.previousElementSibling)) {
          if (sib.nodeName.toLowerCase() == selector) nth++
        }
        if (nth != 1) selector += ":nth-of-type(" + nth + ")"
      }
      path.unshift(selector)
      el = el.parentNode
    }
    return path.join(" > ")
  }
  static fromms(ms) {
    ms = Number(ms)
    return {
      years: Math.floor(ms / 1000 / 60 / 60 / 24 / 365),
      days: Math.floor(ms / 1000 / 60 / 60 / 24) % 365,
      hours: Math.floor(ms / 1000 / 60 / 60) % 24,
      mins: Math.floor(ms / 1000 / 60) % 60,
      secs: Math.floor(ms / 1000) % 60,
      ms: Math.floor(ms) % 1000,
    }
  }
  static fromms(ms) {
    ms = Number(ms)
    return {
      years: Math.floor(ms / 1000 / 60 / 60 / 24 / 365),
      days: Math.floor(ms / 1000 / 60 / 60 / 24) % 365,
      hours: Math.floor(ms / 1000 / 60 / 60) % 24,
      mins: Math.floor(ms / 1000 / 60) % 60,
      secs: Math.floor(ms / 1000) % 60,
      ms: Math.floor(ms) % 1000,
    }
  }
  static rect(e) {
    if (a.gettype(e, "string")) e = a.qs(e)
    var { x, y, width, height } = e.getBoundingClientRect().toJSON()
    return {
      x,
      y,
      w: width,
      h: height,
    }
  }
  static setelem(elem, data) {
    var issvg =
      elem == "svg" || parent?.tagName?.toLowerCase?.() == "svg"
    if (data.class)
      data.class.split(" ").forEach((e) => {
        elem.classList.add(e)
      })
    if (data.options && elem.tagName.toLowerCase() == "select")
      data.options = data.options.map((e) =>
        a.gettype(e, "array") ?
          a.createelem(elem, "option", {
            innerHTML: e[0],
            value: e[1],
          })
        : a.createelem(elem, "option", {
            innerHTML: e,
            value: e,
          }),
      )
    if (elem.tagName.toLowerCase() == "label" && "for" in data) {
      data.htmlFor = data.for
    }
    Object.assign(elem.style, data)
    if (elem.tagName.toLowerCase() == "select") {
      a.foreach(data, function (a, s) {
        elem[a] = s
      })
    } else if (issvg) {
      Object.keys(data).forEach((e) => (elem[e] = data[e]))
    } else {
      Object.assign(elem, data)
    }
    return elem
  }
  static watchvar(varname, onset, onget, obj = window) {
    obj = obj || window
    obj[`_${varname}`] = undefined
    obj[`${varname}`] = undefined
    Object.defineProperty(obj, varname, {
      configurable: false,
      get() {
        if (onget) return onget(obj[`_${varname}`])
        return obj[`_${varname}`]
      },
      set(value) {
        if (value === obj[`_${varname}`]) {
          return
        }
        var s = onset(value, obj[`_${varname}`])
        if (s) obj[`_${varname}`] = value
      },
    })
  }
  static randomizeorder(arr) {
    arr = [...arr]
    var arr2 = []
    var count = arr.length
    for (var i = 0; i < count; i++) {
      var idx = a.randfrom(0, arr.length - 1)
      arr2.push(arr[idx])
      arr.splice(idx, 1)
    }
    return arr2
  }
  static constrainvar(varname, min, max) {
    window[`_${varname}`] = undefined
    window[`${varname}`] = undefined
    Object.defineProperty(window, varname, {
      configurable: false,
      get() {
        return window[`_${varname}`]
      },
      set(value) {
        if (value === window[`_${varname}`]) {
          return
        }
        if (value > max) value = max
        if (value < min) value = min
        window[`_${varname}`] = value
      },
    })
  }
  static isbetween(z, x, c) {
    if (x == c) return false
    var big, small
    if (x > c) {
      big = x
      small = c
    } else {
      big = c
      small = x
    }
    return z > big && z < small
  }
  static indexsof(y, x) {
    var i = 0
    var arr = []
    y.split(x).forEach((e, k) => {
      i += e.length
      arr.push(i + k)
    })
    arr.pop()
    return arr
  }
  static _export() {
    var s = []
    a.qsa("input, textarea").foreach((e) => {
      s.push({
        path: a.csspath(e),
        value: escape(e.value),
        checked: e.checked,
      })
    })
    return JSON.stringify(s)
  }
  static _import(data) {
    data.forEach((e) => {
      var s = a.qs(e.path)
      s.checked = e.checked
      s.value = unescape(e.value)
    })
    return data
  }
  static popup(data, x, y, w, h) {
    if (x || x === 0) {
      x = (screen.width / 100) * x
      y = (screen.height / 100) * y
      w = (screen.width / 100) * w
      h = (screen.height / 100) * h
      var win = open(
        "",
        "",
        `left=${x}, top=${y} width=${w},height=${h}`,
      )
      win.document.write(data)
      return win
    } else {
      var win = open("")
      win.document.write(data)
      return win
    }
  }
  static same(...a) {
    if (a.length == 1) a = a[0]
    return [...new Set(a.map((e) => JSON.stringify(e)))].length === 1
  }
  static containsany(arr1, arr2) {
    return !!arr2.find((e) => arr1.includes(e))
  }
  static getprops(func, peramsonly) {
    return peramsonly ?
        getprops(func)
          .vars.map((e) => e.var)
          .filter((e) => e)
      : getprops(func)
  }
  static bodyload() {
    return new Promise((resolve) => {
      if (document.body) resolve()
      var observer = new MutationObserver(function () {
        if (document.body) {
          resolve()
          observer.disconnect()
        }
      })
      observer.observe(document.documentElement, {
        childList: true,
      })
    })
  }
  static repeat(func, count, delay, instantstart, waituntildone) {
    if (delay || waituntildone)
      return new Promise(async (resolve) => {
        if (delay) {
          var extra = 0
          for (var i = 0; i < count; i++) {
            if (instantstart) waituntildone ? await func(i) : func(i)
            extra = await a.wait(delay - extra)
            if (!instantstart) waituntildone ? await func(i) : func(i)
          }
          resolve()
        } else
          for (var i = 0; i < count; i++)
            waituntildone ? await func(i) : func(i)
        resolve()
      })
    for (var i = 0; i < count; i++) func(i)
    return
  }
  static repeatuntil(
    func,
    donecheck,
    delay,
    instantstart,
    waituntildone,
  ) {
    return new Promise(async (resolve) => {
      if (delay) {
        var extra = 0
        var i = 0
        while (!donecheck()) {
          i++
          if (instantstart) {
            waituntildone ? await func(i) : func(i)
          }
          extra = await a.wait(delay - extra)
          if (!instantstart) {
            waituntildone ? await func(i) : func(i)
          }
        }
        resolve()
      } else {
        var i = 0
        while (!donecheck()) {
          i++
          waituntildone ? await func(i) : func(i)
        }
        resolve()
      }
    })
  }
  static async getfolderpath(folder) {
    async function parsedir(dir, x) {
      if (!x) {
        return [
          {
            name: dir.name,
            inside: await parsedir(dir, true),
            type: "folder",
            handle: dir,
          },
        ]
      } else var arr = []
      for await (const [name, handle] of dir.entries()) {
        arr.push(
          a.gettype(handle, "filesystemdirectoryhandle") ?
            {
              type: "folder",
              inside: await parsedir(handle, true),
              name,
              handle,
            }
          : { type: "file", handle, name },
        )
      }
      return arr
    }
    return parsedir(folder)
  }
  static async getfiles(oldway, multiple, accept = [], options = {}) {
    const supportsFileSystemAccess =
      "showOpenFilePicker" in window &&
      (() => {
        try {
          return window.self === window.top
        } catch {
          return false
        }
      })()
    if (!oldway) {
      if (!supportsFileSystemAccess) throw new Error("no access")
      let fileOrFiles = undefined
      try {
        const handles = await showOpenFilePicker({
          types: [
            {
              accept: {
                "*/*": accept,
              },
            },
          ],
          multiple,
          ...options,
        })
        if (!multiple) {
          fileOrFiles = handles[0]
        } else {
          fileOrFiles = await Promise.all(handles)
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          error(err.name, err.message)
        }
      }
      return fileOrFiles
    }
    return new Promise(async (resolve) => {
      await a.bodyload()
      const input = document.createElement("input")
      input.style.display = "none"
      input.type = "file"
      if (accept) input.accept = accept
      document.body.append(input)
      if (multiple) {
        input.multiple = true
      }
      input.addEventListener("change", () => {
        input.remove()
        resolve(multiple ? Array.from(input.files) : input.files[0])
      })
      if ("showPicker" in HTMLInputElement.prototype) {
        input.showPicker()
      } else {
        input.click()
      }
    })
  }
  static async getfolder(write = false, options = {}) {
    const supportsFileSystemAccess =
      "showDirectoryPicker" in window &&
      (() => {
        try {
          return window.self === window.top
        } catch {
          return false
        }
      })()
    if (!supportsFileSystemAccess) throw new Error("no access")
    try {
      return await showDirectoryPicker({
        mode: write ? "readwrite" : "read",
        ...options,
      })
    } catch (err) {
      if (err.name !== "AbortError") {
        error(err.name, err.message)
      }
    }
    return undefined
  }
  static map(arr, func) {
    var type = a.gettype(arr)
    if (type == "array") return arr.map(func)
    else if (type == "object") {
      var temparr = {}
      Reflect.ownKeys(arr).forEach((e, i) => {
        temparr = {
          ...temparr,
          ...func(e, arr[e], i),
        }
      })
      return temparr
    } else {
      return [arr].map(func)
    }
  }
  static find(arr, func) {
    var type = a.gettype(arr)
    if (type == "array") return arr.find(func)
    else if (type == "object") {
      return Reflect.ownKeys(arr).find((e, i) => {
        return func(e, arr[e], i)
      })
    } else {
      return [arr].find(func)
    }
  }
  static filteridx(arr, func) {
    if (a.gettype(arr, "object")) arr = [arr]
    return a
      .map(arr, (e, i) => (func(e, i) ? i : undefined))
      .filter((e) => e !== undefined)
  }
  static filter(arr, func) {
    var type = a.gettype(arr)
    if (type == "array") return arr.filter(func)
    else if (type == "object") {
      var temparr = {}
      Reflect.ownKeys(arr).forEach((e, i) => {
        if (func(e, arr[e], i))
          temparr = {
            ...temparr,
            [e]: arr[e],
          }
      })
      return temparr
    } else {
      return [arr].filter(func)
    }
  }
  static unique() /*object*/ {
    return last || (last = different.new())
  }
  static tostring(e) {
    if (["object", "array"].includes(a.gettype(e)))
      return JSON.stringify(e)
    if (a.gettype(e, "element")) return a.csspath(e)
    return String(e)
  }
  static toregex(d, s) {
    if (a.gettype(d, "array")) var temp = d
    if (s) var temp = [d, s]
    else if (String(d).match(/^\/(.*)\/(\w*)$/)) {
      var m = String(d).match(/^\/(.*)\/(\w*)$/)
      var temp = [m[1], m[2]]
    } else var temp = [String(d), ""]
    temp[1] = temp[1].toLowerCase()
    if (temp[1].includes("w")) {
      temp[1] = temp[1].replace("w", "")
      temp[0] = `(?<=[^a-z0-9]|^)${temp[0]}(?=[^a-z0-9]|$)`
    }
    return new RegExp(temp[0], temp[1].replaceAll(/(.)(?=.*\1)/g, ""))
  }
  static isregex(s) {
    if (a.gettype(s, "regex")) return true
    return (
      /^\/.*(?<!\\)\/[gimusy]*$/.test(s) && !/^\/\*.*\*\/$/.test(s)
    )
  }
  static ispressed(e /*event*/, code) {
    code = code.toLowerCase()
    var temp =
      e.shiftKey == code.includes("shift") &&
      e.altKey == code.includes("alt") &&
      e.ctrlKey == code.includes("ctrl") &&
      e.metaKey == code.includes("meta") &&
      e.key.toLowerCase() ==
        code.replaceAll(/alt|ctrl|shift|meta/g, "").trim()
    if (temp && !a) e.preventDefault()
    return temp
  }
  static controller_vibrate(
    pad,
    duration = 1000,
    strongMagnitude = 0,
    weakMagnitude = 0,
  ) {
    getpad(pad).vibrationActuator.playEffect("dual-rumble", {
      duration,
      strongMagnitude,
      weakMagnitude,
    })
    return pad
  }
  static controller_getbutton(pad, button) {
    return button ?
        getpad(pad).buttons[button].value
      : getpad(pad).buttons.map((e) => e.value)
  }
  static controller_getaxes(pad, axes) {
    return axes ? getpad(pad).axes[axes] : getpad(pad).axes
  }
  static controller_exists(pad) {
    return pad === undefined ?
        getpad().filter((e) => e).length
      : !!getpad(pad)
  }
  static async readfile(file, type = "Text") {
    return new Promise(function (done, error) {
      var f = new FileReader()
      f.onerror = error
      f.onload = () =>
        done(type == "json" ? JSON.parse(f.result) : f.result)
      f["readAs" + (type == "json" ? "Text" : type)](file)
    })
  }
  static async writefile(file, text) {
    var f = await file.createWritable()
    await f.write(text)
    await f.close()
    return file
  }
  static async getfileperms(fileHandle, readWrite) {
    const options = {}
    if (readWrite) {
      options.mode = "readwrite"
    }
    try {
      return (
        (await fileHandle.queryPermission(options)) === "granted" ||
        (await fileHandle.requestPermission(options)) === "granted"
      )
    } catch (e) {
      await a.waitforclick()
      return (
        (await fileHandle.queryPermission(options)) === "granted" ||
        (await fileHandle.requestPermission(options)) === "granted"
      )
    }
  }
  static async waitforclick(fileHandle, readWrite) {
    return new Promise((resolve) => {
      var listener = a.listen(
        window,
        "click",
        () => {
          a.unlisten(listener)
          resolve()
        },
        true,
      )
    })
  }
  static readfileslow(
    file,
    type = "Text",
    cb1 = (e) => e,
    cb2 = (e) => e,
  ) {
    var fileSize = file.size
    var chunkSize = 64 * 1024 * 50
    var offset = 0
    var chunkReaderBlock = null
    var arr = []
    var lastidx
    var readEventHandler = function (evt, idx) {
      if (evt.target.error == null) {
        arr.push([idx, evt.target.result])
        cb1(a.rerange(arr.length, 0, lastidx, 0, 100))
        if (arr.length === lastidx)
          cb2(arr.sort((e) => e[0]).map((e) => e[1]))
      } else {
        return error("Read error: " + evt.target.error)
      }
    }
    chunkReaderBlock = function (_offset, length, _file, idx) {
      var r = new FileReader()
      var blob = _file.slice(_offset, length + _offset)
      const zzz = idx + 1
      r.onload = function (e) {
        readEventHandler(e, zzz - 1)
      }
      r["readAs" + type](blob)
    }
    let idx = 0
    while (offset < fileSize) {
      idx++
      chunkReaderBlock(offset, chunkSize, file, idx)
      offset += chunkSize
    }
    lastidx = idx
  }

  static cbtoasync(func, ...args) {
    return new Promise(function (resolve) {
      func(...args, resolve)
    })
  }

  static asynctocb(func, ...args) {
    var cb = args.pop()
    return func(...args).then(cb)
  }

  static randstr({
    lower = true,
    upper = false,
    number = false,
    symbol = false,
    length = 20,
  }) {
    var rand = ""
    a.repeat(() => {
      rand += a.randfrom(
        `${lower ? "asdfghjklzxcvbnmqwertyuiop" : ""}${
          upper ? "ASDFGHJKLQWERTYUIOPZXCVBNM" : ""
        }${number ? "0123456789" : ""}${
          symbol ? ",./;'[]-=\\`~!@#$%^&*()_+|{}:\"<>?" : ""
        }`.split(""),
      )
    }, length)
    return rand
  }

  static toplaces(num, pre, post = 0, func = Math.round) {
    num = String(num).split(".")
    if (num.length == 1) num.push("")
    if (pre !== undefined) {
      num[0] = num[0].substring(num[0].length - pre, num[0].length)
      while (num[0].length < pre) num[0] = "0" + num[0]
    }
    var temp = num[1].substring(post, post + 1) ?? 0
    num[1] = num[1].substring(0, post)
    while (num[1].length < post) num[1] += "0"
    if (post > 0) {
      temp = func(num[1].at(-1) + "." + temp)
      num[1] = num[1].split("")
      num[1].pop()
      num[1].push(temp)
      num[1] = num[1].join("")
      num = num.join(".")
    } else num = num[0]
    return num
  }

  static async fetch(url, type = "text", ...args) {
    return await (await fetch(url, ...args))[type]()
  }

  static replaceall(text, regex, replacewith) {
    return text.replaceAll(
      a.toregex(String(a.toregex(regex)) + "g"),
      replacewith,
    )
  }
  static setrange(num, min, max) {
    return (
      num < min ? min
      : num > max ? max
      : num
    )
  }
  static ondrop(obj) {
    if (!obj.types) obj.types = "all"
    obj.types = a.toarray(obj.types)
    if (!obj.func) throw new Error('object is missing "func"')
    var oldelem = obj.elem
    if (obj.elem) obj.elem = a.toelem(obj.elem, true)
    if (obj.elem && !a.gettype(obj.elem, "element"))
      throw new Error(
        `elem is not an elem, ${oldelem} -> ${obj.elem}`,
      )
    drops.push(obj)
    return obj
  }
  static clamp(num, min, max) {
    if (min !== undefined && num < min) num = min
    if (max !== undefined && num > max) num = max
    return num
  }
  static step(num, step) {
    return Math.round(num / step) * step
  }
  static download(
    data,
    filename = "temp.txt",
    type = "text/plain",
    isurl = false,
  ) {
    var url
    if (isurl) {
      url = data
    } else {
      if (a.gettype(data, "string"))
        var file = new Blob([data], {
          type,
        })
      else if (a.gettype(data, ["file", "blob"])) {
        filename = data.name
        var file = data
      }
      url = URL.createObjectURL(file)
    }
    var link = document.createElement("a")

    link.href = url
    link.download = filename
    a.bodyload().then(() => {
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      if (!isurl) URL.revokeObjectURL(url)
    })
  }
  static maketable(tableData) {
    const table = a.newelem("table", {}, [])
    var tbody
    var first = true
    for (var tableRow of tableData) {
      var tr = a.newelem("tr")
      if (tbody) {
        tbody.appendChild(tr)
      } else {
        table.appendChild(a.newelem("thead", {}, [tr]))
        table.appendChild((tbody = a.newelem("tbody")))
      }
      for (var data of tableRow) {
        var type = first ? "th" : "td"
        if (data == null) {
          var elem = a.newelem(type, {})
        } else if (a.gettype(data, "string")) {
          var elem = a.newelem(type, { innerHTML: data })
        } else if (a.gettype(data, "object")) {
          var elem = a.newelem(type, data)
        } else if (a.gettype(data, "array")) {
          var elem = a.newelem(type, {}, data)
        } else if (a.gettype(data, "element")) {
          var elem = a.newelem(type, {}, [data])
        }
        tr.appendChild(elem)
      }
      first = false
    }
    return table
  }
}
