#!/usr/bin/env python3
"""
Runs `tsc --checkJs --noEmit js/**/*.js`, finds "Cannot find name 'X'" errors,
and for each X that resolves to exactly one `static X` declaration in js/,
prefixes the usage site with the enclosing class name (ClassName.X).

Usage: python3 fix_static_refs.py
Run from the directory that contains the js/ folder.
"""
import glob
import re
import subprocess
import sys
from collections import defaultdict

ERROR_RE = re.compile(r"^(?P<file>[^(]+)\((?P<line>\d+),(?P<col>\d+)\): error TS2304: Cannot find name '(?P<name>[^']+)'\.$")
STATIC_RE_TMPL = r"static\s+{name}\b"
CLASS_RE = re.compile(r"^\s*class\s+(\w+)")


def run_tsc():
    files = sorted(glob.glob("js/**/*.js", recursive=True))
    if not files:
        print("No files matched js/**/*.js", file=sys.stderr)
        sys.exit(1)
    proc = subprocess.run(
        ["tsc", "--checkJs", "--noEmit", *files],
        capture_output=True, text=True,
    )
    return proc.stdout


def parse_errors(tsc_output):
    errors = []
    for line in tsc_output.splitlines():
        if "Cannot find" not in line:
            continue
        m = ERROR_RE.match(line)
        if not m:
            print(f"WARNING: unrecognized 'Cannot find' line, skipping: {line}", file=sys.stderr)
            continue
        errors.append({
            "file": m.group("file"),
            "line": int(m.group("line")),
            "col": int(m.group("col")),
            "name": m.group("name"),
        })
    return errors


def find_static_declaration(name):
    pattern = STATIC_RE_TMPL.format(name=re.escape(name))
    proc = subprocess.run(
        ["grep", "-rnE", pattern, "js"],
        capture_output=True, text=True,
    )
    matches = [l for l in proc.stdout.splitlines() if l.strip()]
    if len(matches) != 1:
        return None
    match_file, match_line, _ = matches[0].split(":", 2)
    return match_file, int(match_line)


def find_enclosing_class(file_path, decl_line):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    for i in range(decl_line - 1, -1, -1):
        m = CLASS_RE.match(lines[i])
        if m:
            return m.group(1)
    return None


def prefix_usage(file_path, line_no, col_no, name, class_name):
    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    idx = line_no - 1
    text = lines[idx]
    col_idx = col_no - 1
    if text[col_idx:col_idx + len(name)] != name:
        raise RuntimeError(
            f"{file_path}:{line_no}:{col_no} does not contain identifier '{name}' "
            f"(found {text[col_idx:col_idx + len(name)]!r}); refusing to guess."
        )
    lines[idx] = text[:col_idx] + f"{class_name}.{name}" + text[col_idx + len(name):]
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


def main():
    tsc_output = run_tsc()
    errors = parse_errors(tsc_output)
    if not errors:
        print("No 'Cannot find name' errors found.")
        return

    by_name = defaultdict(list)
    for err in errors:
        by_name[err["name"]].append(err)

    for name, occurrences in by_name.items():
        decl = find_static_declaration(name)
        if decl is None:
            print(f"SKIP '{name}': not exactly one `static {name}` match in js/")
            continue
        decl_file, decl_line = decl
        class_name = find_enclosing_class(decl_file, decl_line)
        if class_name is None:
            print(f"SKIP '{name}': found static decl at {decl_file}:{decl_line} but no enclosing class")
            continue

        # Sort right-to-left within each line so earlier edits on the same
        # line don't shift columns of later ones.
        occurrences.sort(key=lambda e: (e["file"], e["line"], -e["col"]))
        for occ in occurrences:
            prefix_usage(occ["file"], occ["line"], occ["col"], name, class_name)
            print(f"FIXED {occ['file']}:{occ['line']}:{occ['col']} '{name}' -> '{class_name}.{name}'")


if __name__ == "__main__":
    main()
