"""Build archer hero strips from ArcherHero pack (64x64 cells, black → transparent).
Centers each frame's opaque content in the cell so showcase/combat align better.
"""
from PIL import Image
from pathlib import Path

SRC = Path("assets/img/heroes/_archer_src/Final")
OUT = Path("assets/img/heroes")
CELL = 64
NEAR_BLACK = 28


def clear_bg(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8 or (r + g + b) <= NEAR_BLACK * 3:
                px[x, y] = (0, 0, 0, 0)
    return im


def content_bbox(cell: Image.Image):
    px = cell.load()
    w, h = cell.size
    minx, miny, maxx, maxy = w, h, -1, -1
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 10 and (r + g + b) > NEAR_BLACK * 3:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    if maxx < 0:
        return None
    return minx, miny, maxx, maxy


def cell_occupied(cell: Image.Image) -> bool:
    return content_bbox(cell) is not None


def center_frame(cell: Image.Image) -> Image.Image:
    """Place opaque pixels centered horizontally; keep feet near bottom."""
    cell = clear_bg(cell)
    bb = content_bbox(cell)
    if not bb:
        return cell
    minx, miny, maxx, maxy = bb
    cw, ch = maxx - minx + 1, maxy - miny + 1
    crop = cell.crop((minx, miny, maxx + 1, maxy + 1))
    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    # center X; pin feet near bottom with a small margin
    x = (CELL - cw) // 2
    y = max(0, CELL - ch - 6)
    out.paste(crop, (x, y), crop)
    return out


def extract_row_frames(im: Image.Image, row: int, cols=None):
    cols = cols if cols is not None else im.size[0] // CELL
    frames = []
    for c in range(cols):
        cell = im.crop((c * CELL, row * CELL, (c + 1) * CELL, (row + 1) * CELL))
        if cell_occupied(cell):
            frames.append(center_frame(cell))
        else:
            if frames:
                break
    return frames


def save_strip(frames, path: Path):
    if not frames:
        raise SystemExit(f"no frames for {path}")
    strip = Image.new("RGBA", (CELL * len(frames), CELL), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        strip.paste(fr, (i * CELL, 0), fr)
    strip.save(path)
    print(f"wrote {path} ({len(frames)} frames, {strip.size[0]}x{strip.size[1]})")


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    idle_run = Image.open(SRC / "Idle and running.png").convert("RGBA")
    save_strip(extract_row_frames(idle_run, 0), OUT / "archer.png")
    save_strip(extract_row_frames(idle_run, 1), OUT / "archer_run.png")

    attack = Image.open(SRC / "Normal Attack.png").convert("RGBA")
    full = extract_row_frames(attack, 0) + extract_row_frames(attack, 1)
    save_strip(full, OUT / "archer_attack.png")
    save_strip(extract_row_frames(attack, 3), OUT / "archer_attack_loop.png")

    high = Image.open(SRC / "High Attack.png").convert("RGBA")
    save_strip(extract_row_frames(high, 1) + extract_row_frames(high, 2), OUT / "archer_attack_high.png")

    low = Image.open(SRC / "Low attack.png").convert("RGBA")
    save_strip(extract_row_frames(low, 3) + extract_row_frames(low, 4), OUT / "archer_attack_low.png")

    death = Image.open(SRC / "death.png").convert("RGBA")
    save_strip(extract_row_frames(death, 1) + extract_row_frames(death, 2), OUT / "archer_death.png")

    dash = Image.open(SRC / "Dash.png").convert("RGBA")
    save_strip(extract_row_frames(dash, 1), OUT / "archer_dash.png")

    jump = Image.open(SRC / "Jumping.png").convert("RGBA")
    save_strip(extract_row_frames(jump, 0), OUT / "archer_jump.png")

    print("done")


if __name__ == "__main__":
    main()
