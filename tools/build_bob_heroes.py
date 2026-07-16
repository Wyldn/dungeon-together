"""Build 2-frame bob-idle hero/NPC strips from the rogue sheet + preview settings."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = Path(
    r"C:\Users\andre\.cursor\projects\c-Users-andre-OneDrive-Documents-GitHub-dungeon-together"
    r"\assets\c__Users_andre_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_"
    r"rogues-73ad2abd-2817-4adc-ae7a-296e4dc5365e.png"
)
SETTINGS = ROOT / "tools" / "bob_hero_settings.json"
OUT_HEROES = ROOT / "assets" / "img" / "heroes"
OUT_NPCS = ROOT / "assets" / "img" / "npcs"
CELL = 32
NEAR = 20

# Class → appearance skins (ordered; first is default).
CLASS_SKINS = {
    "warrior": ["warrior1", "warrior2", "warrior3", "warrior4", "warrior5", "warrior6", "warrior7", "warrior8"],
    "mage": ["mage1", "mage2", "mage3", "mage4"],
    "archer": ["ranger", "ranger2"],
    "rogue": ["rogue", "rogue2", "rogue3"],
    "priest": ["priest1", "priest2", "priest3"],
    "warlock": ["warlock1", "warlock2"],
    "bard": ["bard1"],
    "spellsword": ["spellsword1", "spellsword2"],
}

NPC_SKINS = {
    "farmer1": "farmer1",
    "farmer2": "farmer2",
    "farmer3": "farmer3",
    "farmer4": "farmer4",
    "farmer5": "farmer5",
    "farmer6": "farmer6",
    "npc1": "npc1",
    "npc2": "npc2",
    "oldman1": "oldman1",
    "oldman2": "oldman2",
    "viking1": "viking1",
    "viking2": "viking2",
    "viking3": "viking3",
    "viking4": "viking4",
    "viking5": "viking5",
}

SKIN_LABELS = {
    "warrior1": "Vanguard",
    "warrior2": "Phalanx",
    "warrior3": "Raider",
    "warrior4": "Captain",
    "warrior5": "Bulwark",
    "warrior6": "Tower Guard",
    "warrior7": "Champion",
    "warrior8": "Warlord",
    "mage1": "Acolyte",
    "mage2": "Channeler",
    "mage3": "War-Mage",
    "mage4": "Archivist",
    "ranger": "Pathfinder",
    "ranger2": "Scout",
    "rogue": "Cutpurse",
    "rogue2": "Shadow",
    "rogue3": "Duelist",
    "priest1": "Acolyte",
    "priest2": "Chaplain",
    "priest3": "Hierarch",
    "warlock1": "Pactbound",
    "warlock2": "Hexer",
    "bard1": "Troubadour",
    "spellsword1": "Runic Blade",
    "spellsword2": "Arcane Duelist",
}


def clear_bg(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8 or (r + g + b) <= NEAR * 3:
                px[x, y] = (0, 0, 0, 0)
    return im


def occupied(cell: Image.Image) -> bool:
    px = cell.load()
    n = 0
    for y in range(cell.size[1]):
        for x in range(cell.size[0]):
            r, g, b, a = px[x, y]
            if a > 10 and (r + g + b) > NEAR * 3:
                n += 1
                if n > 12:
                    return True
    return False


def draw_bob_frame(src: Image.Image, seam: int, bob_cols: int, bobbing: bool) -> Image.Image:
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    out.paste(src, (0, 0))
    if not bobbing:
        return out

    n = max(1, min(CELL, int(bob_cols)))
    bob_x = CELL - n
    s = max(2, min(CELL - 1, int(seam)))

    # Clear bob band, redraw feet + squashed torso (drop seam-1 row).
    band = Image.new("RGBA", (n, CELL), (0, 0, 0, 0))
    feet = src.crop((bob_x, s, CELL, CELL))
    band.paste(feet, (0, s))
    if s > 1:
        top = src.crop((bob_x, 0, CELL, s - 1))
        band.paste(top, (0, 1))
    out.paste(band, (bob_x, 0))
    if bob_x > 0:
        left = src.crop((0, 0, bob_x, CELL))
        out.paste(left, (0, 0))
    return out


def extract_cells(sheet: Image.Image) -> list[Image.Image]:
    cols, rows = sheet.size[0] // CELL, sheet.size[1] // CELL
    cells = []
    for r in range(rows):
        for c in range(cols):
            cell = sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL))
            if occupied(cell):
                cells.append(clear_bg(cell))
    return cells


def save_strip(base: Image.Image, seam: int, bob_cols: int, path: Path) -> None:
    f0 = draw_bob_frame(base, seam, bob_cols, False)
    f1 = draw_bob_frame(base, seam, bob_cols, True)
    strip = Image.new("RGBA", (CELL * 2, CELL), (0, 0, 0, 0))
    strip.paste(f0, (0, 0))
    strip.paste(f1, (CELL, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(path)


def copy_legacy_npc_art() -> None:
    """Preserve pre-bob class sprites for veteran NPC events."""
    OUT_NPCS.mkdir(parents=True, exist_ok=True)
    mapping = {
        "warrior.png": "old_warrior.png",
        "mage.png": "old_mage.png",
        "archer_old.png": "old_ranger.png",
    }
    for src_name, dst_name in mapping.items():
        src = OUT_HEROES / src_name
        dst = OUT_NPCS / dst_name
        if src.exists() and not dst.exists():
            Image.open(src).convert("RGBA").save(dst)
            print(f"copied legacy {src_name} -> npcs/{dst_name}")


def main() -> None:
    settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
    sheet = Image.open(SHEET).convert("RGBA")
    cells = extract_cells(sheet)
    if len(cells) < 40:
        raise SystemExit(f"expected 40 sprites, got {len(cells)}")

    copy_legacy_npc_art()

    appearances = {}
    for class_id, skins in CLASS_SKINS.items():
        entries = []
        for skin in skins:
            key = next((k for k, v in settings.items() if v.get("name") == skin), None)
            if key is None:
                # allow index lookup via char_NN
                raise SystemExit(f"missing settings for skin {skin}")
            cfg = settings[key]
            idx = cfg["index"]
            cell = cells[idx]
            out = OUT_HEROES / f"{skin}.png"
            save_strip(cell, cfg["seam"], cfg["bobCols"], out)
            entries.append({
                "id": skin,
                "name": SKIN_LABELS.get(skin, skin),
                "f": f"assets/img/heroes/{skin}.png",
                "w": CELL,
                "h": CELL,
                "frames": 2,
            })
            print(f"hero {skin} <- index {idx}")
        appearances[class_id] = entries
        # Also write class-default alias strip (first skin)
        first = entries[0]
        alias = OUT_HEROES / f"{class_id}.png"
        Image.open(ROOT / first["f"]).save(alias)
        print(f"alias {class_id}.png <- {first['id']}")

    npc_meta = {}
    for skin, name in NPC_SKINS.items():
        key = next((k for k, v in settings.items() if v.get("name") == name), None)
        if key is None:
            raise SystemExit(f"missing settings for npc {name}")
        cfg = settings[key]
        cell = cells[cfg["index"]]
        out = OUT_NPCS / f"{skin}.png"
        save_strip(cell, cfg["seam"], cfg["bobCols"], out)
        npc_meta[skin] = {
            "id": skin,
            "f": f"assets/img/npcs/{skin}.png",
            "w": CELL,
            "h": CELL,
            "frames": 2,
        }
        print(f"npc {skin} <- index {cfg['index']}")

    meta = {
        "cell": CELL,
        "appearances": appearances,
        "npcs": npc_meta,
        "labels": SKIN_LABELS,
    }
    (ROOT / "js" / "data" / "appearances.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    # ES module for the game (no JSON import needed).
    js_lines = [
        "// GENERATED by tools/build_bob_heroes.py — bob-idle class skins + NPC art keys.",
        "export const CLASS_APPEARANCES = " + json.dumps(appearances, indent=2) + ";",
        "",
        "export const NPC_ART = " + json.dumps(npc_meta, indent=2) + ";",
        "",
        "export function appearancesFor(classId) {",
        "  return CLASS_APPEARANCES[classId] || [];",
        "}",
        "",
        "export function defaultAppearanceId(classId) {",
        "  return appearancesFor(classId)[0]?.id || classId;",
        "}",
        "",
        "export function appearanceById(classId, appearanceId) {",
        "  const list = appearancesFor(classId);",
        "  return list.find(a => a.id === appearanceId) || list[0] || null;",
        "}",
        "",
        "/** Flat art map: skinId → {f,w,h,frames} plus classId aliases. */",
        "export function buildHeroSkinArt() {",
        "  const out = {};",
        "  for (const [classId, list] of Object.entries(CLASS_APPEARANCES)) {",
        "    for (const a of list) out[a.id] = { f: a.f, w: a.w, h: a.h, frames: a.frames };",
        "    if (list[0]) out[classId] = { f: list[0].f, w: list[0].w, h: list[0].h, frames: list[0].frames };",
        "  }",
        "  return out;",
        "}",
        "",
    ]
    (ROOT / "js" / "data" / "appearances.js").write_text("\n".join(js_lines), encoding="utf-8")
    print(f"ok wrote {len(appearances)} classes + {len(npc_meta)} npc skins")


if __name__ == "__main__":
    main()
