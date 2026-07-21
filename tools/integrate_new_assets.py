"""Convert NEW_ASSETS packs into idle strips under assets/img/enemies/
and refresh ENEMY_ART / BIOME_BG entries in js/data/artmap.js.

Usage:  python tools/integrate_new_assets.py
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
NEW = ROOT / "assets" / "img" / "NEW_ASSETS"
OUT_E = ROOT / "assets" / "img" / "enemies"
OUT_BG = ROOT / "assets" / "img" / "bg"
ARTMAP = ROOT / "js" / "data" / "artmap.js"

OUT_E.mkdir(parents=True, exist_ok=True)
OUT_BG.mkdir(parents=True, exist_ok=True)


def trim(im: Image.Image, pad: int = 2) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def pad_to(im: Image.Image, w: int, h: int) -> Image.Image:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    x = (w - im.width) // 2
    y = h - im.height  # ground-align
    if y < 0:
        y = (h - im.height) // 2
    canvas.paste(im, (x, max(0, y)), im)
    return canvas


def stitch_frames(frames: list[Image.Image], square: bool = False) -> tuple[Image.Image, int, int, int]:
    trimmed = [trim(f) for f in frames]
    mw = max(f.width for f in trimmed)
    mh = max(f.height for f in trimmed)
    if square:
        s = max(mw, mh)
        mw = mh = s
    unified = [pad_to(f, mw, mh) for f in trimmed]
    out = Image.new("RGBA", (mw * len(unified), mh), (0, 0, 0, 0))
    for i, f in enumerate(unified):
        out.paste(f, (i * mw, 0), f)
    return out, mw, mh, len(unified)


def save_strip(path: Path, frames: list[Image.Image], square: bool = False) -> dict:
    strip, w, h, n = stitch_frames(frames, square=square)
    strip.save(path)
    return {"f": f"assets/img/enemies/{path.name}", "w": w, "h": h, "frames": n}


def copy_idle_sheet(src: Path, dest: Path, frame_w: int | None = None, trim_cells: bool = False) -> dict:
    """Copy a horizontal idle strip. Keep original cell size by default so
    characters that sit in a large transparent canvas stay consistent."""
    im = Image.open(src).convert("RGBA")
    if frame_w is None:
        if im.height > 0 and im.width % im.height == 0:
            frames = im.width // im.height
            fw, fh = im.height, im.height
        else:
            for cell in (96, 100, 64, 32, 102, 90):
                if im.width % cell == 0 and (im.height == cell or cell in (90, 102)):
                    frames = im.width // cell
                    fw, fh = cell, im.height
                    break
            else:
                frames = 1
                fw, fh = im.width, im.height
    else:
        fw = frame_w
        fh = im.height
        frames = max(1, im.width // fw)
    if trim_cells:
        cells = [im.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(frames)]
        return save_strip(dest, cells, square=False)
    # Keep sheet as-is (engine reads equal-width frames).
    im.save(dest)
    return {"f": f"assets/img/enemies/{dest.name}", "w": fw, "h": fh, "frames": frames}


def frames_from_dir(folder: Path, pattern_prefix: str) -> list[Image.Image]:
    files = sorted(
        [p for p in folder.iterdir() if p.suffix.lower() == ".png" and p.name.startswith(pattern_prefix)],
        key=lambda p: int(re.search(r"(\d+)", p.stem).group(1)),
    )
    return [Image.open(p).convert("RGBA") for p in files]


def compose_forest_bg() -> None:
    base = NEW / "parallax_forest_pack web" / "parallax_forest_pack web" / "v2" / "layers"
    layers = ["back.png", "middle.png", "front.png"]
    imgs = [Image.open(base / n).convert("RGBA") for n in layers if (base / n).exists()]
    if not imgs:
        return
    canvas = Image.new("RGBA", imgs[0].size, (0, 0, 0, 0))
    for im in imgs:
        canvas = Image.alpha_composite(canvas, im)
    # Upscale 2x nearest for a richer title-adjacent forest backdrop
    canvas = canvas.resize((canvas.width * 2, canvas.height * 2), Image.NEAREST)
    canvas.save(OUT_BG / "forest.png")


def main() -> None:
    entries: dict[str, dict] = {}

    # ---- Rat ----
    rat = NEW / "Rat" / "NoneOutlinedRat" / "rat-idle.png"
    entries["rat"] = copy_idle_sheet(rat, OUT_E / "rat.png", frame_w=32)

    # ---- Slime (baby / regular) ----
    slime = (
        NEW
        / "FreeCharactersAnimationsAssetPack"
        / "FreeCharactersAnimationsAssetPack"
        / "SpriteSheets(96x96)"
        / "Monster_Slime"
        / "No_Shadows"
        / "Monster_Slime_Idle-Sheet.png"
    )
    entries["slime"] = copy_idle_sheet(slime, OUT_E / "slime.png", frame_w=96)

    # ---- Soldier → frozen_soldier ----
    soldier = (
        NEW
        / "FreeCharactersAnimationsAssetPack"
        / "FreeCharactersAnimationsAssetPack"
        / "SpriteSheets(96x96)"
        / "Human_Soldier_Sword_Shield"
        / "No_Shadows"
        / "Human_Soldier_Sword_Shield_Idle-Sheet.png"
    )
    entries["frozen_soldier"] = copy_idle_sheet(soldier, OUT_E / "frozen_soldier.png", frame_w=96)

    # ---- Orc ----
    orc = (
        NEW
        / "Tiny RPG Character Asset Pack 01 v2.0 -Free Soldier&Orc"
        / "Tiny RPG Character Asset Pack 01 v2.0 -Free Soldier&Orc"
        / "Characters(100x100 split)"
        / "Orc"
        / "Orc"
        / "Orc_Idle.png"
    )
    entries["orc"] = copy_idle_sheet(orc, OUT_E / "orc.png", frame_w=100)

    # ---- Golems ----
    golem_blue = (
        NEW
        / "Golems_Free_Version"
        / "Golems_Free_Version"
        / "Golem_1"
        / "Blue"
        / "No_Swoosh_VFX"
        / "Golem_1_idle.png"
    )
    golem_orange = (
        NEW
        / "Golems_Free_Version"
        / "Golems_Free_Version"
        / "Golem_1"
        / "Orange"
        / "No_Swoosh_VFX"
        / "Golem_1_idle.png"
    )
    entries["golem"] = copy_idle_sheet(golem_blue, OUT_E / "golem.png", frame_w=90)
    entries["magma_golem"] = copy_idle_sheet(golem_orange, OUT_E / "magma_golem.png", frame_w=90)

    # ---- Mimic ----
    mimic = NEW / "Mimic_Animation_Pack" / "Mimic_Animation_Pack" / "Sprites" / "Idle.png"
    entries["mimic"] = copy_idle_sheet(mimic, OUT_E / "mimic.png", frame_w=102)

    # ---- Demon slime (evolved form art key) ----
    demon_dir = (
        NEW
        / "boss_demon_slime_FREE_v1.0"
        / "boss_demon_slime_FREE_v1.0"
        / "individual sprites"
        / "01_demon_idle"
    )
    demon_frames = frames_from_dir(demon_dir, "demon_idle_")
    entries["demon_slime"] = save_strip(OUT_E / "demon_slime.png", demon_frames, square=False)

    # ---- Monster Creature pack (single-frame elites / fills) ----
    mon = NEW / "Monster Creature sprites (pack 1 by batareya)"
    monster_map = {
        # fill missing existing enemies
        "vampire": "pixel-0087-4255467705.png",
        "wight": "pixel-0071-2562867672.png",
        "yeti": "pixel-0069-1577086742.png",
        "sin_eater": "pixel-0091-4023341708.png",
        # new / elite / boss art keys
        "dusk_lurker": "pixel-0078-668142568.png",
        "horned_stalker": "pixel-0063-4100537309.png",
        "void_eye": "pixel-0077-668142567.png",
        "mire_abomination": "pixel-0064-4100537310.png",
        "eye_horror": "pixel-0056-900920138.png",
        "crimson_wretch": "pixel-0088-4255467706.png",
        "slag_knight": "pixel-0092-4023341709.png",
        "thornbeast": "pixel-0102-3056965716.png",
        "flame_cyclops": "pixel-0096-362859608.png",
        "spike_sovereign": "pixel-0101-3056965715.png",
        # spare elites kept available
        "void_cultist": "pixel-0067-1577086740.png",
        "blood_fiend": "pixel-0074-2562867675.png",
        "ash_beast": "pixel-0081-116591765.png",
        "ember_maw": "pixel-0082-116591766.png",
        "throne_guard": "pixel-0094-4023341711.png",
        "void_specter": "pixel-0098-362859610.png",
    }
    for eid, fname in monster_map.items():
        im = Image.open(mon / fname).convert("RGBA")
        entries[eid] = save_strip(OUT_E / f"{eid}.png", [im], square=False)

    # Forest backdrop from parallax pack
    compose_forest_bg()

    # ---- Patch artmap.js ENEMY_ART (merge) ----
    text = ARTMAP.read_text(encoding="utf-8")
    m = re.search(r"export const ENEMY_ART = (\{.*?\});", text, re.S)
    if not m:
        raise SystemExit("Could not find ENEMY_ART in artmap.js")
    art = json.loads(m.group(1))
    art.update(entries)
    # Point alt-boss ids at their unique sheets when shared before
    art["heartwood"] = dict(art["thornbeast"])
    art["heartwood"]["f"] = art["thornbeast"]["f"]
    art["ossuary_king"] = dict(art["void_eye"])
    art["ossuary_king"]["f"] = art["void_eye"]["f"]
    art["jarl_whitegrave"] = dict(art["yeti"])
    art["jarl_whitegrave"]["f"] = art["yeti"]["f"]
    art["bogmother"] = dict(art["slime"])  # phase-1 look; phaseArt swaps to demon_slime
    art["bogmother"]["f"] = art["slime"]["f"]
    art["bogmother"]["anchor"] = "center"  # tiny ink in padded sheet
    if "demon_slime" in art:
        art["demon_slime"]["anchor"] = "center"
    if "demon_king" in art:
        art["demon_king"]["anchor"] = "center"
    art["arch_tormentor"] = dict(art["flame_cyclops"])
    art["arch_tormentor"]["f"] = art["flame_cyclops"]["f"]
    art["ashen_sovereign"] = dict(art["spike_sovereign"])
    art["ashen_sovereign"]["f"] = art["spike_sovereign"]["f"]

    new_enemy_block = "export const ENEMY_ART = " + json.dumps(art, indent=1) + ";"
    text = text[: m.start()] + new_enemy_block + text[m.end() :]

    # Ensure forest bg path stays registered
    if "forest" not in text or 'BIOME_BG' in text:
        pass  # BIOME_BG already points at assets/img/bg/forest.png

    ARTMAP.write_text(text, encoding="utf-8")
    print(f"Wrote {len(entries)} enemy strips + patched artmap.js")
    for k, v in sorted(entries.items()):
        print(f"  {k}: {v['w']}x{v['h']} x{v['frames']}")


if __name__ == "__main__":
    main()
