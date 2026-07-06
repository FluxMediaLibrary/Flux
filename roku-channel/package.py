#!/usr/bin/env python3
"""
Package the Flux Roku channel for sideloading.
Run from the roku-channel/ directory.

Output: flux-roku-channel.zip
Upload via the Roku Development Application Installer at http://<roku-ip>/
"""

import os
import zipfile
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(ROOT, "flux-roku-channel.zip")

# Files that must be included
REQUIRED_FILES = [
    "manifest",
    "source/main.brs",
    "source/ApiClient.brs",
    "components/MainScene.xml",
    "components/MainScene.brs",
    "components/LoginScreen.xml",
    "components/LoginScreen.brs",
    "components/ProfileSelectScreen.xml",
    "components/ProfileSelectScreen.brs",
    "components/HomeScreen.xml",
    "components/HomeScreen.brs",
    "components/HomeRowItem.xml",
    "components/HomeRowItem.brs",
    "components/LibraryScreen.xml",
    "components/LibraryScreen.brs",
    "components/LibraryGridItem.xml",
    "components/LibraryGridItem.brs",
    "components/DetailScreen.xml",
    "components/DetailScreen.brs",
    "components/PlayerScreen.xml",
    "components/PlayerScreen.brs",
    "components/SearchScreen.xml",
    "components/SearchScreen.brs",
    "components/TmdbDetailScreen.xml",
    "components/TmdbDetailScreen.brs",
    "images/splash-fhd.png",
    "images/splash-hd.png",
    "images/splash-sd.png",
]

def package():
    missing = [f for f in REQUIRED_FILES if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        print("ERROR: Missing required files:")
        for m in missing:
            print(f"  - {m}")
        sys.exit(1)
    
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in REQUIRED_FILES:
            filepath = os.path.join(ROOT, f)
            zf.write(filepath, f)
            print(f"  + {f}")
    
    size_kb = os.path.getsize(OUTPUT) / 1024
    print(f"\nPackaged: {OUTPUT} ({size_kb:.0f} KB)")
    print(f"\nTo sideload:")
    print(f"  1. Enable Developer Mode on your Roku:")
    print(f"     Home x3, Up x2, Right, Left, Right, Left, Right")
    print(f"  2. Open http://<roku-ip>/ in a browser")
    print(f"  3. Upload flux-roku-channel.zip via 'Upload' button")

if __name__ == "__main__":
    package()
