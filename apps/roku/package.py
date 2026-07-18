#!/usr/bin/env python3
"""Package the Roku channel into a zip for sideloading.
Produces forward-slash paths (required by Roku's Linux-based parser).
"""
import zipfile
import os
import sys
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = APP_ROOT / "dist"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Read version from manifest
manifest = APP_ROOT / "manifest"
version = "0.0.0"
if manifest.exists():
    major = minor = build = "0"
    for line in manifest.read_text().splitlines():
        line = line.strip()
        if line.startswith("major_version="):
            major = line.split("=", 1)[1]
        elif line.startswith("minor_version="):
            minor = line.split("=", 1)[1]
        elif line.startswith("build_version="):
            build = line.split("=", 1)[1]
    version = f"{major}.{minor}.{build}"

OUTPUT = OUTPUT_DIR / f"flux-roku-{version}.zip"
if OUTPUT.exists():
    OUTPUT.unlink()

PACK_ITEMS = ["manifest", "source", "components", "images"]
if (APP_ROOT / "locale").exists():
    PACK_ITEMS.append("locale")

with zipfile.ZipFile(str(OUTPUT), "w", zipfile.ZIP_DEFLATED) as zf:
    for item in PACK_ITEMS:
        p = APP_ROOT / item
        if p.is_file():
            zf.write(str(p), item)
        elif p.is_dir():
            for root, dirs, files in os.walk(str(p)):
                for f in files:
                    fpath = Path(root) / f
                    arcname = str(fpath.relative_to(APP_ROOT)).replace("\\", "/")
                    zf.write(str(fpath), arcname)

print(f"Created: {OUTPUT}")
print(f"Size: {OUTPUT.stat().st_size:,} bytes")

# Verify
with zipfile.ZipFile(str(OUTPUT), "r") as zf:
    names = zf.namelist()
    print(f"Entries: {len(names)}")
    for n in names[:5]:
        print(f"  {n}")
    if len(names) > 5:
        print(f"  ...")
    bad = [n for n in names if "\\" in n]
    if bad:
        print(f"ERROR: {len(bad)} entries contain backslashes!")
        sys.exit(1)
    print("All paths use forward slashes. OK.")
