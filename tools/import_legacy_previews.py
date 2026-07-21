#!/usr/bin/env python3
"""Crawl Ansimuz Legacy Collection and copy preview GIFs into the repo.

Prefer idle previews for characters; copy TinyRPG monster/living previews and
key FX previews. Writes assets/img/legacy-previews/ + catalog JSON.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

SRC = Path(r"c:\Users\andre\Downloads\Legacy Collection\Legacy Collection\Assets")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "img" / "legacy-previews"
CATALOG = ROOT / "assets" / "img" / "legacy-previews" / "catalog.json"


def slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "asset"


def pick_score(path: Path) -> tuple:
    """Higher = better candidate for a character's main preview."""
    name = path.name.lower()
    parts = [p.lower() for p in path.parts]
    score = 0
    if "idle" in name:
        score += 100
    if name in ("preview.gif",):
        score += 80
    if "preview" in name:
        score += 40
    if any("preview" in p for p in parts):
        score += 20
    if "unarmed" in name:
        score -= 5
    if any(x in name for x in ("attack", "run", "jump", "hurt", "death", "walk", "hit")):
        score -= 30
    # Prefer smaller files when tied (often cleaner loops); invert size lightly
    return (score, -path.stat().st_size)


def copy_one(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)


def gothicvania_characters() -> list[dict]:
    base = SRC / "Gothicvania" / "Characters"
    items = []
    if not base.is_dir():
        return items
    for char_dir in sorted(p for p in base.iterdir() if p.is_dir()):
        gifs = list(char_dir.rglob("*.gif"))
        if not gifs:
            continue
        best = max(gifs, key=pick_score)
        key = slug(char_dir.name)
        rel = Path("gothicvania") / key / best.name.lower().replace(" ", "-")
        # normalize filename
        dest_name = best.name
        if dest_name.lower() == "preview.gif":
            dest_name = f"{key}-preview.gif"
        elif "idle" not in dest_name.lower():
            dest_name = f"{key}-{dest_name}"
        dest = OUT / "gothicvania" / key / dest_name
        copy_one(best, dest)
        items.append({
            "id": f"gv_{key}",
            "name": char_dir.name.replace("-", " ").replace("_", " "),
            "pack": "Gothicvania",
            "kind": "character",
            "src": str(best.relative_to(SRC)).replace("\\", "/"),
            "file": str(dest.relative_to(ROOT)).replace("\\", "/"),
            "role": "idle" if "idle" in best.name.lower() else "preview",
        })
    return items


def tinyrpg() -> list[dict]:
    items = []
    monsters = SRC / "TinyRPG" / "Characters" / "Battle Sprites" / "Monster Pack Files" / "Previews"
    if monsters.is_dir():
        for gif in sorted(monsters.glob("*.gif")):
            key = slug(gif.stem)
            dest = OUT / "tinyrpg" / "monsters" / f"{key}.gif"
            copy_one(gif, dest)
            items.append({
                "id": f"tr_mon_{key}",
                "name": gif.stem.replace("-", " "),
                "pack": "TinyRPG Monster Pack",
                "kind": "monster",
                "src": str(gif.relative_to(SRC)).replace("\\", "/"),
                "file": str(dest.relative_to(ROOT)).replace("\\", "/"),
                "role": "preview",
            })

    living = SRC / "TinyRPG" / "Characters" / "Battle Sprites" / "Living Pack 1"
    if living.is_dir():
        for gif in sorted(living.rglob("*.gif")):
            key = slug(gif.parent.name if gif.parent.name != "Living Pack 1" else gif.stem)
            dest = OUT / "tinyrpg" / "living" / f"{key}.gif"
            copy_one(gif, dest)
            items.append({
                "id": f"tr_live_{key}",
                "name": key.replace("_", " ").title(),
                "pack": "TinyRPG Living Pack 1",
                "kind": "monster",
                "src": str(gif.relative_to(SRC)).replace("\\", "/"),
                "file": str(dest.relative_to(ROOT)).replace("\\", "/"),
                "role": "preview",
            })
    return items


def fx_previews() -> list[dict]:
    items = []
    fx_root = SRC / "Explosions and Magic"
    if not fx_root.is_dir():
        return items
    # One preview per leaf pack folder that has Preview.gif
    seen = set()
    for gif in sorted(fx_root.rglob("*.gif")):
        if gif.name.lower() not in ("preview.gif",) and "preview" not in gif.name.lower():
            # allow named previews in Previews/ folders
            if "previews" not in [p.lower() for p in gif.parts]:
                continue
        # skip deep hit variants beyond hits-1..3 for brevity? keep all preview.gif + Previews/
        parent_key = slug(gif.parent.name)
        pack_bits = []
        for p in gif.relative_to(fx_root).parts[:-1]:
            pack_bits.append(slug(p))
        key = "_".join(pack_bits) or parent_key
        if key in seen:
            continue
        seen.add(key)
        dest = OUT / "fx" / f"{key}.gif"
        copy_one(gif, dest)
        items.append({
            "id": f"fx_{key}",
            "name": key.replace("_", " "),
            "pack": "Explosions and Magic",
            "kind": "fx",
            "src": str(gif.relative_to(SRC)).replace("\\", "/"),
            "file": str(dest.relative_to(ROOT)).replace("\\", "/"),
            "role": "preview",
        })
    return items


def warped_fantasy_adjacent() -> list[dict]:
    """A few Warped creature idles that could pass as dungeon foes."""
    items = []
    wanted = [
        ("Grotto-escape-2-lizzard", "lizard"),
        ("Grotto-escape-2-snake", "snake"),
        ("alien-walking-enemy", "alien_walker"),
    ]
    base = SRC / "Warped" / "Characters"
    for folder, key in wanted:
        d = base / folder
        if not d.is_dir():
            continue
        gifs = list(d.rglob("*.gif"))
        if not gifs:
            continue
        best = max(gifs, key=pick_score)
        dest = OUT / "warped" / f"{key}.gif"
        copy_one(best, dest)
        items.append({
            "id": f"wp_{key}",
            "name": key.replace("_", " ").title(),
            "pack": "Warped",
            "kind": "character",
            "src": str(best.relative_to(SRC)).replace("\\", "/"),
            "file": str(dest.relative_to(ROOT)).replace("\\", "/"),
            "role": "idle" if "idle" in best.name.lower() else "preview",
        })
    return items


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"Source not found: {SRC}")
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    items = []
    items.extend(gothicvania_characters())
    items.extend(tinyrpg())
    items.extend(warped_fantasy_adjacent())
    items.extend(fx_previews())

    catalog = {
        "version": 1,
        "source": str(SRC),
        "count": len(items),
        "packs": sorted({i["pack"] for i in items}),
        "items": items,
    }
    CATALOG.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"Copied {len(items)} preview GIFs -> {OUT.relative_to(ROOT)}")
    for pack in catalog["packs"]:
        n = sum(1 for i in items if i["pack"] == pack)
        print(f"  {pack}: {n}")


if __name__ == "__main__":
    main()
