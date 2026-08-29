import sys, json, os, random
from argparse import Namespace

if "AP_SOURCE_DIR" not in os.environ or not os.environ["AP_SOURCE_DIR"]:
  print('AP_SOURCE_DIR must be set, eg AP_SOURCE_DIR="/home/nyix/projects/Archipelago"')
  os._exit(1)

if "TRACKER_FILE_OUT_DIR" not in os.environ or not os.environ["TRACKER_FILE_OUT_DIR"]:
  print('TRACKER_FILE_OUT_DIR not set - defaulting to ., set with TRACKER_FILE_OUT_DIR="/home/nyix/trackerFiles"')
  TRACKER_FILE_OUT_DIR = "."
else:
  TRACKER_FILE_OUT_DIR = os.environ["TRACKER_FILE_OUT_DIR"]

sys.path.insert(0, os.environ["AP_SOURCE_DIR"])

GAME = sys.argv[1] if len(sys.argv) == 2 else "Vex2"

g = os.path.join(os.environ["AP_SOURCE_DIR"], "Generate.py")
with open(g, "r") as f:
  text = f.read()

  with open(g, "w") as f:
    _ = f.write(text.replace("ModuleUpdate.update()", ""))

  from worlds import AutoWorld
  from worlds.AutoWorld import AutoWorldRegister, call_all
  from BaseClasses import MultiWorld, CollectionState
  from Generate import get_seed_name
  from test.general import gen_steps

  import dataclasses
  from rule_builder.rules import Rule

  with open(g, "w") as f:
    _ = f.write(text)


def serialize_rule(rule):
  if rule is None:
    return None

  if not dataclasses.is_dataclass(rule):
    return _serialize_value(rule)

  out = {"type": type(rule).__name__}
  for f in dataclasses.fields(rule):
    if f.name in ("options", "filtered_resolution"):
      continue # internal/solver state, not logic data

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
    # AP's default access_rule (unset -> lambda state: True) or any other
    # plain callable that isn't a rule_builder Rule object.
    return {"type": "True_", "note": "default/unset rule (always accessible)"}

  if hasattr(v, "name"):
    return v.name

  print(f"something went wrong, {v}, {v!r}")
  return str(v)


PLAYER = 1
OPTIONS = {} # override option values here, e.g. {"goal": "stage10"}


def build_world(seed=None):
  world_type = AutoWorldRegister.world_types[GAME]

  multiworld = MultiWorld(1)
  multiworld.game[PLAYER] = GAME
  multiworld.player_name = {PLAYER: "Tracker"}
  multiworld.set_seed(seed)
  random.seed(multiworld.seed)
  multiworld.seed_name = get_seed_name(random)

  args = Namespace()
  for name, option in world_type.options_dataclass.type_hints.items():
    setattr(args, name, {PLAYER: option.from_any(OPTIONS.get(name, option.default))})

  multiworld.set_options(args)
  multiworld.state = CollectionState(multiworld)

  world = multiworld.worlds[PLAYER]
  for step in gen_steps:
    call_all(multiworld, step)

  return multiworld, world


def dump(multiworld, world):
  v = world.world_version
  try:
    if v.major != 0 and v.minor == 0 and v.build == 0:
      v = v[0]
    else:
      v = f"{v.major},{v.minor},{v.build}"


  except Exception:
    try:
      v = f"{v.major},{v.minor},{v.build}"

    except Exception:
      v = "0"


  data = {
    "game": GAME,
    "version": v,
    "origin_region_name": world.origin_region_name,
    "regions": {},
    "locations": {},
    "entrances": {},
  }

  for region in multiworld.get_regions(PLAYER):
    data["regions"][region.name] = {
      "exits": [e.name for e in region.exits],
      "locations": [l.name for l in region.locations],
    }
    for entrance in region.exits:
      data["entrances"][entrance.name] = {
        "connects_to": entrance.connected_region.name if entrance.connected_region else None,
        "rule": serialize_rule(entrance.access_rule),
      }


  for loc in multiworld.get_locations(PLAYER):
    data["locations"][loc.name] = {
      "region": loc.parent_region.name if loc.parent_region else None,
      "rule": serialize_rule(loc.access_rule),
      "item_dependencies": list(loc.access_rule.item_dependencies()) if hasattr(loc.access_rule, "item_dependencies") else None,
      "region_dependencies": list(loc.access_rule.region_dependencies()) if hasattr(loc.access_rule, "region_dependencies") else None,
      # Event locations hold event items used purely for logic (e.g. "beat stageX")
      # and are never part of the shuffled item pool. AP marks these by giving
      # them no address (address is None) -- real, checkable locations always
      # have an integer/tuple address assigned by the world.
      "is_event": loc.address is None,
    }

  return data


if __name__ == "__main__":
  multiworld, world = build_world(seed=0)
  data = dump(multiworld, world)
  filename = f"{GAME}_tracker_rules_{data['version']}.json"
  with open(os.path.join(TRACKER_FILE_OUT_DIR, filename), "w") as f:
    json.dump(data, f, indent=2)

  print(f"\n\nSUCCESS\nwrote {filename}")
