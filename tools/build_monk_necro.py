"""Build Monk + Necromancer hero idle/anim strips for HERO_ART.

Sources (committed under assets/img/heroes/):
  _monk_src/          Elementals Ground Monk FREE v1.3.1
  _necromancer_src/   Necromancer sheet (Creativekind)

Packs already include idle motion — we keep native pixels, align frames to a
shared canvas (feet pinned), and do NOT invent a 2-frame bob or squash to 32×32.

Run:  python tools/build_monk_necro.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "img" / "heroes"
MONK_PNG = ROOT / "assets" / "img" / "heroes" / "_monk_src" / "png"
NECRO_SHEET = ROOT / "assets" / "img" / "heroes" / "_necromancer_src" / "necromancer_sheet.png"
ARTMAP = ROOT / "js" / "data" / "artmap.js"

# Only strip true sheet backdrop. Necromancer robes/red glow sit in the dark
# greys — a higher threshold eats the character.
BG_MAX = 8

# CreativeKind full sheet: 17×7 of 160×128 (2720×896). Faces right — flip to face left.
NECRO_CELL_W, NECRO_CELL_H = 160, 128
NECRO_ROWS = [
    # (row_index, role, max_frames)
    (0, "idle", 8),
    (1, "run", 8),
    (2, "attack", 13),
    (3, "attack2", 13),
    (4, "special", 17),
    (5, "hurt", 5),
    (6, "death", 9),
]


def clear_bg(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8 or (r + g + b) <= BG_MAX:
                px[x, y] = (0, 0, 0, 0)
    return im


def content_bbox(cell: Image.Image):
    px = cell.load()
    w, h = cell.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 10 and (r + g + b) > BG_MAX:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < 0:
        return None
    return minx, miny, maxx, maxy


def natural_frame_key(path: Path) -> int:
    digits = re.findall(r"\d+", path.stem)
    return int(digits[-1]) if digits else 0


def load_dir_frames(folder: Path, flip: bool = False) -> list[Image.Image]:
    paths = sorted(folder.glob("*.png"), key=natural_frame_key)
    frames = [clear_bg(Image.open(p)) for p in paths]
    if flip:
        frames = [f.transpose(Image.Transpose.FLIP_LEFT_RIGHT) for f in frames]
    return frames


def ink_count(im: Image.Image) -> int:
    px = im.load()
    w, h = im.size
    n = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 10 and (r + g + b) > BG_MAX:
                n += 1
    return n


def align_frames(frames: list[Image.Image], pad: int = 2) -> tuple[list[Image.Image], int, int]:
    """Re-pack padded canvases (monk): centre-x + feet of frame 0 as anchor."""
    cleaned = []
    for f in frames:
        f = clear_bg(f)
        if content_bbox(f) is not None:
            cleaned.append(f)
    if not cleaned:
        raise SystemExit("no opaque frames")

    bb0 = content_bbox(cleaned[0])
    ax = (bb0[0] + bb0[2]) / 2.0
    ay = float(bb0[3])

    placed = []
    for f in cleaned:
        bb = content_bbox(f)
        cx = (bb[0] + bb[2]) / 2.0
        by = float(bb[3])
        placed.append((ax - cx, ay - by, f))

    minx = miny = 1e9
    maxx = maxy = -1e9
    for dx, dy, f in placed:
        bb = content_bbox(f)
        minx = min(minx, bb[0] + dx)
        miny = min(miny, bb[1] + dy)
        maxx = max(maxx, bb[2] + dx)
        maxy = max(maxy, bb[3] + dy)

    fw = int(round(maxx - minx)) + pad * 2
    fh = int(round(maxy - miny)) + pad * 2
    out = []
    for dx, dy, f in placed:
        canvas = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        ox = int(round(dx - minx)) + pad
        oy = int(round(dy - miny)) + pad
        canvas.paste(f, (ox, oy), f)
        out.append(canvas)
    return out, fw, fh


def save_strip(frames: list[Image.Image], path: Path, mode: str = "align") -> dict:
    """mode='align' re-packs padded canvases; mode='raw' keeps cells 1:1 (no resize/crop)."""
    if mode == "raw":
        aligned = [clear_bg(f) for f in frames]
        fw, fh = aligned[0].size
    else:
        aligned, fw, fh = align_frames(frames)
    strip = Image.new("RGBA", (fw * len(aligned), fh), (0, 0, 0, 0))
    for i, fr in enumerate(aligned):
        # Never rescale — paste 1:1 source pixels only.
        if fr.size != (fw, fh):
            raise SystemExit(f"frame size {fr.size} != cell {(fw, fh)} for {path}")
        strip.paste(fr, (i * fw, 0), fr)
    strip.save(path)
    print(f"wrote {path.relative_to(ROOT)} ({len(aligned)} frames, {fw}x{fh})")
    return {
        "f": str(path.relative_to(ROOT)).replace("\\", "/"),
        "w": fw,
        "h": fh,
        "frames": len(aligned),
    }


def extract_necro_row(sheet: Image.Image, row: int, max_frames: int, flip: bool = True) -> list[Image.Image]:
    """Slice one row of 160×128 cells; flip so the necro faces left like other heroes."""
    frames = []
    cols = sheet.size[0] // NECRO_CELL_W
    y0 = row * NECRO_CELL_H
    for c in range(cols):
        if len(frames) >= max_frames:
            break
        cell = sheet.crop((c * NECRO_CELL_W, y0, (c + 1) * NECRO_CELL_W, y0 + NECRO_CELL_H))
        cell = clear_bg(cell)
        if ink_count(cell) < 80:
            if frames:
                break
            continue
        if flip:
            cell = cell.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        frames.append(cell)
    return frames


def patch_hero_art(entries: dict[str, dict]) -> None:
    text = ARTMAP.read_text(encoding="utf-8")
    m = re.search(r"export const HERO_ART = \{", text)
    if not m:
        raise SystemExit("HERO_ART block not found")
    start = m.end() - 1
    i = start
    depth = 0
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
        i += 1
    else:
        raise SystemExit("unclosed HERO_ART")

    data = json.loads(text[start:end])
    for key, entry in entries.items():
        data[key] = entry
    order = [
        "warrior", "mage", "archer", "rogue", "priest", "monk",
        "warlock", "bard", "necromancer", "spellsword", "viking",
    ]
    ordered = {k: data[k] for k in order if k in data}
    for k, v in data.items():
        if k not in ordered:
            ordered[k] = v
    ARTMAP.write_text(text[:start] + json.dumps(ordered, indent=1) + text[end:], encoding="utf-8")
    print("patched HERO_ART:", ", ".join(entries))


def build_monk() -> dict:
    # Pack faces right; flip so the monk faces left (toward enemies in combat).
    idle = load_dir_frames(MONK_PNG / "idle", flip=True)
    idle_art = save_strip(idle, OUT / "monk.png")
    anims = {
        "idle": {**idle_art},
        "run": save_strip(load_dir_frames(MONK_PNG / "run", flip=True), OUT / "monk_run.png"),
        "attack": save_strip(load_dir_frames(MONK_PNG / "1_atk", flip=True), OUT / "monk_attack.png"),
        "attack2": save_strip(load_dir_frames(MONK_PNG / "2_atk", flip=True), OUT / "monk_attack2.png"),
        "attackHigh": save_strip(load_dir_frames(MONK_PNG / "3_atk", flip=True), OUT / "monk_attack_high.png"),
        "hurt": save_strip(load_dir_frames(MONK_PNG / "take_hit", flip=True), OUT / "monk_hurt.png"),
        "death": save_strip(load_dir_frames(MONK_PNG / "death", flip=True), OUT / "monk_death.png"),
        "dash": save_strip(load_dir_frames(MONK_PNG / "roll", flip=True), OUT / "monk_dash.png"),
    }
    return {**idle_art, "combatSize": 68, "anims": anims}


def build_necromancer() -> dict:
    sheet = Image.open(NECRO_SHEET).convert("RGBA")
    if sheet.size != (NECRO_CELL_W * 17, NECRO_CELL_H * 7):
        print(f"warn: expected {NECRO_CELL_W*17}x{NECRO_CELL_H*7}, got {sheet.size}")
    rows = {
        role: extract_necro_row(sheet, row, n, flip=True)
        for row, role, n in NECRO_ROWS
    }
    # Crop/align like monk — source cells are 160×128 with large empty padding.
    idle_art = save_strip(rows["idle"], OUT / "necromancer.png")
    anims = {
        "idle": {**idle_art},
        "run": save_strip(rows["run"], OUT / "necromancer_run.png"),
        "attack": save_strip(rows["attack"], OUT / "necromancer_attack.png"),
        "attack2": save_strip(rows["attack2"], OUT / "necromancer_attack2.png"),
        "special": save_strip(rows["special"], OUT / "necromancer_special.png"),
        "hurt": save_strip(rows["hurt"], OUT / "necromancer_hurt.png"),
        "death": save_strip(rows["death"], OUT / "necromancer_death.png"),
    }
    # Idle is ~60px tall; match monk on-screen presence (~1.6× source).
    combat = max(72, int(round(idle_art["h"] * 1.6)))
    return {**idle_art, "combatSize": combat, "anims": anims}


def main():
    if not MONK_PNG.is_dir():
        raise SystemExit(f"missing monk source: {MONK_PNG}")
    if not NECRO_SHEET.is_file():
        raise SystemExit(f"missing necro source: {NECRO_SHEET}")

    OUT.mkdir(parents=True, exist_ok=True)
    # Drop old forced-32 bob strips that confuse the preview
    for stale in (
        "monk_idle.png",
        "necromancer_idle.png",
    ):
        p = OUT / stale
        if p.exists():
            p.unlink()
            print(f"removed {stale}")

    monk = build_monk()
    necro = build_necromancer()
    patch_hero_art({"monk": monk, "necromancer": necro})
    print("done")


if __name__ == "__main__":
    main()
