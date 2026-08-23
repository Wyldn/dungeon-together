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


def infer_archetype(uid: str, elite: bool = False) -> str:
    key = uid.lower()
    pairs = (
        ("golem", "construct"), ("mecha", "construct"), ("armor", "construct"),
        ("knight_sheet", "construct"), ("effigy", "construct"), ("congregant", "construct"),
        ("warden", "disruptor"), ("scholar", "disruptor"),
        ("treant", "tank"), ("soldier", "tank"),
        ("toad", "tank"), ("wolf", "assassin"), ("hound", "assassin"),
        ("bat", "assassin"), ("rat", "assassin"), ("nightmare", "assassin"),
        ("slime", "attrition"), ("mushroom", "attrition"), ("frog", "attrition"),
        ("worm", "attrition"), ("haunt", "attrition"), ("vampire", "attrition"),
        ("mummy", "attrition"), ("eye", "controller"), ("skull", "controller"),
        ("ghost", "controller"), ("witch", "controller"), ("ogre", "bruiser"),
        ("demon", "bruiser"), ("knight", "bruiser"), ("goblin", "disruptor"),
        ("skeleton", "disruptor"), ("imp", "disruptor"),
    )
    for needle, arch in pairs:
        if needle in key:
            return arch
    return "bruiser" if elite else "disruptor"


# Compact mirror of js/data/biome_kits.js — runtime applyGalleryKit still wins
# if this ever drifts; regen should not stamp one rider on every trash mob.
_BIOME_TRASH = {
    "forest": {
        "attrition": {"name": "Spore Burst", "poison": 0.45, "desc": "caps swell"},
        "assassin": {"name": "Hamstring", "frail": 0.45, "desc": "goes for the tendon"},
        "controller": {"name": "Hex Glance", "confused": 0.4, "desc": "too many pupils"},
        "disruptor": {"name": "Dirty Feint", "stun": 0.4, "desc": "palms something glinting"},
        "bruiser": {"name": "Crushing Swing", "stun": 0.4, "desc": "puts its weight behind it"},
        "tank": {"name": "Rootgrasp", "lazy": 0.45, "desc": "roots find ankles"},
        "construct": {"name": "Bark Slam", "lazy": 0.35, "desc": "wood remembers being a wall"},
    },
    "ruins": {
        "construct": {"name": "Grindstone", "stun": 0.4, "desc": "gears shriek"},
        "bruiser": {"name": "Oath Cut", "weaken": 0.4, "desc": "a blackened blade rises"},
        "tank": {"name": "Shield Wall", "selfShield": 0.3, "desc": "dust sheets the kite"},
        "attrition": {"name": "Grave Grip", "weaken": 0.45, "desc": "cold fingers find a throat"},
        "controller": {"name": "Hollow Litany", "weaken": 0.35, "aoe": True, "desc": "chants in a dead tongue"},
        "disruptor": {"name": "Bone Shatter", "frail": 0.4, "aoe": True, "desc": "rattles ominously"},
        "assassin": {"name": "Chestgaze", "confused": 0.4, "desc": "eyes on the ribs open"},
    },
    "frost": {
        "controller": {"name": "Numb", "paralyze": 0.45, "desc": "fingers forget their job"},
        "bruiser": {"name": "Rime Slam", "frail": 0.4, "desc": "ice in the knuckles"},
        "tank": {"name": "Ice Wall", "selfShield": 0.3, "desc": "a pane grows between you"},
        "assassin": {"name": "Killing Cold", "paralyze": 0.4, "desc": "breath steams with intent"},
        "attrition": {"name": "Pale Howl", "weaken": 0.35, "aoe": True, "desc": "the cold gains a voice"},
        "disruptor": {"name": "Slip", "lazy": 0.4, "desc": "the floor ices"},
        "construct": {"name": "Ice Wall", "selfShield": 0.3, "desc": "a pane grows between you"},
    },
    "swamp": {
        "attrition": {"name": "Fen Spit", "poison": 0.45, "desc": "the spit is patient"},
        "tank": {"name": "Tongue Lash", "lazy": 0.4, "desc": "something wet uncoils"},
        "assassin": {"name": "Drain Latch", "weaken": 0.45, "desc": "will not let go"},
        "bruiser": {"name": "Death Roll", "frail": 0.4, "desc": "jaws widen past reason"},
        "controller": {"name": "Curdling Hex", "weakenSure": True, "desc": "mutters your name backwards"},
        "disruptor": {"name": "False Dawn", "confused": 0.35, "aoe": True, "desc": "burns suddenly brighter"},
        "construct": {"name": "Peat Crush", "lazy": 0.35, "desc": "the bank gives way"},
    },
    "hell": {
        "assassin": {"name": "Immolating Lunge", "burn": 0.45, "desc": "flame between the teeth"},
        "controller": {"name": "Wrong Psalm", "confused": 0.45, "desc": "the book speaks sideways"},
        "bruiser": {"name": "Slag Haymaker", "stun": 0.4, "desc": "the swing arrives like weather"},
        "attrition": {"name": "Cinder Kiss", "burn": 0.45, "desc": "a haunt leans in"},
        "disruptor": {"name": "Cinder Mock", "weaken": 0.4, "desc": "giggles and points"},
        "tank": {"name": "Slag Guard", "selfShield": 0.3, "desc": "cooling iron between you"},
        "construct": {"name": "Forge Slam", "stun": 0.4, "desc": "fists remember the anvil"},
    },
    "throne": {
        "controller": {"name": "Royal Feint", "confused": 0.4, "desc": "a courtly lie"},
        "bruiser": {"name": "Iron Decree", "weaken": 0.4, "desc": "the crown sheds sparks"},
        "disruptor": {"name": "Protocol", "paralyze": 0.4, "desc": "you are out of order"},
        "assassin": {"name": "Quiet Writ", "frail": 0.4, "desc": "signed in your absence"},
        "attrition": {"name": "Tithe", "weaken": 0.4, "desc": "the court collects"},
        "tank": {"name": "Throne Guard", "selfShield": 0.3, "desc": "the dais has opinions"},
        "construct": {"name": "Edict", "weaken": 0.4, "desc": "carved into the step"},
    },
    "wandering": {
        "assassin": {"name": "Nip Tendon", "frail": 0.45, "desc": "darts for the ankles"},
        "attrition": {"name": "Acid Splash", "poison": 0.35, "aoe": True, "desc": "the blob ripples"},
        "controller": {"name": "Wail", "confused": 0.4, "aoe": True, "desc": "draws a breath it doesn't need"},
        "disruptor": {"name": "Skitter", "stun": 0.35, "desc": "too many feet"},
        "bruiser": {"name": "Heavy Lunge", "stun": 0.35, "desc": "no subtlety left"},
        "tank": {"name": "Hunker", "selfShield": 0.25, "desc": "makes itself a problem"},
        "construct": {"name": "Rattle", "frail": 0.35, "desc": "loose parts, still sharp"},
    },
}


# Elite ladders: setup then payoff. Runtime applyGalleryKit(force) still
# overwrites these names on gallery IDs so JS remains source of truth.
# Keep names in lockstep with js/data/biome_kits.js (suite parity test).
_BIOME_ELITE = {
    "forest": {
        "attrition": [
            {"at": 3, "name": "Spore Pinch", "mult": 1.25, "poison": 0.4, "desc": "a sweet rot"},
            {"at": 6, "name": "Bloom", "mult": 1.45, "aoe": True, "poisonSure": True, "desc": "the air fills with spores"},
        ],
        "assassin": [
            {"at": 3, "name": "Open Vein", "mult": 1.3, "frail": 0.4, "desc": "finds the weak spot"},
            {"at": 5, "name": "Blood Hunt", "mult": 1.7, "vsWounded": 1.25, "frail": 0.3, "desc": "finishes what the pack started"},
        ],
        "controller": [
            {"at": 3, "name": "Bewilder", "mult": 1.2, "confused": 0.45, "desc": "the woods rearrange"},
            {"at": 6, "name": "Lost Path", "mult": 1.5, "aoe": True, "confused": 0.35, "weaken": 0.3, "desc": "north becomes a rumor"},
        ],
        "disruptor": [
            {"at": 3, "name": "Tripwire", "mult": 1.2, "stun": 0.4, "desc": "a snare in the brush"},
            {"at": 5, "name": "Jackal Cut", "mult": 1.55, "weaken": 0.4, "desc": "laughs while it cuts"},
        ],
        "bruiser": [
            {"at": 4, "name": "Tree-Feller", "mult": 1.45, "stun": 0.35, "desc": "the swing starts from the hips"},
            {"at": 6, "name": "Uproot", "mult": 1.7, "aoe": True, "lazy": 0.35, "desc": "the ground disagrees"},
        ],
        "tank": [
            {"at": 4, "name": "Rootquake", "mult": 1.3, "aoe": True, "lazy": 0.4, "desc": "the grove holds you"},
            {"at": 6, "name": "Heartwood", "mult": 1.2, "selfDef": 3, "heal": 0.06, "desc": "rings close over the wound"},
        ],
        "construct": [
            {"at": 3, "name": "Harden", "mult": 1.15, "selfDef": 2, "desc": "sap seals the grain"},
            {"at": 6, "name": "Falling Limb", "mult": 1.6, "aoe": True, "lazy": 0.35, "desc": "a branch decides to be a club"},
        ],
    },
    "ruins": {
        "construct": [
            {"at": 3, "name": "Brace Plates", "mult": 1.15, "selfDef": 3, "desc": "ancient joints lock"},
            {"at": 5, "name": "Quake Stomp", "mult": 1.45, "aoe": True, "lazy": 0.4, "desc": "the floor was a temple"},
        ],
        "bruiser": [
            {"at": 4, "name": "Oathbreaker's Arc", "mult": 1.35, "aoe": True, "weaken": 0.4, "desc": "the vow still cuts"},
            {"at": 6, "name": "Grave Oath", "mult": 1.75, "frailSure": True, "desc": "armor begins to weep"},
        ],
        "tank": [
            {"at": 3, "name": "Lockstep", "mult": 1.2, "selfShield": 0.25, "desc": "the band closes ranks"},
            {"at": 6, "name": "Falling Standard", "mult": 1.55, "aoe": True, "frail": 0.35, "desc": "the banner hits like a hammer"},
        ],
        "attrition": [
            {"at": 3, "name": "Wither Touch", "mult": 1.3, "weaken": 0.4, "desc": "the wrappings drink"},
            {"at": 6, "name": "Dynasty Tax", "mult": 1.55, "heal": 0.08, "frail": 0.35, "desc": "six hundred years of thirst"},
        ],
        "controller": [
            {"at": 3, "name": "Unmake Glance", "mult": 1.35, "confused": 0.45, "desc": "the pupil dilates"},
            {"at": 6, "name": "Forget the Floor", "mult": 1.7, "aoe": True, "confused": 0.35, "desc": "space loses its manners"},
        ],
        "disruptor": [
            {"at": 4, "name": "Rattle Volley", "mult": 1.3, "aoe": True, "frail": 0.35, "desc": "splinters seek joints"},
            {"at": 6, "name": "Collapse", "mult": 1.6, "lazy": 0.35, "desc": "the ribcage remembers falling"},
        ],
        "assassin": [
            {"at": 3, "name": "Mark the Living", "mult": 1.3, "frail": 0.4, "desc": "picks a pulse"},
            {"at": 5, "name": "Horn Dive", "mult": 1.7, "vsWounded": 1.25, "desc": "commits the horns"},
        ],
    },
    "frost": {
        "controller": [
            {"at": 3, "name": "Courtly Spite", "mult": 1.4, "freeze": 0.4, "desc": "December smiles"},
            {"at": 6, "name": "Flash Freeze", "mult": 1.55, "freezeSure": True, "desc": "the air crystallizes"},
        ],
        "bruiser": [
            {"at": 4, "name": "Avalanche Swing", "mult": 1.4, "aoe": True, "frail": 0.35, "desc": "the club is a door"},
            {"at": 6, "name": "Shatter", "mult": 1.8, "vsStatus": "frail", "vsStatusMult": 1.25, "stun": 0.3, "desc": "hits the crack it made"},
        ],
        "tank": [
            {"at": 3, "name": "Rime Plate", "mult": 1.15, "selfDef": 3, "desc": "frost thickens on the mail"},
            {"at": 6, "name": "Glacial Brace", "mult": 1.35, "selfShield": 0.35, "lazy": 0.3, "desc": "the wall leans on you"},
        ],
        "assassin": [
            {"at": 4, "name": "Hoarfrost Bite", "mult": 1.35, "frail": 0.4, "desc": "teeth like icicles"},
            {"at": 6, "name": "Winter Lunge", "mult": 1.7, "vsStatus": "frail", "vsStatusMult": 1.2, "freeze": 0.25, "desc": "the pack finishes the brittle"},
        ],
        "attrition": [
            {"at": 3, "name": "Chill Tax", "mult": 1.25, "weaken": 0.4, "desc": "warmth is collected"},
            {"at": 6, "name": "Whiteout", "mult": 1.5, "aoe": True, "paralyze": 0.35, "desc": "the hall forgets color"},
        ],
        "disruptor": [
            {"at": 3, "name": "Black Ice", "mult": 1.2, "lazy": 0.4, "desc": "a polite hazard"},
            {"at": 5, "name": "Court Reproach", "mult": 1.55, "weaken": 0.4, "desc": "the frozen attendants exhale"},
        ],
        "construct": [
            {"at": 3, "name": "Rime Plate", "mult": 1.15, "selfDef": 3, "desc": "frost thickens"},
            {"at": 6, "name": "Calve", "mult": 1.6, "aoe": True, "frail": 0.35, "desc": "a slab lets go"},
        ],
    },
    "swamp": {
        "attrition": [
            {"at": 3, "name": "Tadpole Fog", "mult": 1.25, "poison": 0.4, "desc": "something hatches in the air"},
            {"at": 6, "name": "Green Miasma", "mult": 1.55, "aoe": True, "poisonSure": True, "desc": "the aura becomes weather"},
        ],
        "tank": [
            {"at": 3, "name": "Glue-Tongue", "mult": 1.3, "lazy": 0.45, "poison": 0.3, "desc": "you are an appointment"},
            {"at": 6, "name": "Swallow", "mult": 1.7, "heal": 0.08, "weaken": 0.35, "desc": "the maw decides"},
        ],
        "assassin": [
            {"at": 3, "name": "Leech Kiss", "mult": 1.35, "weaken": 0.4, "desc": "a polite theft"},
            {"at": 5, "name": "Empty You", "mult": 1.65, "vsWounded": 1.2, "heal": 0.06, "desc": "finishes the drink"},
        ],
        "bruiser": [
            {"at": 4, "name": "Uproot & Swing", "mult": 1.45, "aoe": True, "stun": 0.35, "desc": "a sapling becomes a club"},
            {"at": 6, "name": "Bog Slam", "mult": 1.75, "frail": 0.4, "desc": "the mire applauds"},
        ],
        "controller": [
            {"at": 3, "name": "Wrong Recipe", "mult": 1.3, "weaken": 0.4, "desc": "the cauldron notices you"},
            {"at": 6, "name": "The Old Recipe", "mult": 1.7, "aoe": True, "lazy": 0.4, "desc": "it boils over"},
        ],
        "disruptor": [
            {"at": 3, "name": "Will-Light", "mult": 1.2, "confused": 0.4, "desc": "the path lies"},
            {"at": 6, "name": "Drown the Compass", "mult": 1.5, "aoe": True, "lazy": 0.35, "desc": "down becomes a suggestion"},
        ],
        "construct": [
            {"at": 4, "name": "Sink", "mult": 1.3, "lazy": 0.45, "desc": "the floor is optional"},
            {"at": 6, "name": "Fen Collapse", "mult": 1.6, "aoe": True, "poison": 0.3, "desc": "everything goes under"},
        ],
    },
    "hell": {
        "assassin": [
            {"at": 3, "name": "Cinder Snap", "mult": 1.35, "burn": 0.4, "desc": "a playful ignition"},
            {"at": 5, "name": "Chase the Smoke", "mult": 1.7, "vsStatus": "burn", "vsStatusMult": 1.2, "burn": 0.3, "desc": "hunts the one already alight"},
        ],
        "controller": [
            {"at": 3, "name": "Burning Gaze", "mult": 1.4, "burnSure": True, "desc": "pupils ignite"},
            {"at": 6, "name": "Chorus of Ash", "mult": 1.7, "aoe": True, "confused": 0.35, "desc": "every eye a different doom"},
        ],
        "bruiser": [
            {"at": 4, "name": "Magma Haymaker", "mult": 1.45, "aoe": True, "stun": 0.3, "desc": "knuckles go white"},
            {"at": 6, "name": "Core Hit", "mult": 1.8, "vsStatus": "burn", "vsStatusMult": 1.2, "desc": "cashes the heat"},
        ],
        "attrition": [
            {"at": 3, "name": "Ember Tax", "mult": 1.3, "burn": 0.4, "desc": "takes a little warmth"},
            {"at": 6, "name": "Ash Bloom", "mult": 1.55, "aoe": True, "burnSure": True, "desc": "the room snows cinders"},
        ],
        "disruptor": [
            {"at": 3, "name": "Tantrum", "mult": 1.2, "aoe": True, "weaken": 0.35, "desc": "too much joy"},
            {"at": 6, "name": "Scatter Coals", "mult": 1.5, "frail": 0.4, "desc": "the floor is a grate"},
        ],
        "tank": [
            {"at": 3, "name": "Molten Brace", "mult": 1.2, "selfDef": 2, "desc": "the plate re-pours"},
            {"at": 6, "name": "Core Detonation", "mult": 1.55, "aoe": True, "burnSure": True, "desc": "chest-runes overbrighten"},
        ],
        "construct": [
            {"at": 3, "name": "Vent", "mult": 1.3, "aoe": True, "burn": 0.35, "desc": "slag-heat"},
            {"at": 6, "name": "Re-Forge", "mult": 1.2, "selfDef": 3, "heal": 0.05, "desc": "the cracks weld shut"},
        ],
    },
    "throne": {
        "controller": [
            {"at": 3, "name": "The Story", "mult": 1.3, "confused": 0.45, "desc": "the throne sells a tale"},
            {"at": 6, "name": "Mask Off", "mult": 1.8, "aoe": True, "frailSure": True, "desc": "the secret ends in blood"},
        ],
        "bruiser": [
            {"at": 4, "name": "Kingdom's Weight", "mult": 1.5, "aoe": True, "weaken": 0.4, "desc": "the room leans on you"},
            {"at": 6, "name": "The Question", "mult": 1.85, "frailSure": True, "desc": "the air takes a side"},
        ],
        "disruptor": [
            {"at": 3, "name": "Contempt", "mult": 1.25, "weaken": 0.45, "desc": "filed under insolent"},
            {"at": 6, "name": "Summary Judgment", "mult": 1.75, "tormented": 0.4, "desc": "the ledger closes"},
        ],
        "assassin": [
            {"at": 3, "name": "Name You", "mult": 1.35, "frail": 0.4, "desc": "the throne learned it"},
            {"at": 6, "name": "Execute", "mult": 1.85, "vsWounded": 1.25, "vsStatus": "frail", "vsStatusMult": 1.2, "desc": "the sentence arrives"},
        ],
        "attrition": [
            {"at": 3, "name": "Rent", "mult": 1.3, "weaken": 0.4, "desc": "due on demand"},
            {"at": 6, "name": "The Invoice", "mult": 1.7, "tormented": 0.45, "heal": 0.06, "desc": "unpaid interest"},
        ],
        "tank": [
            {"at": 3, "name": "Hold Court", "mult": 1.2, "selfDef": 3, "desc": "nobody sits without leave"},
            {"at": 6, "name": "Crownfall", "mult": 1.6, "aoe": True, "frail": 0.35, "desc": "gold is still heavy"},
        ],
        "construct": [
            {"at": 4, "name": "Law of Stone", "mult": 1.3, "lazy": 0.4, "desc": "the floor agrees with the king"},
            {"at": 6, "name": "Seal", "mult": 1.55, "selfShield": 0.3, "desc": "wax and iron"},
        ],
    },
    "wandering": {
        "assassin": [
            {"at": 3, "name": "Nip", "mult": 1.25, "frail": 0.4, "desc": "a small, ugly cut"},
            {"at": 5, "name": "Pile-On", "mult": 1.55, "vsWounded": 1.2, "desc": "the rest arrive"},
        ],
        "attrition": [
            {"at": 3, "name": "Drip", "mult": 1.2, "poison": 0.4, "desc": "it is always dripping"},
            {"at": 6, "name": "Split", "mult": 1.45, "aoe": True, "poisonSure": True, "desc": "one becomes several problems"},
        ],
        "controller": [
            {"at": 3, "name": "Unquiet", "mult": 1.25, "confused": 0.4, "desc": "a name you almost know"},
            {"at": 6, "name": "Haunt", "mult": 1.5, "weaken": 0.4, "desc": "it stands in the doorway"},
        ],
        "disruptor": [
            {"at": 3, "name": "Startle", "mult": 1.2, "stun": 0.4, "desc": "from the rafters"},
            {"at": 5, "name": "Scatter", "mult": 1.45, "aoe": True, "frail": 0.3, "desc": "they come back"},
        ],
        "bruiser": [
            {"at": 4, "name": "Corner", "mult": 1.4, "stun": 0.35, "desc": "the hall shrinks"},
            {"at": 6, "name": "Body Check", "mult": 1.65, "frail": 0.35, "desc": "mass is the plan"},
        ],
        "tank": [
            {"at": 3, "name": "Brace", "mult": 1.15, "selfDef": 2, "desc": "it came to stay"},
            {"at": 6, "name": "Shoulder", "mult": 1.5, "lazy": 0.3, "desc": "you are the door"},
        ],
        "construct": [
            {"at": 4, "name": "Shed", "mult": 1.25, "aoe": True, "frail": 0.35, "desc": "screws and teeth"},
            {"at": 6, "name": "Seize", "mult": 1.5, "lazy": 0.35, "desc": "a hand that was a tool"},
        ],
    },
}


def assign_biome_kit(spec: dict, world: str, elite: bool = False) -> None:
    arch = infer_archetype(spec.get("id") or "", elite)
    if elite:
        elite_table = _BIOME_ELITE.get(world) or _BIOME_ELITE["wandering"]
        ladder = elite_table.get(arch) or elite_table.get("bruiser")
        if ladder:
            spec["specials"] = [dict(s) for s in ladder]
            return
    table = _BIOME_TRASH.get(world) or _BIOME_TRASH["wandering"]
    row = table.get(arch) or table.get("disruptor") or {"name": "Strike"}
    special = {"at": 4, "mult": 1.45, **row}
    spec["specials"] = [special]


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
            assign_biome_kit(spec, world if world != "wandering" else "wandering",
                             elite or category == "elite")
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
