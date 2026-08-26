"""Promote curated pixel-art backgrounds into assets/img/bg/scenes/.

Resizes oversized stills for the 1280x720 stage, composites the cave
parallax pack into a single still, and copies biome fallbacks so BIOME_BG
paths exist on disk.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets/img/NEW_ASSETS/backgrounds/_extracted"
SCENES = ROOT / "assets/img/bg/scenes"
BG = ROOT / "assets/img/bg"
MAX_W = 1600
JPEG_Q = 86


def fit(im: Image.Image, max_w: int = MAX_W) -> Image.Image:
    im = im.convert("RGB")
    if im.width <= max_w:
        return im
    h = round(im.height * (max_w / im.width))
    return im.resize((max_w, h), Image.Resampling.LANCZOS)


def save_still(im: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = fit(im)
    dest = dest.with_suffix(".jpg")
    im.save(dest, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    print(f"  {dest.name:28s} {dest.stat().st_size:8d}  {im.size}")


def from_file(src: Path, dest_stem: str) -> None:
    im = Image.open(src)
    save_still(im, SCENES / dest_stem)


def composite_cave() -> Image.Image:
    layers = sorted((PACK / "parallax-cave").glob("*.png"), key=lambda p: p.name)
    base = Image.open(layers[0]).convert("RGBA")
    canvas = Image.new("RGBA", base.size, (8, 18, 28, 255))
    for p in layers:
        layer = Image.open(p).convert("RGBA")
        if layer.size != canvas.size:
            layer = layer.resize(canvas.size, Image.Resampling.NEAREST)
        canvas.alpha_composite(layer)
    return canvas.convert("RGB")


def composite_hills() -> Image.Image:
    folder = PACK / "free-pixel-art-hill/Free Pixel Art Hill/PNG"
    layers = sorted(folder.glob("Hills Layer *.png"))
    base = Image.open(layers[0]).convert("RGBA")
    canvas = Image.new("RGBA", base.size, (90, 170, 220, 255))
    for p in layers:
        layer = Image.open(p).convert("RGBA")
        if layer.size != canvas.size:
            layer = layer.resize(canvas.size, Image.Resampling.NEAREST)
        canvas.alpha_composite(layer)
    return canvas.convert("RGB")


def main() -> None:
    SCENES.mkdir(parents=True, exist_ok=True)
    BG.mkdir(parents=True, exist_ok=True)

    # Drop the 12MB JPEG copies if they lingered with a .png extension.
    for leftover in SCENES.glob("*"):
        leftover.unlink()

    jobs = {
        "lamora_sunset": ROOT / "assets/img/bg/scenes",  # placeholder, filled below
    }
    # Direct Downloads-origin stills were copied earlier; re-read from pack/cache
    # using the extracted/high-quality sources we still have on disk.
    srcs: list[tuple[str, Path]] = [
        ("lamora_sunset", Path(r"C:\Users\andre\Downloads\Lamora HR.png")),
        ("night_castle", Path(r"C:\Users\andre\Downloads\HR_Vamp Castle BG.png")),
        ("forest_path", Path(r"C:\Users\andre\Downloads\HR_Deep Forest.png")),
        ("forest_garden", Path(r"C:\Users\andre\Downloads\pixel-art-style-floral-garden-illustration.jpg")),
        ("forest_bridge", Path(r"C:\Users\andre\Downloads\pixel-art-river-landscape-illustration.jpg")),
        ("forest_bridge_2", Path(r"C:\Users\andre\Downloads\pixel-art-river-landscape-illustration (1).jpg")),
        ("swamp_bayou", Path(r"C:\Users\andre\Downloads\jungle-landscape-pixel-art-style.jpg")),
        ("frost_range", Path(r"C:\Users\andre\Downloads\HR_Snow_Landscapes.png")),
        ("frost_road", Path(r"C:\Users\andre\Downloads\HR_WinterLand.png")),
        ("town_canal", Path(r"C:\Users\andre\Downloads\HighResolution_MedievalTown1.png")),
        ("town_street", Path(r"C:\Users\andre\Downloads\HighResolution_MedievalTown2.png")),
        ("ocean_sunrise", Path(r"C:\Users\andre\Downloads\HR_Ocean Sunrise.png")),
        ("mountain_vista", Path(r"C:\Users\andre\Downloads\HR_MountainView.png")),
        ("coastal_fortress", Path(r"C:\Users\andre\Downloads\The Coastal Fortress.png")),
        ("tower_overlook", Path(r"C:\Users\andre\Downloads\HR_Fantasy_Landscape.png")),
        ("mountain_cabin", Path(r"C:\Users\andre\Downloads\HR_Free-PixelArt-MountainHouse.png")),
        ("forest_farm", PACK / "free-summer-pixel-art-backgrounds/PNG/summer 1/Summer1.png"),
        ("forest_pines", PACK / "free-summer-pixel-art-backgrounds/PNG/summer 4/Summer4.png"),
        ("forest_meadow", PACK / "free-summer-pixel-art-backgrounds/PNG/summer6/Summer6.png"),
        ("forest_hill", PACK / "free-summer-pixel-art-backgrounds/PNG/summer5/Summer5.png"),
        ("forest_tree", PACK / "nature-landscapes-free-pixel-art/nature_1/origbig.png"),
        ("forest_valley", PACK / "nature-landscapes-free-pixel-art/nature_3/origbig.png"),
        ("forest_skyfield", PACK / "nature-landscapes-free-pixel-art/nature_5/origbig.png"),
        ("forest_canopy", PACK / "free-pixel-art-forest/Free Pixel Art Forest/Preview/Background.png"),
        ("frost_woods", PACK / "free-winter-backgrounds-pixel-art/winter 1/hd.png"),
        ("frost_birch", PACK / "free-winter-backgrounds-pixel-art/winter 5/hd.png"),
        ("frost_pass", PACK / "free-winter-backgrounds-pixel-art/winter 8/hd.png"),
        ("sunny_castle", PACK / "pixel1992-sunny-castles/Sunny Castle (1).png"),
        ("sunny_gate", PACK / "pixel1992-sunny-castles/Sunny Castle (18).png"),
        ("sunny_keep", PACK / "pixel1992-sunny-castles/Sunny Castle (5).png"),
        ("cloud_dusk", PACK / "new-free-backgrounds-part4/background 2/orig_big.png"),
        ("school_classroom", PACK / "magical-school/Classroom 1.png"),
        ("school_library", PACK / "magical-school/Library 1.png"),
        ("school_hall", PACK / "magical-school/Hallway 1.png"),
        ("school_commons", PACK / "magical-school/Common Room.png"),
        ("school_greenhouse", PACK / "magical-school/Greenhouse 1.png"),
        ("school_building", PACK / "magical-school/Building 1.png"),
        ("school_office", PACK / "magical-school/Office 1.png"),
        ("school_potions", PACK / "magical-school/Potions.png"),
        ("school_pool", PACK / "magical-school/Reflecting Pool.png"),
        ("horiz_rocks", PACK / "free-horizontal-game-backgrounds/PNG/game_background_1/game_background_1.png"),
        ("horiz_pines", PACK / "free-horizontal-game-backgrounds/PNG/game_background_2/game_background_2.png"),
        ("horiz_ground", PACK / "free-horizontal-game-backgrounds/PNG/game_background_4/game_background_4.png"),
    ]

    print("Promoting stills:")
    for stem, src in srcs:
        if not src.exists():
            print(f"  MISSING {stem} <- {src}")
            continue
        from_file(src, stem)

    print("Composites:")
    save_still(composite_cave(), SCENES / "cave_ruins")
    save_still(composite_hills(), SCENES / "hill_layers")

    # Biome / menu fallbacks (JPEG scenes; artmap points here after wiring).
    fallbacks = {
        "forest": "forest_path.jpg",
        "ruins": "coastal_fortress.jpg",
        "frost": "frost_range.jpg",
        "swamp": "swamp_bayou.jpg",
        "hell": "night_castle.jpg",
        "throne": "lamora_sunset.jpg",
        "title": "lamora_sunset.jpg",
        "travelmap": "mountain_vista.jpg",
    }
    for name, scene in fallbacks.items():
        src = SCENES / scene
        dest = BG / f"{name}.jpg"
        shutil.copy2(src, dest)
        print(f"  fallback {name}.jpg")

    # Keep the old forest.png as an extra deep-woods still if present.
    old = BG / "forest.png"
    if old.exists():
        shutil.copy2(old, SCENES / "forest_legacy.png")

    zip_giant = ROOT / "assets/img/NEW_ASSETS/backgrounds/Magical School.zip"
    if zip_giant.exists():
        zip_giant.unlink()
        print("removed Magical School.zip from repo (300MB; interiors extracted)")

    print("done", len(list(SCENES.glob("*.*"))))


if __name__ == "__main__":
    main()
