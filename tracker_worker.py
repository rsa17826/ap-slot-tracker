"""AP-side worker. Always run as a fresh subprocess by app.py so each call imports the world
code as it is on disk right now (dev worlds change constantly) and so AP's global registries
are never shared between runs.

    python tracker_worker.py list_worlds <out.json>
    python tracker_worker.py build <request.json> <out.json>

Env: AP_SOURCE_DIR (required). Results go to <out.json> instead of stdout because AP prints a
lot while importing worlds.
"""

import dataclasses
import json
import os
import random
import sys
from argparse import Namespace

sys.path.insert(0, os.environ["AP_SOURCE_DIR"])

# Generate.py calls ModuleUpdate.update() at import, which would pip-install things. Marking it
# as already run replaces the old trick of rewriting Generate.py on disk.
os.environ["SKIP_REQUIREMENTS_UPDATE"] = "1"
import ModuleUpdate # noqa: E402

ModuleUpdate.update_ran = True

from BaseClasses import CollectionState, ItemClassification, MultiWorld # noqa: E402
from Generate import get_seed_name # noqa: E402
from rule_builder.rules import Rule # noqa: E402
from test.general import gen_steps # noqa: E402
from worlds.AutoWorld import AutoWorldRegister, call_all # noqa: E402

PLAYER = 1


class Uncertain(Exception):
  pass


class Unserializable(Exception):
  pass


# Rule types the page's rule engine (js/ruleEngine.js) can evaluate itself. Anything else, and any
# plain python lambda, is marked {"type": "Lambda", "key": ...} and evaluated here, in python, by
# the eval server below.
SUPPORTED_RULE_TYPES = {"True_", "False_", "Has", "HasAll", "HasAny", "HasAllCounts", "HasAnyCount", "And", "Or"}
LAMBDA_OWNERS = {} # key -> access_rule callable, filled by dump()


def version_string(world_type):
  v = world_type.world_version
  if v.major != 0 and v.minor == 0 and v.build == 0:
    return str(v.major)

  return f"{v.major}.{v.minor}.{v.build}"


def world_path(world_type):
  return sys.modules[world_type.__module__].__file__


def list_worlds():
  out = []
  for game, wt in AutoWorldRegister.world_types.items():
    if wt.hidden:
      continue

    out.append({"game": game, "version": version_string(wt), "path": world_path(wt)})

  return sorted(out, key=lambda w: w["game"].lower())


# --- yaml option resolution -------------------------------------------------
# Only values that are certain are accepted:
#   option: value                         -> that value
#   option: {a: 0, b: 0, c: 50}           -> c (exactly one non-zero weight)
# Anything random / ranged / multi-weighted raises Uncertain.
def certain_choice(key, value):
  if isinstance(value, dict):
    live = [k for k, w in value.items() if w]
    if len(live) != 1:
      raise Uncertain(f"{key}: {len(live)} options have a non-zero weight, need exactly 1")

    value = live[0]

  if isinstance(value, str) and (value.startswith("random") or value.startswith("range_")):
    raise Uncertain(f"{key}: '{value}' is random")

  return value


def resolve_options(world_type, section):
  hints = world_type.options_dataclass.type_hints
  unknown = [k for k in section if k not in hints]
  if unknown:
    raise Uncertain(f"yaml has options this world doesn't have: {', '.join(unknown)}")

  resolved = {}
  for name, option_type in hints.items():
    if name not in section:
      resolved[name] = option_type.from_any(option_type.default)
      continue

    raw = section[name]
    # dict/list/set style options (start_inventory, allow_clips, ...) hold their data directly
    # and are not weighted, exactly like Generate.py's handle_option.
    if option_type.supports_weighting:
      raw = certain_choice(name, raw)

    resolved[name] = option_type.from_any(raw)

  return resolved


# --- rule serialisation (unchanged from generate-global-tracker-data.py) ---
def serialize_rule(rule):
  if rule is None:
    return None

  if not dataclasses.is_dataclass(rule):
    return _serialize_value(rule)

  out = {"type": type(rule).__qualname__.replace(".Resolved", "")}
  for f in dataclasses.fields(rule):
    if f.name in ("options", "filtered_resolution"):
      continue

    out[f.name] = _serialize_value(getattr(rule, f.name))

  return out


def _serialize_value(v):
  if dataclasses.is_dataclass(v) and not isinstance(v, type):
    return serialize_rule(v)

  if isinstance(v, (list, tuple, set, frozenset)):
    return [_serialize_value(x) for x in v]

  if isinstance(v, dict):
    return {str(k): _serialize_value(x) for k, x in v.items()}

  if isinstance(v, (str, int, float, bool)) or v is None:
    return v

  if callable(v) and not isinstance(v, Rule):
    raise Unserializable(repr(v))

  if hasattr(v, "name"):
    return v.name

  raise TypeError(f"can't serialize {v!r}")


def _supported(node):
  if isinstance(node, dict):
    if "type" in node and node["type"] not in SUPPORTED_RULE_TYPES:
      return False

    return all(_supported(v) for v in node.values())

  if isinstance(node, list):
    return all(_supported(v) for v in node)

  return True


def owner_rule(owner, key):
  """Serialised access rule of an Entrance/Location. Rules the page can't evaluate become a Lambda
  marker and are remembered in LAMBDA_OWNERS for the eval server."""
  rule = owner.access_rule
  if rule is type(owner).access_rule: # the default "always accessible" lambda
    return None

  if dataclasses.is_dataclass(rule):
    try:
      serialized = serialize_rule(rule)

    except Unserializable:
      serialized = None

    if serialized is not None and _supported(serialized):
      return serialized


  LAMBDA_OWNERS[key] = rule
  return {"type": "Lambda", "key": key}


def build_world(game, resolved, slot_data):
  world_type = AutoWorldRegister.world_types[game]
  multiworld = MultiWorld(1)
  multiworld.game[PLAYER] = game
  multiworld.player_name = {PLAYER: "Tracker"}
  multiworld.set_seed(0)
  random.seed(multiworld.seed)
  multiworld.seed_name = get_seed_name(random)
  if slot_data is not None:
    # Universal Tracker's mechanism: worlds that implement it read their real shuffle (ER pairings
    # etc.) from here instead of rolling their own.
    multiworld.re_gen_passthrough = {game: slot_data}

  args = Namespace()
  for name in world_type.options_dataclass.type_hints:
    setattr(args, name, {PLAYER: resolved[name]})

  multiworld.set_options(args)
  multiworld.state = CollectionState(multiworld)
  world = multiworld.worlds[PLAYER]
  for step in gen_steps:
    call_all(multiworld, step)

  return multiworld, world


def dump(game, multiworld, world):
  data = {
    "game": game,
    "version": version_string(type(world)),
    "origin_region_name": world.origin_region_name,
    "regions": {},
    "entrances": {},
    "locations": {},
    "items": {},
  }
  for region in multiworld.get_regions(PLAYER):
    data["regions"][region.name] = {
      "exits": [e.name for e in region.exits],
      "locations": [loc.name for loc in region.locations],
    }
    for entrance in region.exits:
      data["entrances"][entrance.name] = {
        "connects_to": entrance.connected_region.name if entrance.connected_region else None,
        "rule": owner_rule(entrance, f"ent:{entrance.name}"),
      }


  for item in multiworld.itempool:
    if item.player != PLAYER or item.classification in (ItemClassification.filler, ItemClassification.trap):
      continue

    entry = data["items"].setdefault(item.name, {"count": 0})
    entry["count"] += 1

  for loc in multiworld.get_locations(PLAYER):
    rule = loc.access_rule
    data["locations"][loc.name] = {
      "region": loc.parent_region.name if loc.parent_region else None,
      "rule": owner_rule(loc, f"loc:{loc.name}"),
      "item_dependencies": list(rule.item_dependencies()) if hasattr(rule, "item_dependencies") else None,
      "region_dependencies": list(rule.region_dependencies()) if hasattr(rule, "region_dependencies") else None,
      "is_event": loc.address is None,
      "item": loc.item.name if loc.item else None,
    }

  data["lambda_keys"] = sorted(LAMBDA_OWNERS)
  return data


def eval_server(init):
  """Long-lived: builds the world once, then answers one json line per request on stdin with the
  truth of every Lambda rule for the given received items. Ends when stdin closes (app.py exited)."""
  # AP prints to stdout all the time; keep a private copy of the real stdout for the protocol
  proto = os.fdopen(os.dup(1), "w")
  os.dup2(2, 1)

  def send(obj):
    proto.write(json.dumps(obj) + "\n")
    proto.flush()

  game = init["game"]
  try:
    resolved = resolve_options(AutoWorldRegister.world_types[game], init["options"])

  except Uncertain as e:
    send({"error": str(e)})
    return

  multiworld, world = build_world(game, resolved, init.get("slot_data"))
  dump(game, multiworld, world) # fills LAMBDA_OWNERS
  send({"ready": True, "lambda_keys": sorted(LAMBDA_OWNERS)})

  import traceback

  for line in sys.stdin:
    try:
      items = json.loads(line)["items"]
      state = CollectionState(multiworld)
      for name, count in items.items():
        for _ in range(count):
          state.collect(world.create_item(name), prevent_sweep=True)


      state.sweep_for_advancements() # event locations that became reachable grant their items
      send({"results": {key: bool(rule(state)) for key, rule in LAMBDA_OWNERS.items()}})

    except Exception:
      send({"error": traceback.format_exc()})



def main():
  command, *rest = sys.argv[1:]
  if command == "eval_server":
    eval_server(json.loads(sys.stdin.readline()))
    os._exit(0)

  if command == "list_worlds":
    (out_path,) = rest
    result = list_worlds()
  elif command == "build":
    request_path, out_path = rest
    with open(request_path) as f:
      request = json.load(f)

    game = request["game"]
    if game not in AutoWorldRegister.world_types:
      raise SystemExit(f"game '{game}' is not an installed world")

    try:
      resolved = resolve_options(AutoWorldRegister.world_types[game], request["options"])

    except Uncertain as e:
      result = {"error": str(e)}
    else:
      multiworld, world = build_world(game, resolved, request.get("slot_data"))
      result = {"graph": dump(game, multiworld, world)}

  else:
    raise SystemExit(f"unknown command {command}")

  with open(out_path, "w") as f:
    json.dump(result, f)

  os._exit(0) # skip AP's atexit/thread teardown


main()
