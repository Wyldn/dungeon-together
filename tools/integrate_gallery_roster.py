#!/usr/bin/env python3
"""Integrate enemy-boxes gallery units into game art + generate gallery_units.js.

Reads:
  tools/enemy-box-settings-2026-07-21.json
  tools/roster_worldmap.json
  assets/img/pack-previews/catalog.json
  assets/img/legacy-previews/catalog.json

Writes:
  assets/img/enemies/<id>_idle.png (horizontal strips)
  assets/img/anim/<id>/idle.png (+ other roles when available)
  Patches js/data/artmap.js ENEMY_ART
  Patches js/data/animmap.js ENEMY_ANIM
  js/data/gallery_units.js
  js/data/roster_worlds.js
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit("Pillow required")

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "tools" / "enemy-box-settings-2026-07-21.json"
WORLDMAP = ROOT / "tools" / "roster_worldmap.json"
PACK_CAT = ROOT / "assets" / "img" / "pack-previews" / "catalog.json"
LEGACY_CAT = ROOT / "assets" / "img" / "legacy-previews" / "catalog.json"
ENEMY_DIR = ROOT / "assets" / "img" / "enemies"
ANIM_DIR = ROOT / "assets" / "img" / "anim"
ARTMAP = ROOT / "js" / "data" / "artmap.js"
ANIMMAP = ROOT / "js" / "data" / "animmap.js"


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def stitch_frames(frame_paths: list[Path], dest: Path) -> tuple[int, int, int]:
    """Horizontal stitch; returns fw, fh, n."""
    imgs = []
    for p in frame_paths:
        if not p.is_file():
            continue
        imgs.append(Image.open(p).convert("RGBA"))
    if not imgs:
        raise FileNotFoundError(f"no frames for {dest}")
    fh = max(im.size[1] for im in imgs)
    fw = max(im.size[0] for im in imgs)
    strip = Image.new("RGBA", (fw * len(imgs), fh), (0, 0, 0, 0))
    for i, im in enumerate(imgs):
        x = (fw - im.size[0]) // 2
        y = fh - im.size[1]
        strip.paste(im, (i * fw + x, max(0, y)), im)
    dest.parent.mkdir(parents=True, exist_ok=True)
    strip.save(dest)
    return fw, fh, len(imgs)


def gif_to_strip(gif_path: Path, dest: Path, max_frames: int = 16) -> tuple[int, int, int]:
    im = Image.open(gif_path)
    frames = []
    try:
        while True:
            frames.append(im.convert("RGBA"))
            if len(frames) >= max_frames:
                break
            im.seek(im.tell() + 1)
    except EOFError:
        pass
    if not frames:
        frames = [Image.open(gif_path).convert("RGBA")]
    tmp_dir = dest.parent / "_tmp_frames"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, fr in enumerate(frames):
        p = tmp_dir / f"{i:02d}.png"
        fr.save(p)
        paths.append(p)
    result = stitch_frames(paths, dest)
    shutil.rmtree(tmp_dir, ignore_errors=True)
    return result


def resolve_source(unit_id: str, packs: dict, legacy: dict, custom: dict):
    if unit_id in packs:
        return "pack", packs[unit_id]
    if unit_id in legacy:
        return "legacy", legacy[unit_id]
    # custom may use galleryId
    c = custom.get(unit_id)
    if c:
        gid = c.get("galleryId") or unit_id
        if gid in packs:
            return "pack", packs[gid]
        if gid in legacy:
            return "legacy", legacy[gid]
        if c.get("preview"):
            return "preview", {"preview": c["preview"], "frames": c.get("frames") or [], "id": unit_id}
    return None, None


def build_idle_art(unit_id: str, kind: str, src: dict) -> dict | None:
    """Create enemy idle strip + anim idle; return artmeta."""
    if kind == "pack":
        frames = [ROOT / f for f in (src.get("frames") or []) if (ROOT / f).is_file()]
        preview = ROOT / src["preview"] if src.get("preview") else None
        anim_dir = ANIM_DIR / unit_id
        enemy_still = ENEMY_DIR / f"{unit_id}.png"
        idle_strip = anim_dir / "idle.png"

        if frames:
            fw, fh, n = stitch_frames(frames, idle_strip)
            # also copy first frame as ENEMY_ART still sheet style (multi-frame horizontal)
            shutil.copy2(idle_strip, enemy_still)
        elif preview and preview.suffix.lower() == ".gif":
            fw, fh, n = gif_to_strip(preview, idle_strip)
            shutil.copy2(idle_strip, enemy_still)
        elif preview and preview.is_file():
            shutil.copy2(preview, enemy_still)
            shutil.copy2(preview, idle_strip)
            with Image.open(preview) as im:
                fw, fh = im.size
            n = 1
        else:
            return None

        # Copy other role strips from pack folder when named
        roles = {"idle": "idle"}
        pack_dir = idle_strip.parent
        # source unit folder under pack-previews
        preview_rel = src.get("preview") or ""
        unit_folder = (ROOT / preview_rel).parent if preview_rel else None
        role_map = {
            "attack": ["Attack.png", "Attack1.png", "attack.png", "Attack 1.png"],
            "hurt": ["Get Hit.png", "Take Hit.png", "Take hit.png", "hurt.png", "Get hit.png"],
            "death": ["Death.png", "death.png"],
            "run": ["Run.png", "Walk.png", "run.png", "walk.png"],
        }
        if unit_folder and unit_folder.is_dir():
            for role, names in role_map.items():
                for name in names:
                    cand = unit_folder / name
                    if cand.is_file():
                        # slice strip using guessed frame w = height
                        try:
                            with Image.open(cand) as im:
                                im = im.convert("RGBA")
                                w, h = im.size
                                fw2 = h if w >= h * 2 and w % h == 0 else (w // max(2, w // h) if h else w)
                                if fw2 and w % fw2 == 0 and w // fw2 >= 2:
                                    n2 = w // fw2
                                    out = pack_dir / f"{role}.png"
                                    # keep as-is (already a strip)
                                    shutil.copy2(cand, out)
                                    roles[role if role != "run" else "walk"] = role if role != "run" else "walk"
                                    if role == "attack":
                                        roles["attack"] = "attack"
                                        roles["special"] = "attack"
                                    elif role == "hurt":
                                        roles["hurt"] = "hurt"
                                    elif role == "death":
                                        roles["death"] = "death"
                        except Exception:
                            pass
                        break

        return {
            "art": {"f": f"assets/img/enemies/{unit_id}.png", "w": fw, "h": fh, "frames": n, "anchor": "center"},
            "anim": {
                "fw": fw, "fh": fh, "disp": min(120, max(64, fh)), "anchor": "center",
                "states": {
                    "idle": {"f": f"assets/img/anim/{unit_id}/idle.png", "n": n, "fps": 8, "loop": True}
                },
                "roles": {"idle": "idle", **{k: v for k, v in roles.items() if k != "idle"}},
            },
        }

    if kind == "legacy":
        preview = ROOT / src["file"]
        if not preview.is_file():
            return None
        anim_dir = ANIM_DIR / unit_id
        idle_strip = anim_dir / "idle.png"
        enemy_still = ENEMY_DIR / f"{unit_id}.png"
        if preview.suffix.lower() == ".gif":
            fw, fh, n = gif_to_strip(preview, idle_strip)
        else:
            shutil.copy2(preview, idle_strip)
            with Image.open(preview) as im:
                fw, fh = im.size
            n = 1
        shutil.copy2(idle_strip, enemy_still)
        return {
            "art": {"f": f"assets/img/enemies/{unit_id}.png", "w": fw, "h": fh, "frames": n, "anchor": "center"},
            "anim": {
                "fw": fw, "fh": fh, "disp": min(120, max(64, fh)), "anchor": "center",
                "states": {"idle": {"f": f"assets/img/anim/{unit_id}/idle.png", "n": n, "fps": 8, "loop": True}},
                "roles": {"idle": "idle"},
            },
        }

    if kind == "preview":
        preview = ROOT / src["preview"]
        frames = [ROOT / f for f in src.get("frames") or [] if (ROOT / f).is_file()]
        return build_idle_art(unit_id, "pack", {"preview": src["preview"], "frames": [str(f.relative_to(ROOT)).replace('\\', '/') for f in frames]})

    return None


def patch_js_object(path: Path, export_name: str, new_entries: dict):
    """Insert/replace keys inside `export const NAME = { ... };`."""
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"export const {export_name} = (\{{)", text)
    if not m:
        raise RuntimeError(f"{export_name} not found in {path}")
    # Find matching close of the object at top level — naive: next `\n};` after start for ENEMY_ART
    start = m.end(1) - 1
    # Walk braces
    depth = 0
    end = None
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end is None:
        raise RuntimeError(f"could not find end of {export_name}")
    obj_txt = text[start : end + 1]
    # Parse existing keys roughly — inject by string replace before final }
    # Remove existing keys we will replace
    for key in new_entries:
        obj_txt = re.sub(
            rf'\n "{re.escape(key)}": \{{.*?\n \}},?',
            "\n",
            obj_txt,
            count=1,
            flags=re.S,
        )
    insert = ",\n".join(
        f' "{k}": {json.dumps(v, indent=1).replace(chr(10), chr(10) + " ")}'
        for k, v in sorted(new_entries.items())
    )
    # put before closing }
    obj_txt = obj_txt[:-1].rstrip().rstrip(",") + ",\n" + insert + "\n}"
    text = text[:start] + obj_txt + text[end + 1 :]
    path.write_text(text, encoding="utf-8")


STAT_TEMPLATES = {
    "enemy": {"hp": 34, "atk": 8, "def": 2, "spd": 6, "gold": [10, 20], "xp": 12},
    "elite": {"hp": 52, "atk": 11, "def": 4, "spd": 7, "gold": [18, 32], "xp": 20, "elite": True},
    "boss": {"hp": 340, "atk": 30, "def": 8, "spd": 8, "gold": [90, 130], "xp": 90, "boss": True},
    "npc": {"hp": 70, "atk": 14, "def": 3, "spd": 8, "gold": [36, 60], "xp": 30, "elite": True, "intelligent": True},
}

BIOME_SCALE = {
    "forest": 1.0,
    "ruins": 1.15,
    "frost": 1.35,
    "swamp": 1.55,
    "hell": 1.8,
    "wandering": 1.1,
    "throne": 2.0,
}


def scale_stats(base: dict, world: str) -> dict:
    m = BIOME_SCALE.get(world, 1.0)
    out = dict(base)
    for k in ("hp", "atk", "def", "xp"):
        if k in out:
            out[k] = max(1, int(round(out[k] * m)))
    if "gold" in out:
        a, b = out["gold"]
        out["gold"] = [max(1, int(round(a * m))), max(2, int(round(b * m)))]
    return out


def main():
    export = load_json(EXPORT)
    worldmap = load_json(WORLDMAP)
    packs = {i["id"]: i for i in load_json(PACK_CAT).get("items", [])}
    legacy = {i["id"]: i for i in load_json(LEGACY_CAT).get("items", [])}
    customs = {}
    for c in export.get("customItems") or []:
        gid = c.get("galleryId") or c.get("id")
        customs[gid] = c
        customs[c.get("id")] = c

    renames = worldmap.get("renames") or {}
    art_entries = {}
    anim_entries = {}
    gallery_enemies = {b: [] for b in ["forest", "ruins", "frost", "swamp", "hell"]}
    wandering = []
    gallery_bosses = {}
    gallery_npcs = {}

    # Collect all gallery unit ids we need art for
    need_ids = set()
    for world, buckets in worldmap["worlds"].items():
        for bucket in ("enemy", "elite"):
            for uid in buckets.get(bucket, []):
                need_ids.add(uid)
    for bid in ("tr_mon_demon", "boss_demon_slime", "medieval_king", "undead_executioner",
                "gv_grotto_escape_2_boss_dragon", "tr_mon_centaur", "tr_live_ogre", "gv_demon_files"):
        need_ids.add(bid)
    for nid in worldmap.get("npcs") or []:
        need_ids.add(nid)

    for unit_id in sorted(need_ids):
        kind, src = resolve_source(unit_id, packs, legacy, customs)
        if not src:
            print(f"  SKIP art {unit_id}: no source")
            continue
        meta = build_idle_art(unit_id, kind, src)
        if not meta:
            print(f"  SKIP art {unit_id}: build failed")
            continue
        art_entries[unit_id] = meta["art"]
        anim_entries[unit_id] = meta["anim"]
        print(f"  art {unit_id}")

    # Alias kryos boss art
    if "gv_demon_files" in art_entries:
        art_entries["kryos_demon_general"] = dict(art_entries["gv_demon_files"])
        anim_entries["kryos_demon_general"] = dict(anim_entries["gv_demon_files"])

    # Build unit specs
    def make_unit(uid, category, world, elite=False):
        name = renames.get(uid, uid.replace("_", " ").title())
        tmpl = STAT_TEMPLATES["elite" if elite or category == "elite" else category]
        stats = scale_stats(tmpl, world if world != "wandering" else "forest")
        spec = {"id": uid, "name": name, "glyph": "◆", **stats}
        if elite or category == "elite":
            spec["elite"] = True
        if category == "boss":
            spec["boss"] = True
            spec["biome"] = world
            spec["specials"] = [
                {"at": 3, "name": "Heavy Blow", "mult": 1.6, "desc": "winds up"},
                {"at": 6, "name": "FINISHER", "mult": 2.3, "aoe": True, "desc": "commits everything"},
            ]
            spec["intro"] = f'{name} bars the way.\nThe tower has been waiting for this fight.'
            spec["taunt"] = "CLIMBERS FALL. I REMAIN."
            spec["chargeGain"] = 1
            spec["bankChance"] = 0.55
        else:
            spec["specials"] = [
                {"at": 4, "name": "Strike", "mult": 1.45, "desc": "telegraphs a blow"},
            ]
        if category == "npc":
            spec["intelligent"] = True
            spec["elite"] = True
            spec["enrageAtRound"] = 6
        return spec

    for world, buckets in worldmap["worlds"].items():
        if world == "wandering":
            for uid in buckets.get("enemy", []):
                wandering.append(make_unit(uid, "enemy", "wandering"))
            continue
        if world not in gallery_enemies:
            continue
        for uid in buckets.get("enemy", []):
            gallery_enemies[world].append(make_unit(uid, "enemy", world))
        for uid in buckets.get("elite", []):
            gallery_enemies[world].append(make_unit(uid, "elite", world, elite=True))

    # Boss specs
    boss_defs = {
        "gv_grotto_escape_2_boss_dragon": ("forest", 10, {"hp": 190, "atk": 27, "def": 4, "spd": 3, "gold": [60, 90], "xp": 60}),
        "undead_executioner": ("ruins", 20, {"hp": 340, "atk": 30, "def": 8, "spd": 6, "gold": [90, 130], "xp": 90}),
        "tr_mon_centaur": ("frost", 30, {"hp": 395, "atk": 35, "def": 10, "spd": 8, "gold": [120, 170], "xp": 130, "freeze": 0.25}),
        "tr_live_ogre": ("swamp", 40, {"hp": 550, "atk": 38, "def": 12, "spd": 4, "gold": [160, 220], "xp": 180}),
        "kryos_demon_general": ("hell", 50, {"hp": 655, "atk": 40, "def": 14, "spd": 10, "gold": [220, 300], "xp": 250, "burn": 0.25}),
        "tr_mon_demon": ("throne", 51, {"hp": 640, "atk": 44, "def": 14, "spd": 11, "gold": [0, 0], "xp": 0}),
        "boss_demon_slime": ("throne", 51, {"hp": 640, "atk": 43, "def": 13, "spd": 10, "gold": [0, 0], "xp": 0}),
        "medieval_king": ("throne", 51, {"hp": 700, "atk": 46, "def": 15, "spd": 9, "gold": [0, 0], "xp": 0}),
    }
    for uid, (biome, floor, overrides) in boss_defs.items():
        spec = make_unit(uid, "boss", biome)
        spec.update(overrides)
        spec["name"] = renames.get(uid, spec["name"])
        if uid == "tr_mon_demon":
            spec["intro"] = (
                "Vorath, the Wrathful Demon, unfolds from the throne's shadow.\n"
                '"Every century, one of you reaches this room. Make it interesting."'
            )
            spec["taunt"] = "THE THRONE REMEMBERS WRATH."
            spec["specials"] = [
                {"at": 2, "name": "Wrath Spark", "mult": 1.35, "desc": "heat curls off his horns"},
                {"at": 4, "name": "Kingdom's Weight", "mult": 2.05, "aoe": True, "weaken": 0.4, "desc": "the room leans on you"},
                {"at": 6, "name": "THE KING'S QUESTION", "mult": 2.85, "aoe": True, "frailSure": True, "desc": "the air takes his side"},
            ]
        elif uid == "boss_demon_slime":
            spec["intro"] = (
                "Malqor, the Infernal Slime, crowns itself in molten ooze atop the throne.\n"
                '"Bow — or become part of the realm."'
            )
            spec["taunt"] = "EVERY KINGDOM STARTS AS A PUDDLE."
            spec["specials"] = [
                {"at": 3, "name": "Molten Cleave", "mult": 1.85, "burnSure": True, "desc": "the cleaver drinks fire"},
                {"at": 5, "name": "Acid Coronation", "mult": 2.2, "aoe": True, "poisonSure": True, "desc": "droplets become blades"},
                {"at": 6, "name": "THRONE OF OOZE", "mult": 2.7, "aoe": True, "burnSure": True, "frailSure": True, "desc": "the room liquefies"},
            ]
        elif uid == "medieval_king":
            spec["intro"] = (
                "Aldric, the Corrupt King, steps from behind the throne — crown crooked, smile wrong.\n"
                '"The Demon King was always a story we sold climbers. I am the kingdom."'
            )
            spec["taunt"] = "THE TOWER WAS MY IDEA."
            spec["specials"] = [
                {"at": 2, "name": "Royal Feint", "mult": 1.4, "desc": "a courtly cut"},
                {"at": 4, "name": "Iron Decree", "mult": 2.0, "aoe": True, "weaken": 0.4, "desc": "the crown sheds sparks"},
                {"at": 6, "name": "MASK OFF", "mult": 2.9, "aoe": True, "frailSure": True, "desc": "the secret ends with blood"},
            ]
        elif uid == "kryos_demon_general":
            spec["artId"] = "gv_demon_files"
            spec["intro"] = "Kryos, the Demon General, blocks the Scorch gate with a salute of burning iron."
            spec["taunt"] = "THE DUKE SENDS REGRETS. I DO NOT."
        gallery_bosses[uid] = spec

    for nid in worldmap.get("npcs") or []:
        gallery_npcs[nid] = make_unit(nid, "npc", "ruins")
        # nicer names
        pretty = {
            "evil_wizard": "Malachar the Apostate",
            "evil_wizard_3": "Vexil the Hexwright",
            "archer_hero": "Lyra of the Green Quiver",
            "samurai": "Takeshi of the Quiet Edge",
            "rogue_hero": "Shade of the Twelfth Stair",
            "tr_live_wizard": "Orlan the Wandering Scholar",
            "fantasy_warrior": "Brenna Ironvow",
            "huntress": "Sera of the High Canopy",
            "huntress_2": "Nessa Quickfletch",
            "martial_hero": "Joren of the Open Palm",
            "martial_hero_2": "Kade of the Falling Leaf",
            "martial_hero_3": "Rurik Stormfist",
        }
        if nid in pretty:
            gallery_npcs[nid]["name"] = pretty[nid]

    # Write JS modules
    worlds_js = {
        "placeholders": worldmap["placeholders"],
        "worldOrder": worldmap["worldOrder"],
        "unitWorld": {},
        "wanderingIds": [u["id"] for u in wandering],
        "npcClassPools": worldmap.get("npcClassPools") or {},
        "secretBossId": worldmap.get("secretBoss"),
        "bossPlan": worldmap.get("bosses"),
        "renames": renames,
    }
    for world, buckets in worldmap["worlds"].items():
        for bucket in ("enemy", "elite"):
            for uid in buckets.get(bucket, []):
                worlds_js["unitWorld"][uid] = world
    for uid in gallery_bosses:
        worlds_js["unitWorld"][uid] = gallery_bosses[uid].get("biome", "throne")
    for nid in gallery_npcs:
        worlds_js["unitWorld"][nid] = "npc"

    (ROOT / "js" / "data" / "roster_worlds.js").write_text(
        "// GENERATED by tools/integrate_gallery_roster.py\n"
        + "export const ROSTER = "
        + json.dumps(worlds_js, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    gallery_js = {
        "enemies": gallery_enemies,
        "wandering": wandering,
        "bosses": gallery_bosses,
        "npcs": gallery_npcs,
    }
    (ROOT / "js" / "data" / "gallery_units.js").write_text(
        "// GENERATED by tools/integrate_gallery_roster.py — gallery combat specs\n"
        + "export const GALLERY_ENEMIES = "
        + json.dumps(gallery_enemies, indent=2)
        + ";\n"
        + "export const GALLERY_WANDERING = "
        + json.dumps(wandering, indent=2)
        + ";\n"
        + "export const GALLERY_BOSSES = "
        + json.dumps(gallery_bosses, indent=2)
        + ";\n"
        + "export const GALLERY_NPCS = "
        + json.dumps(gallery_npcs, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    if art_entries:
        patch_js_object(ARTMAP, "ENEMY_ART", art_entries)
    if anim_entries:
        patch_js_object(ANIMMAP, "ENEMY_ANIM", anim_entries)

    print(f"Done: {len(art_entries)} art, {sum(len(v) for v in gallery_enemies.values())} biome adds, "
          f"{len(wandering)} wandering, {len(gallery_bosses)} bosses, {len(gallery_npcs)} npcs")


if __name__ == "__main__":
    main()
