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


# --- CLI parsing -------------------------------------------------------
# Usage:
#   python generate-global-tracker-data.py [GAME] [--options NAME v1,v2 NAME2 v1,v2 ...]
#   python generate-global-tracker-data.py [GAME] [--profiles PROFILES]
#
# --options NAME v1,v2 ...
#   Declares one or more "axes" to sweep, e.g.:
#     --options walls_are_checks True,False eggs_are_checks True,False
#   generates every combination (cartesian product) as its own profile.
#   These axes are also saved to a metadata file next to the output JSON
#   (<GAME>_tracker_options_meta.json), and merged with anything already
#   saved there from previous runs -- so on later runs you don't have to
#   restate --options at all; it's picked up automatically. Passing
#   --options again adds to / extends the saved axes rather than replacing
#   them outright.
#
# --profiles PROFILES
#   Full manual control: a JSON string (or "@file.json") mapping profile
#   name -> option overrides dict, e.g.
#     '{"default": {}, "hard_goal": {"goal": "stage10"}}'
#   Bypasses the metadata file entirely -- use this when you need named
#   profiles or multi-option combos that aren't a clean cartesian sweep.
#
# If neither flag is given, saved metadata (if any) is used automatically;
# if there's no metadata either, a single "default" profile runs (old
# single-run behavior).
def _parse_args(argv):
  positional = [a for a in argv if not a.startswith("--")]
  game = positional[0] if positional else "Vex2"

  profiles_arg = None
  options_axes = None # {name: [raw string values]}

  i = 0
  while i < len(argv):
    a = argv[i]
    if a == "--profiles" and i + 1 < len(argv):
      profiles_arg = argv[i + 1]
      i += 2
      continue
    elif a.startswith("--profiles="):
      profiles_arg = a.split("=", 1)[1]
      i += 1
      continue
    elif a == "--options":
      options_axes = {}
      i += 1
      # consume NAME value_list pairs until the next --flag or end of argv
      while i + 1 < len(argv) and not argv[i].startswith("--"):
        name = argv[i]
        values = [v.strip() for v in argv[i + 1].split(",") if v.strip() != ""]
        options_axes[name] = values
        i += 2

      continue

    i += 1

  if profiles_arg is not None:
    if profiles_arg.startswith("@"):
      with open(profiles_arg[1:], "r") as f:
        profiles = json.load(f)

    else:
      profiles = json.loads(profiles_arg)

    if not isinstance(profiles, dict) or not profiles:
      print('--profiles must be a non-empty JSON object of {"name": {option: value, ...}, ...}')
      os._exit(1)

    return game, profiles, None

  # no --profiles: either use --options axes (merged with saved metadata),
  # or fall back to metadata alone, resolved later once we can validate
  # option names/types against the loaded world.
  return game, None, (options_axes or {})


GAME, PROFILES_OVERRIDE, OPTIONS_AXES = _parse_args(sys.argv[1:])

g = os.path.join(os.environ["AP_SOURCE_DIR"], "Generate.py")
with open(g, "r") as f:
  text = f.read()

  with open(g, "w") as f:
    _ = f.write(text.replace("ModuleUpdate.update()", ""))

  from worlds import AutoWorld
  from worlds.AutoWorld import AutoWorldRegister, call_all
  from BaseClasses import MultiWorld, CollectionState, ItemClassification
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

  out = {"type": type(rule).__qualname__.replace(".Resolved", "")}
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
META_PATH = os.path.join(TRACKER_FILE_OUT_DIR, f"{GAME}_tracker_options_meta.json")


def _load_metadata():
  if not os.path.exists(META_PATH):
    return {}

  try:
    with open(META_PATH, "r") as f:
      return json.load(f)


  except Exception as e:
    print(f"[WARN] couldn't read {META_PATH} ({e}), starting fresh")
    return {}


def _save_metadata(axes):
  with open(META_PATH, "w") as f:
    json.dump(axes, f, indent=2)


def _validate_and_resolve_axes(raw_axes, world_type):
  """Checks each option name still exists on world_type and each value still
  parses under its current option type. Drops + warns on anything that
  doesn't (covers options that were removed/renamed, or whose type changed
  since the values were saved). Returns a cleaned {name: [values]} dict."""
  hints = world_type.options_dataclass.type_hints
  resolved = {}
  for name, values in raw_axes.items():
    if name not in hints:
      print(f"[WARN] option '{name}' does not exist on {GAME} (removed/renamed?) - skipping it")
      continue

    option_type = hints[name]
    good_values = []
    for v in values:
      try:
        option_type.from_any(v)
        good_values.append(v)

      except Exception as e:
        print(f"[WARN] value '{v}' is not valid for option '{name}' on {GAME} ({type(e).__name__}: {e}) - skipping this value")


    if not good_values:
      print(f"[WARN] option '{name}' had no valid values left after validation - skipping it entirely")
      continue

    resolved[name] = good_values

  return resolved


def _build_profiles_from_axes(axes):
  """axes: {name: [values]} -> cartesian product of profiles, e.g.
  {"walls_are_checks": ["True","False"], "eggs_are_checks": ["True","False"]}
  becomes 4 profiles named like 'walls_are_checks=True,eggs_are_checks=False'."""
  if not axes:
    return {"default": {}}

  import itertools

  names = list(axes.keys())
  value_lists = [axes[n] for n in names]

  total = 1
  for vs in value_lists:
    total *= len(vs)

  if total > 200:
    print(f"[WARN] {total} option combinations - this will build {total} full worlds and may take a while")

  profiles = {}
  for combo in itertools.product(*value_lists):
    options = dict(zip(names, combo))
    profile_name = ",".join(f"{n}={v}" for n, v in options.items())
    profiles[profile_name] = options

  return profiles


def build_world(options, seed=None):
  if GAME not in AutoWorldRegister.world_types:
    print("[ERROR] GAME MUST BE ONE OF\n-------------------------------\n" + ("\n".join(AutoWorldRegister.world_types.keys())) + "\n-------------------------------")
    os._exit(1)

  world_type = AutoWorldRegister.world_types[GAME]

  multiworld = MultiWorld(1)
  multiworld.game[PLAYER] = GAME
  multiworld.player_name = {PLAYER: "Tracker"}
  multiworld.set_seed(seed)
  random.seed(multiworld.seed)
  multiworld.seed_name = get_seed_name(random)

  args = Namespace()
  for name, option in world_type.options_dataclass.type_hints.items():
    setattr(args, name, {PLAYER: option.from_any(options.get(name, option.default))})

  multiworld.set_options(args)
  multiworld.state = CollectionState(multiworld)

  world = multiworld.worlds[PLAYER]
  for step in gen_steps:
    call_all(multiworld, step)

  return multiworld, world


def resolve_profiles():
  """Figures out the final {profile_name: options_dict} set to build, using
  whichever of --profiles / --options / saved metadata applies, validating
  option names/types against the currently-loaded world along the way."""
  if PROFILES_OVERRIDE is not None:
    # --profiles was passed explicitly: validate the option names/values it
    # references, but don't touch the metadata file.
    if GAME not in AutoWorldRegister.world_types:
      print("[ERROR] GAME MUST BE ONE OF\n-------------------------------\n" + ("\n".join(AutoWorldRegister.world_types.keys())) + "\n-------------------------------")
      os._exit(1)

    world_type = AutoWorldRegister.world_types[GAME]
    hints = world_type.options_dataclass.type_hints
    for profile_name, options in PROFILES_OVERRIDE.items():
      for opt_name, val in options.items():
        if opt_name not in hints:
          print(f"[WARN] profile '{profile_name}': option '{opt_name}' does not exist on {GAME} - it will be ignored (default used instead)")
        else:
          try:
            hints[opt_name].from_any(val)

          except Exception as e:
            print(f"[WARN] profile '{profile_name}': value '{val}' is not valid for option '{opt_name}' on {GAME} ({type(e).__name__}: {e}) - it will be ignored (default used instead)")




    return PROFILES_OVERRIDE

  # --options and/or saved metadata path
  if GAME not in AutoWorldRegister.world_types:
    print("[ERROR] GAME MUST BE ONE OF\n-------------------------------\n" + ("\n".join(AutoWorldRegister.world_types.keys())) + "\n-------------------------------")
    os._exit(1)

  world_type = AutoWorldRegister.world_types[GAME]

  saved_axes = _load_metadata()

  # merge any freshly-passed --options axes into what's saved (union of
  # values per option name), so repeated runs accumulate rather than reset.
  merged_axes = {k: list(v) for k, v in saved_axes.items()}
  for name, values in OPTIONS_AXES.items():
    existing = merged_axes.get(name, [])
    for v in values:
      if v not in existing:
        existing.append(v)


    merged_axes[name] = existing

  resolved_axes = _validate_and_resolve_axes(merged_axes, world_type)

  # persist the validated set back to disk so next run doesn't need
  # --options restated at all.
  if resolved_axes:
    _save_metadata(resolved_axes)

  return _build_profiles_from_axes(resolved_axes)


def dump(multiworld, world):
  v = world.world_version
  try:
    if v.major != 0 and v.minor == 0 and v.build == 0:
      v = v[0]
    else:
      v = f"{v.major}.{v.minor}.{v.build}"


  except Exception:
    try:
      v = f"{v.major}.{v.minor}.{v.build}"

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


  # NOTE: this used to be nested inside the region loop, which re-processed
  # every location once per region (harmless but wasteful, and now that we
  # run this per-profile it's worth not repeating). Locations aren't tied to
  # a single region's exit list, so this only needs to run once per world.
  # Item pool counts, ignoring filler items (junk items with no logical
  # significance, e.g. generic "trap" or currency filler). Non-filler items
  # (progression, useful, trap, or plain non-filler) are counted by name.
  item_counts = {}
  for item in multiworld.itempool:
    if item.player != PLAYER:
      continue

    if item.classification == ItemClassification.filler or item.classification == ItemClassification.trap:
      continue

    item_counts[item.name] = item_counts.get(item.name, 0) + 1

  data["items"] = item_counts

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
      # The actual item placed at this location. Always populated for event
      # locations (assigned immediately by add_event); for regular locations
      # it'll be None here since real items aren't filled until a later gen
      # step. The tracker uses this to know which item an event grants,
      # since multiple distinct event locations can share one item name
      # (e.g. all 26 "star can be got" events grant "flag:starCanBeGot").
      "item": loc.item.name if loc.item else None,
    }

  return data


# --- Multi-profile merging ---------------------------------------------
# Runs `dump()` once per settings profile, then folds the results together.
# Any field that comes out identical across every profile is stored once,
# as before. Any field that differs between profiles is instead stored as
# {"_by_profile": {profile_name: value, ...}} so the tracker can tell it's
# settings-dependent and look up the right value for whatever profile the
# player is running.
VARIES_MARKER = "_by_profile"


def _merge_values(by_profile_value):
  """by_profile_value: dict of profile_name -> value (already JSON-safe).
  Returns the shared value if all profiles agree, else a _by_profile marker dict."""
  values = list(by_profile_value.values())
  first_json = json.dumps(values[0], sort_keys=True)
  if all(json.dumps(v, sort_keys=True) == first_json for v in values[1:]):
    return values[0]

  return {VARIES_MARKER: by_profile_value}


def _merge_dict_of_records(per_profile_dicts, field_names):
  """per_profile_dicts: dict of profile_name -> {record_name: {field: value}}.
  Returns {record_name: {field: merged_value}} using _merge_values per field."""
  # collect the union of record names in case a profile is missing one
  # (shouldn't normally happen for the same game/seed, but be defensive)
  all_record_names = set()
  for d in per_profile_dicts.values():
    all_record_names.update(d.keys())

  merged = {}
  for record_name in all_record_names:
    merged_record = {}
    for field in field_names:
      by_profile = {profile: d.get(record_name, {}).get(field) for profile, d in per_profile_dicts.items()}
      merged_record[field] = _merge_values(by_profile)

    merged[record_name] = merged_record

  return merged


def build_and_dump_all_profiles(profiles):
  per_profile_data = {}
  for profile_name, options in profiles.items():
    multiworld, world = build_world(options, seed=0)
    per_profile_data[profile_name] = dump(multiworld, world)

  first = next(iter(per_profile_data.values()))

  merged = {
    "game": first["game"],
    "version": first["version"],
    "origin_region_name": _merge_values({p: d["origin_region_name"] for p, d in per_profile_data.items()}),
    "profiles": {name: opts for name, opts in profiles.items()},
    "regions": _merge_dict_of_records(
      {p: d["regions"] for p, d in per_profile_data.items()},
      ["exits", "locations"],
    ),
    "entrances": _merge_dict_of_records(
      {p: d["entrances"] for p, d in per_profile_data.items()},
      ["connects_to", "rule"],
    ),
    "locations": _merge_dict_of_records(
      {p: d["locations"] for p, d in per_profile_data.items()},
      ["region", "rule", "item_dependencies", "region_dependencies", "is_event", "item"],
    ),
    # Item pool (name -> count), filler excluded. Wrapped as {"count": n}
    # per item so it can reuse the same _merge_dict_of_records machinery as
    # the other record types above (varies-by-profile if counts differ).
    "items": _merge_dict_of_records(
      {p: {name: {"count": count} for name, count in d["items"].items()} for p, d in per_profile_data.items()},
      ["count"],
    ),
  }
  return merged


if __name__ == "__main__":
  profiles = resolve_profiles()
  data = build_and_dump_all_profiles(profiles)
  filename = f"{GAME}_tracker_rules_{data['version']}.json"
  with open(os.path.join(TRACKER_FILE_OUT_DIR, filename), "w") as f:
    json.dump(data, f, indent=2)

  profile_names = ", ".join(profiles.keys())
  print(f"\n\nSUCCESS\nwrote {filename} (profiles: {profile_names})")
