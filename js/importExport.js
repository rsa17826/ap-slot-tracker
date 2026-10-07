/**
 * @typedef {Object} LastExportMode
 * @property {string} mode
 * @property {FileSystemDirectoryHandle} dirHandle
 */

class ImportExport {
  // Full/partial import & export of the tracker's persisted state.
  //
  // Partial: just ./db.json (everything in db except FileSystem handles,
  // which can't be serialized).
  // Full:    ./db.json plus
  //            ./trackedFolder/*.json   (contents of the loaded rules folder)
  //            ./trackedFiles/*.json    (individually loaded rules files)

  // Keys of db that hold FileSystem handles -- not JSON-serializable, and
  // rebuilt on full import from the exported files/folders instead.
  static HANDLE_KEYS = [
    "fileHandles",
    "progFolderHandle",
    "lastExport",
  ]

  /**
   * @param {FileSystemDirectoryHandle} dir
   * @param {string} name
   * @param {string} text
   */
  static async writeText(dir, name, text) {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(text)
    await w.close()
  }

  /**
   * Returns null only when the entry doesn't exist; any other error throws.
   * @param {FileSystemDirectoryHandle} dir
   * @param {string} name
   */
  static async optionalSubdir(dir, name) {
    try {
      return await dir.getDirectoryHandle(name)
    } catch (e) {
      if (e.name === "NotFoundError") return null
      throw e
    }
  }

  static dbJson() {
    return JSON.stringify(
      window.db,
      (key, value) =>
        ImportExport.HANDLE_KEYS.includes(key) ? undefined : value,
      2,
    )
  }

  static async exportPartial() {
    const dir = await showDirectoryPicker({ mode: "readwrite" })
    await ImportExport.writePartial(dir)
    window.db.lastExport = { mode: "partial", dirHandle: dir }
  }

  static async exportFull() {
    const dir = await showDirectoryPicker({ mode: "readwrite" })
    await ImportExport.writeFull(dir)
    window.db.lastExport = { mode: "full", dirHandle: dir }
  }

  /** @param {FileSystemDirectoryHandle} dir */
  static async writePartial(dir) {
    await ImportExport.writeText(
      dir,
      "db.json",
      ImportExport.dbJson(),
    )
  }

  /** @param {FileSystemDirectoryHandle} dir */
  static async writeFull(dir) {
    await ImportExport.writeText(
      dir,
      "db.json",
      ImportExport.dbJson(),
    )

    const folder = window.db.progFolderHandle
    // Files that live inside the tracked folder are exported with it, not
    // duplicated under trackedFiles.
    if (folder) {
      await a.getfileperms(folder)
      const out = await dir.getDirectoryHandle("trackedFolder", {
        create: true,
      })
      for await (const entry of folder.values()) {
        if (
          entry.kind !== "file" ||
          !entry.name.toLowerCase().endsWith(".json")
        )
          continue
        const file = await entry.getFile()
        await ImportExport.writeText(
          out,
          entry.name,
          await file.text(),
        )
      }
    }

    const outFiles = await dir.getDirectoryHandle("trackedFiles", {
      create: true,
    })
    for (const handle of Object.values(window.db.fileHandles)) {
      if (folder && (await folder.resolve(handle)) !== null) continue
      await a.getfileperms(handle)
      const file = await handle.getFile()
      await ImportExport.writeText(
        outFiles,
        handle.name,
        await file.text(),
      )
    }
  }

  /**
   * Applies a parsed db.json onto the live db and refreshes the UI.
   * @param {Record<string, any>} data
   */
  static applyDb(data) {
    for (const k of Object.keys(window.db.connections))
      Connections.stopConnection(k)
    for (const [k, v] of Object.entries(data)) {
      if (ImportExport.HANDLE_KEYS.includes(k)) continue
      window.db[k] = v
    }
    /** @type {HTMLInputElement} */ // @ts-ignore
    document.getElementById("ctApiKeyInput").value =
      window.db.ctApiKey
    State.els.hideEventsChk.checked = db.hideEvents
    State.els.hideEmptyNodesChk.checked = db.hideEmptyNodes
    State.els.hideOOLChk.checked = db.hideOOL
    State.els.hideClearedChk.checked = db.hideCleared
    State.els.noTransitChk.checked = db.noTransit
    State.els.showScoutsChk.checked = db.showScouts
    ProgFilesUI.renderProgFiles()
    SlotsUI.renderSlots()
    Object.values(window.db.connections).forEach((conn) => {
      if (conn.autoConnect) Connections.startConnection(conn)
    })
  }

  static async importPartial() {
    const dir = await showDirectoryPicker()
    const fh = await dir.getFileHandle("db.json")
    ImportExport.applyDb(
      JSON.parse(await (await fh.getFile()).text()),
    )
  }

  static async importFull() {
    const dir = await showDirectoryPicker()
    const fh = await dir.getFileHandle("db.json")
    ImportExport.applyDb(
      JSON.parse(await (await fh.getFile()).text()),
    )

    // Same registration as the "Load rules file" button.
    const files = await ImportExport.optionalSubdir(
      dir,
      "trackedFiles",
    )
    if (files) {
      for await (const entry of files.values()) {
        if (
          entry.kind !== "file" ||
          !entry.name.toLowerCase().endsWith(".json")
        )
          continue
        const raw = JSON.parse(await (await entry.getFile()).text())
        const key = ProgKeys.progKeyFor(raw)
        if (!key) {
          error(entry.name, "not valid")
          continue
        }
        window.db.fileHandles[key] = entry
        window.db.progFiles[key] = raw
      }
    }

    // Same as the "Load rules folder" button.
    const folder = await ImportExport.optionalSubdir(
      dir,
      "trackedFolder",
    )
    if (folder) {
      window.db.progFolderHandle = folder
      await Main.scanProgFolder(folder, { loadFirst: !State.graph })
    }
    ProgFilesUI.renderProgFiles()
    SlotsUI.renderSlots()
  }

  // Call once from main.js's init IIFE, after window.db is ready and the
  // other setup has run. Adds the auto-export checkbox and, if enabled,
  // re-exports to the last export's folder using the same mode.
  static async init() {
    window.db.autoExport ??= false
    document.getElementById("aaaaa").after(
      newelem("div", { class: "h" }, [
        ImportExport.button("Export (full)", ImportExport.exportFull),
        ImportExport.button(
          "Export (partial)",
          ImportExport.exportPartial,
        ),
        ImportExport.button("Import (full)", ImportExport.importFull),
        ImportExport.button(
          "Import (partial)",
          ImportExport.importPartial,
        ),
        newelem("label", { class: "h" }, [
          newelem("input", {
            type: "checkbox",
            onchange() {
              // @ts-ignore
              window.db.autoExport = this.checked
            },
            checked: window.db.autoExport,
            disabled: window.db.lastExport === undefined,
          }),
          "Auto-export on load",
        ]),
      ]),
    )

    if (!window.db.autoExport) return
    const last = window.db.lastExport
    if (!last) return // nothing exported yet; first manual export sets it
    try {
      await a.getfileperms(last.dirHandle)
      if (last.mode === "full")
        await ImportExport.writeFull(last.dirHandle)
      else await ImportExport.writePartial(last.dirHandle)
    } catch (e) {
      error("auto-export failed", e)
    }
  }

  /**
   * @param {string} label
   * @param {() => Promise<void>} fn
   */
  static button(label, fn) {
    return newelem(
      "button",
      {
        flexGrow: 1,
        onclick: async () => {
          try {
            await fn()
          } catch (e) {
            if (e.name !== "AbortError")
              alert(`${label} failed: ${e.message}`)
          }
        },
      },
      [label],
    )
  }
}
