"""Desktop host for the tracker (pywebview).

    pip install pywebview pyyaml      # plus GTK/WebKit on Linux (python3-gi, gir1.2-webkit2-4.1)
    python app.py

Config: $XDG_CONFIG_HOME/ap-slot-tracker/config.json
    {"ap_source_dir": "/path/to/Archipelago",    # required (or env AP_SOURCE_DIR)
     "worker_python": "/path/to/python",         # python that can import Archipelago, default = this one
     "players_dir": "/path/to/Players"}          # default <ap_source_dir>/Players
Graph cache:  $XDG_CACHE_HOME/ap-slot-tracker/graphs/<key>.json
Webview data: $XDG_CONFIG_HOME/ap-slot-tracker/webview   (IndexedDB = slots/settings/layouts)
"""

import functools
import hashlib
import http.server
import json
import os
import re
import subprocess
import sys
import tempfile
import threading

import webview
import yaml

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 54221 # fixed so the page origin (and with it IndexedDB) is the same on every launch
CONFIG_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "ap-slot-tracker")
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "ap-slot-tracker", "graphs")


def load_config():
  path = os.path.join(CONFIG_DIR, "config.json")
  cfg = {}
  if os.path.exists(path):
    with open(path) as f:
      cfg = json.load(f)


  if os.environ.get("AP_SOURCE_DIR"):
    cfg["ap_source_dir"] = os.environ["AP_SOURCE_DIR"]

  if "ap_source_dir" not in cfg:
    raise SystemExit(f"set ap_source_dir in {path} or AP_SOURCE_DIR in the environment")

  cfg.setdefault("worker_python", sys.executable)
  cfg.setdefault("players_dir", os.path.join(cfg["ap_source_dir"], "Players"))
  return cfg


# --- yaml ---------------------------------------------------------------------
def _plain(value):
  """A yaml scalar or weight dict -> its single certain value, else None."""
  if isinstance(value, dict):
    live = [k for k, w in value.items() if w]
    return live[0] if len(live) == 1 else None

  return value


def name_matches(template, name):
  if not isinstance(template, str):
    return False

  pattern = re.escape(template)
  for token, rx in (("player", ".*"), ("PLAYER", ".*"), ("number", r"\d*"), ("NUMBER", r"\d*")):
    pattern = pattern.replace(re.escape("{" + token + "}"), rx)

  return re.fullmatch(pattern, name) is not None


def read_yaml_docs(path):
  """-> [{name, game, section}] for every document in the file. `game` is None when it can't be
  determined with certainty."""
  with open(path) as f:
    docs = [d for d in yaml.safe_load_all(f) if isinstance(d, dict)]

  out = []
  for doc in docs:
    game = _plain(doc.get("game"))
    out.append(
      {
        "name": _plain(doc.get("name")),
        "game": game,
        "section": doc.get(game) if isinstance(game, str) else None,
        "has_triggers": bool(doc.get("triggers")),
      }
    )

  return out


# --- world fingerprint (so editing a dev world invalidates its cached graphs) ----
def fingerprint(path):
  # path is .../worlds/<pkg>/__init__.py, or .../custom_worlds/x.apworld/<pkg>/__init__.py
  m = re.match(r"(.*\.apworld)(/|$)", path)
  target = m.group(1) if m else os.path.dirname(path)
  h = hashlib.sha256()
  if os.path.isfile(target):
    st = os.stat(target)
    h.update(f"{target}{st.st_mtime_ns}{st.st_size}".encode())
  else:
    for dirpath, dirnames, filenames in os.walk(target):
      # skip hidden dirs (.direnv, .git, ...), caches and venvs: they're not world code and can hold dangling symlinks
      dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in ("__pycache__", "node_modules"))
      for fn in sorted(filenames):
        full = os.path.join(dirpath, fn)
        if not os.path.isfile(full): # dangling symlink etc.
          continue

        st = os.stat(full)
        h.update(f"{full}{st.st_mtime_ns}{st.st_size}".encode())



  return h.hexdigest()


PICKER_SCRIPT = """
import os, sys
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk
dlg = Gtk.FileChooserNative.new("Select player yaml", None, Gtk.FileChooserAction.OPEN, "Open", "Cancel")
flt = Gtk.FileFilter()
flt.set_name("YAML files")
flt.add_pattern("*.yaml")
flt.add_pattern("*.yml")
dlg.add_filter(flt)
if os.path.isdir(sys.argv[1]):
  dlg.set_current_folder(sys.argv[1])

if dlg.run() == Gtk.ResponseType.ACCEPT:
  print(dlg.get_filename())

"""


class Api:
  """Everything here is callable from JS as `await pywebview.api.<name>(...)`.
  Attributes starting with _ are not exposed (important for _window)."""

  def __init__(self, cfg):
    self._cfg = cfg
    self._window = None
    self._db_data = None
    self._db_lock = threading.Lock()
    self._worlds = None
    self._lock = threading.Lock() # guards the cached world list
    self._cache_lock = threading.Lock() # serialises builds and gc
    os.makedirs(CACHE_DIR, exist_ok=True)

  # -- worker -------------------------------------------------------------------
  def _run_worker(self, command, request=None):
    with tempfile.TemporaryDirectory() as tmp:
      out = os.path.join(tmp, "out.json")
      args = [self._cfg["worker_python"], os.path.join(ROOT, "tracker_worker.py"), command]
      if request is not None:
        req = os.path.join(tmp, "req.json")
        with open(req, "w") as f:
          json.dump(request, f)

        args.append(req)

      args.append(out)
      env = {**os.environ, "AP_SOURCE_DIR": self._cfg["ap_source_dir"]}
      proc = subprocess.run(args, env=env, cwd=self._cfg["ap_source_dir"], capture_output=True, text=True)
      if proc.returncode != 0 or not os.path.exists(out):
        raise RuntimeError(f"worker '{command}' failed ({proc.returncode}):\n{(proc.stdout + proc.stderr)[-4000:]}")

      with open(out) as f:
        return json.load(f)



  # -- worlds -------------------------------------------------------------------
  def list_worlds(self, refresh=False):
    with self._lock:
      if self._worlds is None or refresh:
        self._worlds = self._run_worker("list_worlds")

      return [{"game": w["game"], "version": w["version"]} for w in self._worlds]


  def _world(self, game):
    self.list_worlds()
    for w in self._worlds:
      if w["game"] == game:
        return w


    raise RuntimeError(f"'{game}' is not an installed world")

  # -- yaml ---------------------------------------------------------------------
  def pick_yaml(self):
    # The window itself is Qt; GTK is only used here, in a throwaway process with its own main
    # loop (a GTK dialog can't share this process's Qt event loop). GTK_USE_PORTAL makes it the
    # desktop's native picker through xdg-desktop-portal; GTK_THEME only matters if there's no portal.
    env = {**os.environ, "GTK_USE_PORTAL": "1", "GTK_THEME": "Adwaita:dark"}
    proc = subprocess.run([sys.executable, "-c", PICKER_SCRIPT, self._cfg["players_dir"]], env=env, capture_output=True, text=True)
    if proc.returncode != 0:
      raise RuntimeError(f"file picker failed:\n{proc.stderr[-2000:]}")

    return proc.stdout.strip() or None

  def _find_yaml(self, game, player_name):
    d = self._cfg["players_dir"]
    if not os.path.isdir(d):
      return None

    for fn in sorted(os.listdir(d)):
      if not fn.lower().endswith((".yaml", ".yml")):
        continue

      path = os.path.join(d, fn)
      if any(doc["game"] == game and name_matches(doc["name"], player_name) for doc in read_yaml_docs(path)):
        return path


    return None

  # -- graph --------------------------------------------------------------------
  def build(self, req):
    """req: {game, playerName, yamlPath|None, force:bool, slotData:obj|None}
    -> {key, yamlPath, optionsSource: 'yaml'|'defaults', graph}  or  {error}"""
    with self._cache_lock:
      return self._build_locked(req)


  def _build_locked(self, req):
    game, player = req["game"], req["playerName"]
    world = self._world(game)
    yaml_path = req.get("yamlPath") or self._find_yaml(game, player)

    if yaml_path:
      docs = [d for d in read_yaml_docs(yaml_path) if d["game"] == game and name_matches(d["name"], player)]
      if len(docs) != 1:
        return {"error": f"{yaml_path}: expected exactly 1 document for {player}/{game}, found {len(docs)}"}

      if docs[0]["has_triggers"]:
        return {"error": f"{yaml_path}: triggers are not supported (outcome isn't certain)"}

      options, source = docs[0]["section"] or {}, "yaml"
    else:
      options, source = {}, "defaults"

    key = hashlib.sha256(json.dumps([game, world["version"], fingerprint(world["path"]), options, req.get("slotData")], sort_keys=True, default=str).encode()).hexdigest()[:24]
    cache_path = os.path.join(CACHE_DIR, f"{key}.json")

    if req.get("force") or not os.path.exists(cache_path):
      result = self._run_worker("build", {"game": game, "options": options, "slot_data": req.get("slotData")})
      if "error" in result:
        return {"error": result["error"]}

      with open(cache_path, "w") as f:
        json.dump(result["graph"], f)


    with open(cache_path) as f:
      graph = json.load(f)

    return {"key": key, "yamlPath": yaml_path, "optionsSource": source, "graph": graph}

  def gc(self, live_keys):
    """Delete cached graphs that no slot references any more."""
    live = set(live_keys)
    with self._cache_lock:
      for fn in os.listdir(CACHE_DIR):
        if fn.endswith(".json") and fn[:-5] not in live:
          os.remove(os.path.join(CACHE_DIR, fn))




  # -- persistent settings/slots (replaces IndexedDB) -----------------------------
  def _db_path(self):
    return os.path.join(CONFIG_DIR, "db.json")

  def _db(self):
    if self._db_data is None:
      self._db_data = {}
      if os.path.exists(self._db_path()):
        with open(self._db_path()) as f:
          self._db_data = json.load(f)



    return self._db_data

  def _db_save(self):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    tmp = self._db_path() + ".tmp"
    with open(tmp, "w") as f:
      json.dump(self._db_data, f)

    os.replace(tmp, self._db_path()) # atomic, a crash mid-write can't corrupt the file

  def db_load(self):
    with self._db_lock:
      print(f"[ap-tracker] db_load from {self._db_path()}", flush=True)
      return [{"id": k, "val": v} for k, v in self._db().items()]


  def db_write(self, items):
    with self._db_lock:
      data = self._db()
      for item in items:
        if item["deleted"]:
          data.pop(item["id"], None)
        else:
          data[item["id"]] = item["val"]


      self._db_save()
      print(f"[ap-tracker] db_write {len(items)} item(s) -> {self._db_path()}", flush=True)


  def db_clear(self):
    with self._db_lock:
      self._db_data = {}
      self._db_save()

    return True

  # -- misc ---------------------------------------------------------------------
  def notify(self, title, body):
    # WebKitGTK has no working Notification API, so go through the desktop
    subprocess.run(["notify-send", "--app-name=AP Tracker", title, body], check=True)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
  def log_message(self, format, *args):
    if self.path.split("?")[0].endswith((".js", ".html", "/")):
      print(f"[ap-tracker] GET {self.path}", flush=True) # no line for a file = the webview served it from its cache


  def end_headers(self):
    # the webview would otherwise heuristically cache the js and keep running stale code after an update
    self.send_header("Cache-Control", "no-store")
    super().end_headers()


def serve_static():
  server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(QuietHandler, directory=ROOT))
  threading.Thread(target=server.serve_forever, daemon=True).start()


def main():
  api = Api(load_config())
  print(f"[ap-tracker] app.py {os.path.abspath(__file__)} serving {ROOT}", flush=True)
  serve_static()
  api._window = webview.create_window(
    "AP Multi-Slot Tracker",
    f"http://127.0.0.1:{PORT}/index.html",
    js_api=api,
    width=1400,
    height=900,
    transparent=True,
  )
  os.makedirs(os.path.join(CONFIG_DIR, "webview"), exist_ok=True)
  webview.start(gui="qt", storage_path=os.path.join(CONFIG_DIR, "webview"), private_mode=False, debug=bool(os.environ.get("AP_TRACKER_DEBUG")))


if __name__ == "__main__":
  main()
