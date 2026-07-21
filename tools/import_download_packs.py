#!/usr/bin/env python3
"""Extract download packs into per-unit idle previews + animation catalogs.

Each character becomes its own gallery card with an animated idle GIF when
possible (sliced from horizontal strips or known multi-row sheets).

Output: assets/img/pack-previews/ + catalog.json
"""
from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None

DOWNLOADS = Path(r"c:\Users\andre\Downloads")
ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "tools" / "spritestage" / "pack_import"
OUT = ROOT / "assets" / "img" / "pack-previews"
CATALOG = OUT / "catalog.json"
ATTACHED = Path(
    r"C:\Users\andre\.cursor\projects\c-Users-andre-OneDrive-Documents-GitHub-dungeon-together\assets"
)

ZIPS = [
    ("Fire Worm.zip", "enemy", "fire_worm"),
    ("Monsters Creatures Fantasy 2.zip", "enemy", "mcf2"),
    ("Monster_Creatures_Fantasy(Version 1.3).zip", "enemy", "mcf1"),
    ("Red hood free (zipped) Folder.zip", "enemy", "red_hood"),
    ("Medieval King Pack 2_ALT_BOSS.zip", "boss", "medieval_king"),
    ("Mecha-stone Golem 0.1_ENEMY.zip", "enemy", "mecha_golem"),
    ("Knight -Armor_BAND_OF_KNIGHTS.zip", "elite", "band_of_knights"),
    ("Undead executioner_BOSS.zip", "boss", "undead_executioner"),
    ("ArcherHero_NPC.zip", "npc", "archer_hero"),
    ("FREE_Samurai 2D Pixel Art v1.2.zip", "npc", "samurai"),
    ("EVil Wizard 2.zip", "enemy", "evil_wizard"),
    ("boss_demon_slime_FREE_v1.0.zip", "boss", "boss_demon_slime"),
    # NPC hero packs (LuizMelo / similar strip packs)
    ("Evil Wizard 3.zip", "npc", "evil_wizard_3"),
    ("Martial Hero.zip", "npc", "martial_hero"),
    ("Martial Hero 2.zip", "npc", "martial_hero_2"),
    ("Martial Hero 3.zip", "npc", "martial_hero_3"),
    ("Huntress.zip", "npc", "huntress"),
    ("Huntress 2.zip", "npc", "huntress_2"),
    ("Fantasy Warrior.zip", "npc", "fantasy_warrior"),
    ("Skeleton enemy.zip", "enemy", "skeleton_enemy"),
]

ANIM_ALIASES = {
    "idle": "idle",
    "idle_closed": "idle",
    "idle_open": "idle_open",
    "idle_transformed": "idle",
    "idle2": "idle2",
    "idling": "idle",
    "idle and running": "idle_run",
    "walk": "walk",
    "run": "run",
    "running": "run",
    "fly": "fly",
    "fall": "fall",
    "jump": "jump",
    "jumping": "jump",
    "attack": "attack",
    "attack1": "attack1",
    "attack2": "attack2",
    "attack3": "attack3",
    "attack_1": "attack1",
    "attack_2": "attack2",
    "attacking": "attack",
    "high attack": "attack_high",
    "low attack": "attack_low",
    "normal attack": "attack",
    "attack_bite": "attack",
    "spinattack": "spin_attack",
    "spin attack": "spin_attack",
    "leap": "leap",
    "taunt": "taunt",
    "hurt": "hurt",
    "get hit": "hurt",
    "take hit": "hurt",
    "take hit - white silhouette": "hurt",
    "death": "death",
    "rat-death": "death",
    "dash": "dash",
    "skill1": "special",
    "summon": "summon",
    "summonappear": "summon_appear",
    "summondeath": "summon_death",
    "summonidle": "summon_idle",
    "opening": "open",
    "transform": "transform",
    "fly-to-fall": "fly_to_fall",
}


def slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "asset"


def norm_anim(stem: str) -> str:
    k = stem.strip().lower().replace("_", " ")
    k2 = k.replace(" ", "_")
    if k in ANIM_ALIASES:
        return ANIM_ALIASES[k]
    if k2 in ANIM_ALIASES:
        return ANIM_ALIASES[k2]
    for key, val in ANIM_ALIASES.items():
        if key in k or key.replace(" ", "_") in k2:
            return val
    return slug(stem)


def extract_zips() -> None:
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    for name, _cat, _key in ZIPS:
        src = DOWNLOADS / name
        if not src.is_file():
            print(f"MISSING {name}")
            continue
        dest = STAGE / src.stem
        dest.mkdir(parents=True)
        with zipfile.ZipFile(src, "r") as z:
            z.extractall(dest)
        n = sum(1 for p in dest.rglob("*") if p.is_file())
        print(f"extracted {name}: {n} files")

    att = STAGE / "_attached"
    att.mkdir(exist_ok=True)
    if ATTACHED.is_dir():
        for p in ATTACHED.glob("*.png"):
            if "RogueHero" in p.name or "mm-crawl" in p.name:
                short = p.name
                if "RogueHero" in p.name:
                    short = "RogueHero_NPC.png"
                elif "mm-crawl" in p.name:
                    short = "pink_slime_crawl.png"
                shutil.copy2(p, att / short)
                print(f"attached {short}")

    rar = DOWNLOADS / "sheets.rar"
    rar_dest = STAGE / "sheets"
    rar_dest.mkdir(exist_ok=True)
    if rar.is_file():
        try:
            import rarfile  # type: ignore

            with rarfile.RarFile(rar) as rf:
                rf.extractall(rar_dest)
            print(f"extracted sheets.rar: {sum(1 for _ in rar_dest.rglob('*') if _.is_file())} files")
        except Exception as e:
            print(f"sheets.rar not extracted ({e}); using attached RogueHero/slime if present")


def pngs_under(root: Path) -> list[Path]:
    return sorted(
        p for p in root.rglob("*.png")
        if p.is_file() and "aseprite" not in p.name.lower()
    )


def measure(path: Path) -> dict:
    if not Image:
        return {}
    try:
        with Image.open(path) as im:
            w, h = im.size
        return {"w": w, "h": h}
    except Exception:
        return {}


def pick_idle_source(files: list[Path]) -> Path | None:
    if not files:
        return None
    scored = []
    for p in files:
        name = p.stem.lower()
        score = 0
        if name in ("idle", "idle_closed", "idling"):
            score += 120
        elif name.startswith("idle") and "open" not in name:
            score += 100
        elif "idle" in name and "run" not in name:
            score += 90
        elif "idle" in name:
            score += 70
        elif name == "preview":
            score += 20
        if any(x in name for x in ("attack", "death", "hurt", "hit", "run", "walk", "bomb", "sword", "projectile", "laser", "explosion")):
            score -= 40
        scored.append((score, -p.stat().st_size, p))
    scored.sort(reverse=True)
    return scored[0][2] if scored[0][0] > 0 else scored[0][2]


def guess_strip_frame_w(im_or_w, h: int | None = None) -> int | None:
    """Best frame width for a horizontal strip (content-aware when given an image)."""
    if Image and isinstance(im_or_w, Image.Image):
        im = im_or_w.convert("RGBA")
        w, h = im.size
    else:
        w, h = int(im_or_w), int(h or 0)
        im = None
    if h <= 0 or w < max(16, h):
        return None

    def score_fw(fw: int) -> float:
        n = w // fw
        if n < 2:
            return 1e9
        # Prefer frame aspect in a typical character range
        aspect = fw / h
        score = 0.0 if 0.6 <= aspect <= 2.2 else 35.0
        score += abs(fw - h) * 0.12
        if im is None:
            return score
        widths = []
        for i in range(n):
            fr = im.crop((i * fw, 0, (i + 1) * fw, h))
            bb = fr.getbbox()
            if not bb:
                score += 25
                continue
            # Heavy penalty when ink is clipped at the frame edge (wrong cut → "teleport")
            if bb[2] >= fw - 1:
                score += 50
            if bb[0] <= 0 and bb[2] - bb[0] < fw * 0.35:
                score += 8
            widths.append(bb[2] - bb[0])
        if len(widths) >= 2:
            mean = sum(widths) / len(widths)
            var = sum((x - mean) ** 2 for x in widths) / len(widths)
            score += var * 0.08
        return score

    candidates = []
    for n in range(2, min(48, w // 8 + 1)):
        if w % n != 0:
            continue
        fw = w // n
        if fw < 8:
            continue
        candidates.append((score_fw(fw), fw))
    if w % h == 0 and h >= 8:
        candidates.append((score_fw(h), h))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]


def frames_from_strip(im: Image.Image, fw: int | None = None) -> list[Image.Image]:
    w, h = im.size
    fw = fw or guess_strip_frame_w(im)
    if not fw or w % fw != 0:
        return [im.copy()]
    frames = []
    for x in range(0, w, fw):
        fr = im.crop((x, 0, x + fw, h)).convert("RGBA")
        if fr.getbbox():
            frames.append(fr)
    return frames or [im.copy()]


def frames_from_grid(im: Image.Image, fw: int, fh: int, row: int = 0, max_frames: int | None = None) -> list[Image.Image]:
    w, h = im.size
    if w % fw or h % fh:
        return []
    y0 = row * fh
    if y0 + fh > h:
        return []
    frames = []
    cols = w // fw
    for c in range(cols):
        fr = im.crop((c * fw, y0, (c + 1) * fw, y0 + fh)).convert("RGBA")
        if fr.getbbox():
            frames.append(fr)
        if max_frames and len(frames) >= max_frames:
            break
    return frames


def stabilize_frame(fr: Image.Image, tw: int, th: int) -> Image.Image:
    """Horizontally center + feet-pin ink so idle loops don't jitter in the gallery."""
    rgba = fr.convert("RGBA")
    bb = rgba.getbbox()
    out = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    if not bb:
        return out
    cropped = rgba.crop(bb)
    x = (tw - cropped.width) // 2
    y = th - cropped.height - max(0, (th - cropped.height) // 8)
    if y < 0:
        y = 0
    out.paste(cropped, (x, y), cropped)
    return out


def save_gif(frames: list[Image.Image], dest: Path, duration_ms: int = 120) -> bool:
    if not Image or not frames:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    # Pillow GIF needs palette; keep transparency via disposal
    converted = []
    for fr in frames:
        rgba = fr.convert("RGBA")
        # composite on transparent; quantize per-frame via save params
        converted.append(rgba)
    try:
        converted[0].save(
            dest,
            save_all=True,
            append_images=converted[1:],
            duration=duration_ms,
            loop=0,
            disposal=2,
            optimize=False,
        )
        return True
    except Exception as e:
        print(f"  gif failed {dest.name}: {e}")
        # fallback: first frame PNG
        converted[0].save(dest.with_suffix(".png"))
        return False


def make_idle_preview(src: Path, dest_dir: Path, *,
                      fw: int | None = None, fh: int | None = None,
                      row: int = 0, max_frames: int | None = None,
                      duration_ms: int = 120,
                      preview_mode: str = "loop") -> dict | None:
    """Slice idle frames; write frame_XX.png (+ idle.gif for loop). Return preview meta."""
    if not Image or not src or not src.is_file():
        return None
    with Image.open(src) as raw:
        im = raw.convert("RGBA")
    w, h = im.size

    frames: list[Image.Image] = []
    used_fw = fw
    used_fh = fh or h
    if fw and fh:
        frames = frames_from_grid(im, fw, fh, row=row, max_frames=max_frames)
        used_fh = fh
    elif fh and not fw:
        if h % fh == 0 and row * fh + fh <= h:
            strip = im.crop((0, row * fh, w, row * fh + fh))
            frames = frames_from_strip(strip)
            used_fw = frames[0].size[0] if frames else None
            used_fh = fh
    else:
        if h > 0 and w >= max(h, 16) * 1.5:
            frames = frames_from_strip(im, fw)
            used_fw = frames[0].size[0] if frames else guess_strip_frame_w(im)
            used_fh = h
        else:
            frames = [im.copy()]
            used_fw, used_fh = w, h

    if not frames:
        frames = [im.copy()]
        used_fw, used_fh = frames[0].size

    if max_frames and len(frames) > max_frames:
        frames = frames[:max_frames]

    tw = used_fw or frames[0].size[0]
    th = used_fh or frames[0].size[1]
    frames = [stabilize_frame(fr, tw, th) for fr in frames]

    frame_rels = []
    for i, fr in enumerate(frames):
        path = dest_dir / f"frame_{i:02d}.png"
        fr.save(path)
        frame_rels.append(str(path.relative_to(ROOT)).replace("\\", "/"))

    mode = preview_mode if len(frames) >= 2 else "still"
    preview_rel = frame_rels[0]
    if mode == "loop" and len(frames) >= 2:
        gif_path = dest_dir / "idle.gif"
        if save_gif(frames, gif_path, duration_ms=duration_ms):
            preview_rel = str(gif_path.relative_to(ROOT)).replace("\\", "/")

    return {
        "preview": preview_rel,
        "previewMode": mode,
        "frames": frame_rels,
        "frameW": used_fw or frames[0].size[0],
        "frameH": used_fh or frames[0].size[1],
        "fps": round(1000 / max(duration_ms, 1), 2),
    }


def collect_anims(files: list[Path], character_root: Path) -> list[dict]:
    anims = []
    for p in files:
        role = norm_anim(p.stem)
        rel = str(p.relative_to(character_root)).replace("\\", "/")
        meta = measure(p)
        anims.append({"role": role, "file": p.name, "rel": rel, **meta})
    by_role: dict[str, dict] = {}
    for a in anims:
        key = a["role"]
        if key not in by_role:
            by_role[key] = a
        else:
            i = 2
            while f"{key}_{i}" in by_role:
                i += 1
            if a["file"] != by_role[key]["file"]:
                by_role[f"{key}_{i}"] = {**a, "role": f"{key}_{i}"}
    return list(by_role.values())


def add_unit(
    items: list,
    *,
    unit_id: str,
    name: str,
    pack: str,
    category: str,
    unit_root: Path,
    anim_files: list[Path],
    idle_src: Path | None = None,
    idle_fw: int | None = None,
    idle_fh: int | None = None,
    idle_row: int = 0,
    idle_max: int | None = None,
    note: str | None = None,
    duration_ms: int = 120,
    preview_mode: str = "loop",
) -> None:
    dest_dir = OUT / slug(pack) / slug(unit_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = []
    for p in anim_files:
        dest = dest_dir / p.name
        if dest.exists() and dest.stat().st_size != p.stat().st_size:
            dest = dest_dir / f"{slug(p.parent.name)}_{p.name}"
        shutil.copy2(p, dest)
        copied.append(dest)

    src = idle_src or pick_idle_source(anim_files)
    if src and src.exists():
        pred = dest_dir / src.name
        if not pred.exists():
            shutil.copy2(src, pred)

    meta = make_idle_preview(
        src if src and src.exists() else (copied[0] if copied else None),
        dest_dir,
        fw=idle_fw,
        fh=idle_fh,
        row=idle_row,
        max_frames=idle_max,
        duration_ms=duration_ms,
        preview_mode=preview_mode,
    ) or {}

    anims = collect_anims(copied, dest_dir)
    item = {
        "id": unit_id,
        "name": name,
        "pack": pack,
        "category": category,
        "preview": meta.get("preview"),
        "previewMode": meta.get("previewMode", "still"),
        "frames": meta.get("frames") or ([] if not meta.get("preview") else [meta["preview"]]),
        "frameW": meta.get("frameW"),
        "frameH": meta.get("frameH"),
        "fps": meta.get("fps", 8),
        "animations": [a["role"] for a in anims],
        "animationDetails": anims,
        "fileCount": len(copied),
        "idleSource": src.name if src else None,
    }
    if note:
        item["note"] = note
    items.append(item)
    print(
        f"  + {unit_id} ({item['previewMode']}, {len(item['frames'])}f "
        f"{item.get('frameW')}x{item.get('frameH')}) idle={src.name if src else '?'}"
    )


def import_fire_worm(items: list):
    root = next(STAGE.glob("Fire Worm*/Fire Worm"), None) or next(STAGE.glob("**/Fire Worm"), None)
    if not root:
        return
    worm = root / "Sprites" / "Worm"
    files = [p for p in pngs_under(worm) if p.is_file()]
    idle = next((p for p in files if p.stem.lower() == "idle"), None)
    add_unit(
        items,
        unit_id="fire_worm",
        name="Fire Worm",
        pack="Fire Worm",
        category="enemy",
        unit_root=root,
        anim_files=files,
        idle_src=idle,
        note="Idle strip (worm body)",
    )


def import_mcf2(items: list):
    candidates = sorted(STAGE.glob("**/Monsters Creatures Fantasy 2"), key=lambda p: len(p.parts), reverse=True)
    root = None
    for cand in candidates:
        names = {p.name.lower() for p in cand.iterdir() if p.is_dir()}
        if names & {"bat", "mimic", "rat", "slime"}:
            root = cand
            break
    if not root and candidates:
        root = candidates[0]
    if not root:
        return
    # Bat has no idle — use fly
    prefs = {
        "bat": ("fly", None),
        "mimic": ("idle_closed", None),
        "rat": ("idle", None),
        "slime": ("idle", None),
    }
    for sub in sorted(p for p in root.iterdir() if p.is_dir()):
        files = [p for p in pngs_under(sub) if "preview" not in p.name.lower()]
        if not files:
            continue
        prefer, _ = prefs.get(sub.name.lower(), ("idle", None))
        idle = next((p for p in files if p.stem.lower() == prefer), None) or pick_idle_source(files)
        add_unit(
            items,
            unit_id=f"mcf2_{slug(sub.name)}",
            name=sub.name,
            pack="Monsters Creatures Fantasy 2",
            category="enemy",
            unit_root=sub,
            anim_files=files,
            idle_src=idle,
        )


def import_mcf1(items: list):
    candidates = sorted(
        STAGE.glob("**/Monster_Creatures_Fantasy(Version 1.3)"),
        key=lambda p: len(p.parts),
        reverse=True,
    )
    root = None
    for cand in candidates:
        names = {p.name.lower() for p in cand.iterdir() if p.is_dir()}
        if names & {"flying eye", "goblin", "mushroom", "skeleton"}:
            root = cand
            break
    if not root and candidates:
        root = candidates[0]
    if not root:
        return
    skip = ("bomb", "sword", "projectile", " fores")
    for sub in sorted(p for p in root.iterdir() if p.is_dir()):
        files = [
            p for p in pngs_under(sub)
            if not any(x in p.name.lower() for x in skip)
        ]
        if not files:
            continue
        idle = next((p for p in files if "attack" in p.stem.lower()), None) or files[0]
        add_unit(
            items,
            unit_id=f"mcf1_{slug(sub.name)}",
            name=sub.name,
            pack="Monster Creatures Fantasy 1.3",
            category="enemy",
            unit_root=sub,
            anim_files=files,
            idle_src=idle,
            note="Pack incomplete (no idle; Attack3 strip as preview)",
        )


def import_red_hood(items: list):
    sheets = [p for p in STAGE.glob("**/red hood*.png") if p.suffix.lower() == ".png"]
    sheets += [p for p in STAGE.glob("**/Red hood*/**/*.png") if "sheet" in p.name.lower()]
    sheets = list({p.resolve(): p for p in sheets}.values())
    if not sheets:
        return
    sheet = max(sheets, key=lambda p: p.stat().st_size)
    # Ink pitch ≈112×133 → 12×11 grid
    add_unit(
        items,
        unit_id="red_hood",
        name="Red Hood",
        pack="Red Hood Free",
        category="enemy",
        unit_root=sheet.parent,
        anim_files=[sheet],
        idle_src=sheet,
        idle_fw=112,
        idle_fh=133,
        idle_row=0,
        idle_max=12,
        note="Idle from row 0 of full sheet (112×133 cells)",
    )


def import_king(items: list):
    root = next(STAGE.glob("**/Medieval King Pack 2"), None)
    if not root:
        return
    sprites = root / "Sprites"
    files = pngs_under(sprites if sprites.exists() else root)
    idle = next((p for p in files if p.stem.lower() == "idle"), None)
    add_unit(
        items,
        unit_id="medieval_king",
        name="Medieval King",
        pack="Medieval King Pack 2",
        category="boss",
        unit_root=root,
        anim_files=files,
        idle_src=idle,
        idle_fw=160,  # 1280×111 → 8 frames (auto near-square wrongly picked 128)
    )


def import_golem(items: list):
    root = next(STAGE.glob("**/Mecha-stone Golem 0.1"), None)
    if not root:
        return
    sheet = next((p for p in pngs_under(root) if "character_sheet" in p.name.lower()), None)
    if not sheet:
        return
    # 10×10 of 100px — first row = idle walk cycle
    add_unit(
        items,
        unit_id="mecha_golem",
        name="Mecha-stone Golem",
        pack="Mecha-stone Golem",
        category="enemy",
        unit_root=root,
        anim_files=[sheet],
        idle_src=sheet,
        idle_fw=100,
        idle_fh=100,
        idle_row=0,
        note="Idle from row 0 of Character_sheet (projectiles omitted)",
    )


def import_knights(items: list):
    root = next(STAGE.glob("Knight -Armor_BAND_OF_KNIGHTS"), None)
    if not root:
        return
    main = next((p for p in pngs_under(root) if p.name.lower() == "knight sheet.png"), None)
    if main:
        add_unit(
            items,
            unit_id="knight_armor",
            name="Knight Armor",
            pack="Band of Knights",
            category="elite",
            unit_root=root,
            anim_files=[main],
            idle_src=main,
            idle_fw=43,
            preview_mode="step",
            note="Helmet/pose variants — use ◀ ▶ to step (not a loop)",
        )
    for p in pngs_under(root):
        if "alt heads" in p.name.lower() and p.suffix.lower() == ".png":
            label = p.stem.replace("Knight sheet alt heads", "Knight").strip(" -")
            add_unit(
                items,
                unit_id=f"knight_{slug(p.stem)}",
                name=label or p.stem,
                pack="Band of Knights",
                category="elite",
                unit_root=root,
                anim_files=[p],
                idle_src=p,
                idle_fw=80 if measure(p).get("w") == 480 else 43,
                preview_mode="step",
                note="Alt head variants — use ◀ ▶ to step",
            )


def import_executioner(items: list):
    root = next(STAGE.glob("**/Undead executioner puppet"), None)
    if not root:
        return
    png = root / "png"
    files = pngs_under(png if png.exists() else root)
    idle = next((p for p in files if p.stem.lower() == "idle"), None)
    add_unit(
        items,
        unit_id="undead_executioner",
        name="Undead Executioner",
        pack="Undead Executioner",
        category="boss",
        unit_root=root,
        anim_files=files,
        idle_src=idle,
    )


def import_archer(items: list):
    roots = list(STAGE.glob("ArcherHero*/Final")) or list(STAGE.glob("**/ArcherHero*/Final"))
    root = roots[0] if roots else None
    if not root:
        return
    files = [p for p in pngs_under(root) if p.suffix.lower() == ".png"]
    idle_run = next((p for p in files if "idle" in p.stem.lower() and "run" in p.stem.lower()), None)
    # 8×2 of 64×64 — row 0 idle (2 frames), row 1 run (8 frames)
    add_unit(
        items,
        unit_id="archer_hero",
        name="Archer Hero",
        pack="ArcherHero",
        category="npc",
        unit_root=root,
        anim_files=files,
        idle_src=idle_run,
        idle_fw=64,
        idle_fh=64,
        idle_row=0,
        idle_max=2,
        note="Idle from top row of Idle and running (64×64 cells)",
    )


def import_samurai(items: list):
    root = next(STAGE.glob("**/FREE_Samurai 2D Pixel Art v1.2"), None)
    if not root:
        return
    sprites = root / "Sprites"
    files = pngs_under(sprites if sprites.exists() else root)
    idle = next((p for p in files if p.stem.lower() == "idle"), None)
    add_unit(
        items,
        unit_id="samurai",
        name="Samurai",
        pack="FREE Samurai",
        category="npc",
        unit_root=root,
        anim_files=files,
        idle_src=idle,
    )


def import_wizard(items: list):
    root = next(STAGE.glob("**/EVil Wizard 2"), None)
    if not root:
        return
    sprites = root / "Sprites"
    files = pngs_under(sprites if sprites.exists() else root)
    idle = next((p for p in files if p.stem.lower() == "idle"), None)
    add_unit(
        items,
        unit_id="evil_wizard",
        name="Evil Wizard",
        pack="EVil Wizard 2",
        category="enemy",
        unit_root=root,
        anim_files=files,
        idle_src=idle,
    )


def _find_pack_root(folder_glob: str) -> Path | None:
    hits = sorted(STAGE.glob(folder_glob), key=lambda p: len(p.parts), reverse=True)
    for cand in hits:
        if not cand.is_dir():
            continue
        # Prefer folder that directly contains Sprites/Sprite
        if (cand / "Sprites").is_dir() or (cand / "Sprite").is_dir():
            return cand
        if any(cand.glob("**/Idle.png")) or any(cand.glob("**/IDLE.png")):
            return cand
    return hits[0] if hits else None


def _character_anim_files(root: Path) -> list[Path]:
    """Character strips only — drop projectile/arrow/spear FX folders."""
    skip_parts = {"projectile", "projectiles", "arrow", "arrows", "spear", "spears", "fx"}
    files = []
    for p in pngs_under(root):
        parts = {x.lower() for x in p.parts}
        name = p.stem.lower()
        if parts & skip_parts:
            continue
        if name in ("preview",) or "preview" == name:
            continue
        if "spear" in name and "attack" not in name:
            continue
        files.append(p)
    # Prefer Sprites/Sprite subtree if it has idle
    for sub in ("Sprites", "Sprite", "sprites"):
        d = root / sub
        if d.is_dir():
            nested = [p for p in files if d in p.parents or p.parent == d]
            if any(p.stem.lower() == "idle" for p in nested):
                # Also allow Character subfolder under Sprites
                char = d / "Character"
                if char.is_dir():
                    char_files = [p for p in nested if char in p.parents or p.parent == char]
                    if char_files:
                        return char_files
                return nested
    return files


def import_strip_npc(
    items: list,
    *,
    folder_glob: str,
    unit_id: str,
    name: str,
    pack: str,
) -> None:
    root = _find_pack_root(folder_glob)
    if not root:
        print(f"MISSING npc pack {name} ({folder_glob})")
        return
    files = _character_anim_files(root)
    if not files:
        files = [p for p in pngs_under(root) if p.stem.lower() != "preview"]
    idle = next((p for p in files if p.stem.lower() == "idle"), None) or pick_idle_source(files)
    add_unit(
        items,
        unit_id=unit_id,
        name=name,
        pack=pack,
        category="npc",
        unit_root=root,
        anim_files=files,
        idle_src=idle,
        note="NPC hero pack — idle strip",
    )


def import_extra_npcs(items: list):
    import_strip_npc(
        items, folder_glob="**/Evil Wizard 3", unit_id="evil_wizard_3",
        name="Evil Wizard 3", pack="Evil Wizard 3",
    )
    import_strip_npc(
        items, folder_glob="**/Martial Hero 3", unit_id="martial_hero_3",
        name="Martial Hero 3", pack="Martial Hero 3",
    )
    import_strip_npc(
        items, folder_glob="**/Martial Hero 2", unit_id="martial_hero_2",
        name="Martial Hero 2", pack="Martial Hero 2",
    )
    # Prefer exact "Martial Hero" over 2/3 — match folder that ends with Martial Hero
    root_mh = None
    for cand in STAGE.rglob("Martial Hero"):
        if cand.is_dir() and cand.name == "Martial Hero":
            root_mh = cand
            break
    if root_mh:
        files = _character_anim_files(root_mh)
        idle = next((p for p in files if p.stem.lower() == "idle"), None)
        add_unit(
            items,
            unit_id="martial_hero",
            name="Martial Hero",
            pack="Martial Hero",
            category="npc",
            unit_root=root_mh,
            anim_files=files,
            idle_src=idle,
            note="NPC hero pack — idle strip",
        )
    else:
        print("MISSING npc pack Martial Hero")

    import_strip_npc(
        items, folder_glob="**/Huntress 2", unit_id="huntress_2",
        name="Huntress 2", pack="Huntress 2",
    )
    root_h = None
    for cand in STAGE.rglob("Huntress"):
        if cand.is_dir() and cand.name == "Huntress":
            root_h = cand
            break
    if root_h:
        files = _character_anim_files(root_h)
        idle = next((p for p in files if p.stem.lower() == "idle"), None)
        add_unit(
            items,
            unit_id="huntress",
            name="Huntress",
            pack="Huntress",
            category="npc",
            unit_root=root_h,
            anim_files=files,
            idle_src=idle,
            note="NPC hero pack — idle strip",
        )
    else:
        print("MISSING npc pack Huntress")

    import_strip_npc(
        items, folder_glob="**/Fantasy Warrior", unit_id="fantasy_warrior",
        name="Fantasy Warrior", pack="Fantasy Warrior",
    )


def import_skeleton_enemy(items: list):
    root = next(STAGE.glob("**/Skeleton enemy"), None)
    if not root:
        print("MISSING Skeleton enemy")
        return
    sheet = next((p for p in pngs_under(root) if p.suffix.lower() == ".png"), None)
    if not sheet:
        print("MISSING Skeleton enemy sheet")
        return
    # 832×320 → 13×5 of 64×64; row 0 = idle
    add_unit(
        items,
        unit_id="skeleton_enemy",
        name="Skeleton Enemy",
        pack="Skeleton Enemy",
        category="enemy",
        unit_root=root,
        anim_files=[sheet],
        idle_src=sheet,
        idle_fw=64,
        idle_fh=64,
        idle_row=0,
        note="Multi-row sheet — idle from row 0 (64×64)",
    )


def import_demon_slime(items: list):
    root = next(STAGE.glob("**/boss_demon_slime_FREE_v1.0"), None)
    if not root:
        root = next((p for p in STAGE.glob("boss_demon_slime*") if p.is_dir()), None)
    if not root:
        print("MISSING boss_demon_slime staging folder")
        return

    sheet = next(root.rglob("*288x160_spritesheet.png"), None)
    idle_gif = next(root.rglob("01_d_idle.gif"), None)
    ind = root / "individual sprites"
    anim_files: list[Path] = []
    if sheet:
        anim_files.append(sheet)
    if idle_gif:
        anim_files.append(idle_gif)
    # Keep one strip-ish source per anim folder (copy first frame + full folder via rglob later)
    role_map = {
        "01_demon_idle": "idle",
        "02_demon_walk": "walk",
        "03_demon_cleave": "attack",
        "04_demon_take_hit": "hurt",
        "05_demon_death": "death",
    }
    if ind.is_dir():
        for sub in sorted(p for p in ind.iterdir() if p.is_dir()):
            frames = sorted(sub.glob("*.png"))
            anim_files.extend(frames)

    idle_src = sheet or idle_gif
    if not idle_src and ind.is_dir():
        idle_dir = ind / "01_demon_idle"
        idle_frames = sorted(idle_dir.glob("*.png")) if idle_dir.is_dir() else []
        if idle_frames:
            idle_src = idle_frames[0]

    add_unit(
        items,
        unit_id="boss_demon_slime",
        name="Demon Slime",
        pack="Boss Demon Slime",
        category="boss",
        unit_root=root,
        anim_files=anim_files,
        idle_src=sheet,
        idle_fw=288 if sheet else None,
        idle_fh=160 if sheet else None,
        idle_row=0,
        idle_max=6,
        note="Boss pack — idle from spritesheet row 0 (also has walk/cleave/hurt/death)",
    )
    # Normalize animation list from folder roles
    if items:
        roles = []
        for folder, role in role_map.items():
            d = ind / folder
            if d.is_dir() and any(d.glob("*.png")):
                roles.append(role)
        if roles:
            items[-1]["animations"] = roles


def import_attached(items: list):
    att = STAGE / "_attached"
    if not att.is_dir():
        return
    for p in sorted(att.glob("*.png")):
        if "RogueHero" in p.name:
            # Ink pitch ≈50×37 → 10×12 grid; row 0 = idle (4 frames)
            add_unit(
                items,
                unit_id="rogue_hero",
                name="Rogue Hero",
                pack="sheets / attached",
                category="npc",
                unit_root=att,
                anim_files=[p],
                idle_src=p,
                idle_fw=50,
                idle_fh=37,
                idle_row=0,
                idle_max=4,
                note="Idle row 0 from multi-row sheet (50×37 cells)",
            )
        elif "slime" in p.name.lower() or "mm-crawl" in p.name.lower():
            # 5×3 of 64×64; row 0 = front idle
            add_unit(
                items,
                unit_id="pink_slime",
                name="Pink Slime",
                pack="sheets / attached",
                category="enemy",
                unit_root=att,
                anim_files=[p],
                idle_src=p,
                idle_fw=64,
                idle_fh=64,
                idle_row=0,
                note="Front idle row from 3×5 sheet",
            )


def import_sheets_rar(items: list):
    root = STAGE / "sheets"
    files = pngs_under(root) if root.is_dir() else []
    rar_names: list[str] = []
    rar_path = DOWNLOADS / "sheets.rar"
    if rar_path.is_file():
        try:
            import rarfile  # type: ignore

            with rarfile.RarFile(rar_path) as rf:
                rar_names = [n for n in rf.namelist() if n.lower().endswith(".png")]
        except Exception as e:
            print(f"sheets.rar list failed: {e}")

    if files:
        strips = [p for p in files if p.name.lower().startswith("spr_")]
        if strips:
            # One card per strip (actual sprites), idle strip preferred first in catalog order
            for p in sorted(strips, key=lambda x: (0 if "idle" in x.name.lower() else 1, x.name.lower())):
                role = norm_anim(p.stem.replace("spr_", "").replace("_strip", ""))
                add_unit(
                    items,
                    unit_id=f"sheets_{slug(role)}",
                    name=f"Hero · {role}",
                    pack="sheets.rar",
                    category="npc",
                    unit_root=root,
                    anim_files=[p],
                    idle_src=p,
                    note=f"Strip: {p.name}",
                )
    elif rar_names:
        print("sheets.rar listed but not extracted — skip discrete sprites (install 7-Zip)")


def main() -> None:
    if not Image:
        raise SystemExit("Pillow required: pip install Pillow")
    extract_zips()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    items: list[dict] = []
    print("Building per-sprite idle previews…")
    import_fire_worm(items)
    import_mcf2(items)
    import_mcf1(items)
    import_red_hood(items)
    import_king(items)
    import_golem(items)
    import_knights(items)
    import_executioner(items)
    import_archer(items)
    import_samurai(items)
    import_wizard(items)
    import_extra_npcs(items)
    import_skeleton_enemy(items)
    import_demon_slime(items)
    import_sheets_rar(items)
    import_attached(items)

    catalog = {
        "version": 2,
        "count": len(items),
        "packs": sorted({i["pack"] for i in items}),
        "items": items,
    }
    CATALOG.write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    print(f"Imported {len(items)} sprites -> {OUT.relative_to(ROOT)}")
    for it in items:
        print(f"  [{it['category']}] {it['id']}: {it.get('preview')}")


if __name__ == "__main__":
    main()
