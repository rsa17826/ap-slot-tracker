class LaunchUrlEditor {
  // Per-game Launch Client URL template editor and the placeholder-substitution used to build a launch link from a slots connection info.

  static openURLEditor(game) {
    els.launchURLGameLabel.textContent = `(${game})`
    els.launchURLEditor.value =
      (window.db &&
        window.db.launchURLs &&
        window.db.launchURLs[game]) ||
      ""
    els.launchURLError.textContent = ""
    els.launchURLError.style.display = "none"
    els.launchURLModal.dataset.game = game
    els.launchURLModal.classList.add("visible")
  }
  static closeURLEditor() {
    els.launchURLModal.classList.remove("visible")
  }
  static showURLEditorError(err) {
    els.launchURLError.textContent = String(
      (err && err.message) || err,
    )
    els.launchURLError.style.display = "block"
  }
  static buildLaunchURL(conn) {
    const tmpl = window.db?.launchURLs?.[conn.game]
    if (!tmpl) return null
    return tmpl
      .replaceAll("!hostname", conn.hostname ?? "")
      .replaceAll("!port", conn.port ?? "")
      .replaceAll("!playerName", conn.playerName ?? "")
      .replaceAll("!password", conn.password ?? "")
      .replaceAll("!game", conn.game ?? "")
  }
  static openLink(conn) {
    const url = LaunchUrlEditor.buildLaunchURL(conn)
    if (!url) {
      // No template saved for this game yet -- open the editor so
      // the user can define one.
      LaunchUrlEditor.openURLEditor(conn.game)
      return
    }
    window.open(url, "_blank")
  }
}
document
  .getElementById("launchURLCancel")
  .addEventListener("click", LaunchUrlEditor.closeURLEditor)
document
  .getElementById("launchURLSaveRun")
  .addEventListener("click", () => {
    const game = els.launchURLModal.dataset.game
    const src = els.launchURLEditor.value.trim()
    if (!src) {
      LaunchUrlEditor.showURLEditorError(
        "URL template can't be empty",
      )
      return
    }
    window.db.launchURLs ??= {}
    window.db.launchURLs[game] = src
    LaunchUrlEditor.closeURLEditor()
  })
els.launchURLModal.addEventListener("pointerdown", (ev) => {
  if (ev.target === els.launchURLModal)
    LaunchUrlEditor.closeURLEditor()
})
