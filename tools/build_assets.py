"""Asset pipeline: packs + generated pixel art -> assets/ + js/data/artmap.js

Sources (user-provided packs, staged outside the repo):
  - PixelFlush Pixel Monsters Mega Pack (enemy sprites, 2-frame strips)
  - PixelFlush Pixel Weapons Mega Pack (weapon icons, 32x64)
  - xDeviruchi 8-bit Fantasy & Adventure Music (10 loopable tracks, CC-BY-SA 4.0)
  - TopDownFantasy Forest (title backdrop mockup)

Everything the packs don't cover (bows, fist wraps, armor/consumable icons,
class hero sprites, biome backgrounds) is generated here with PIL in a
matching low-res pixel style.

Usage:  python tools/build_assets.py <staging_dir>
"""
import json, os, shutil, subprocess, sys
from PIL import Image, ImageDraw

STAGE = sys.argv[1] if len(sys.argv) > 1 else None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets')
MON = STAGE and os.path.join(STAGE, 'PixelFlush_-_Pixel_Monsters_Mega_Pack', 'pngs')
WEP = STAGE and os.path.join(STAGE, 'PixelFlush_-_Pixel_Weapons_Mega_Pack', 'pngs')
FOREST = STAGE and os.path.join(STAGE, 'TopDownFantasy_Forest', 'TopDownFantasy-Forest')
MUS = STAGE and os.path.join(STAGE, 'xDeviruchi_music', 'xDeviruchi - 8-bit Fantasy  & Adventure Music (2021)')

for d in ['img/enemies', 'img/items', 'img/heroes', 'img/bg', 'music']:
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

artmap = {'enemies': {}, 'items': {}, 'heroes': {}, 'bg': {}, 'music': {}}

# Incremental builds: preserve entries from the existing artmap.js so a rebuild
# with only SOME source packs staged (e.g. just the Raven icons) doesn't drop
# enemy/music/background art whose original packs are no longer available.
_existing_map = os.path.join(ROOT, 'js', 'data', 'artmap.js')
if os.path.exists(_existing_map):
    import re as _re
    _txt = open(_existing_map, encoding='utf-8').read()
    for key, var in [('enemies', 'ENEMY_ART'), ('items', 'ITEM_ART'), ('heroes', 'HERO_ART'), ('bg', 'BIOME_BG'), ('music', 'MUSIC_TRACKS')]:
        m = _re.search(r'export const ' + var + r' = (\{.*?\});', _txt, _re.S)
        if m:
            try:
                artmap[key] = json.loads(m.group(1))
            except Exception:
                pass

def have(path):
    return path and os.path.isdir(path)

# ============ 1. ENEMIES (2-frame idle strips from the monsters pack) ============
ENEMY_MAP = {
    # forest
    'wolf': 'Spectral Hound 2.png', 'sprite': 'Forest Nymph.png', 'boar': 'Phantom Bull.png',
    'bandit': 'Goblin Cutthroat.png', 'treant': 'Forest Bushling.png', 'spider': 'Forest Spider.png',
    # ruins
    'skeleton': 'Skeleton Warrior.png', 'cursed_knight': 'Graveyard Guardian.png',
    'shade': 'Shadow Man.png', 'scarab': 'Spiderling Swarm Leader.png',
    'golem': 'Junkyard Golem.png', 'acolyte': 'Abyss Cult leader.png',
    # frost
    'wraith': 'Wisp Wraith 1.png', 'frost_giant': 'Frost Gorilla.png',
    'winter_wolf': 'Spectral Hound.png', 'ice_maiden': 'Abyss Siren form 1.png',
    'frozen_soldier': 'Frost Ice Buff.png',
    # swamp
    'hag': 'Chaos Druid.png', 'croc': 'Sandworm.png', 'leech': 'Abyss Slug.png',
    'will_o_wisp': 'Toxic Sludge wisp.png', 'troll': 'Cave Healing Troll.png',
    # hell
    'imp': 'Fire Imp.png', 'hellhound': 'Plaguebearer Dog.png', 'tormentor': 'Abyss Reaper.png',
    'pit_mage': 'Chaos Weaver.png', 'brute': 'Molten Golem.png',
    # bosses + specials
    'elderwood': 'Forest Boss Imp.png', 'lich': 'Reaper.png', 'frost_queen': 'Abyss Siren form 3.png',
    'hydra': 'large snake.png', 'infernal_duke': 'Volcano Drake Boss.png', 'demon_king': 'Mirrorfiend.png',
    'mimic': 'Suspicious Blob.png',
}

if have(MON):
    for eid, src in ENEMY_MAP.items():
        p = os.path.join(MON, src)
        im = Image.open(p)
        fw, fh = im.width // 2, im.height  # two horizontal idle frames
        shutil.copy(p, os.path.join(OUT, 'img/enemies', f'{eid}.png'))
        artmap['enemies'][eid] = {'f': f'assets/img/enemies/{eid}.png', 'w': fw, 'h': fh}

# ============ 2. WEAPON ICONS from the weapons pack ============
WEAPON_MAP = {
    'rusty_sword': 'basic sword 1.png', 'oak_staff': 'Earth Wand.png',
    'runed_dagger_worn': 'Copper Dagger.png', 'novice_mace': 'Wooden Blackjack.png',
    'steel_blade': 'basic long sword 2.png', 'battle_axe': 'Crystal Axe.png',
    'runed_dagger': 'Adamant Dagger.png', 'pilgrims_cudgel': 'Ice Club.png',
    'ashwood_staff': 'Whispering Wand.png', 'frost_brand': 'Celestial Sword.png',
    'sun_mace': 'Blessed Sword.png', 'void_scepter': 'Oasis Dark Wand.png',
    'dragonfang': 'Crimson Battle Sword.png', 'excalibur': 'Heroes Rapier.png',
}
if have(WEP):
    for iid, src in WEAPON_MAP.items():
        shutil.copy(os.path.join(WEP, src), os.path.join(OUT, 'img/items', f'{iid}.png'))
        artmap['items'][iid] = f'assets/img/items/{iid}.png'

# ============ 3. GENERATED pixel icons (style-matched gaps) ============
def px(draw, x, y, c):
    draw.point((x, y), fill=c)

def save_icon(im, iid, scale=1):
    if scale > 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    im.save(os.path.join(OUT, 'img/items', f'{iid}.png'))
    artmap['items'][iid] = f'assets/img/items/{iid}.png'

OUTLINE = (24, 18, 28, 255)

def draw_bow(body, string):
    im = Image.new('RGBA', (32, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # limb arc
    for i, (x, y) in enumerate([(20, 8), (22, 12), (23, 18), (24, 26), (24, 32), (24, 38), (23, 46), (22, 52), (20, 56)]):
        d.rectangle([x - 1, y - 2, x + 1, y + 2], fill=body, outline=OUTLINE)
    # string
    d.line([(20, 8), (12, 32), (20, 56)], fill=string, width=1)
    # arrow
    d.line([(6, 32), (22, 32)], fill=(150, 110, 70, 255), width=1)
    d.polygon([(4, 32), (8, 30), (8, 34)], fill=(190, 190, 200, 255))
    d.line([(21, 30), (23, 32), (21, 34)], fill=(200, 60, 60, 255))
    return im

def draw_wraps(main, glow):
    im = Image.new('RGBA', (32, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # a wrapped fist
    d.rectangle([10, 24, 22, 40], fill=main, outline=OUTLINE)
    for y in range(26, 40, 4):
        d.line([(10, y), (22, y + 2)], fill=glow, width=1)
    d.rectangle([12, 40, 20, 46], fill=main, outline=OUTLINE)  # cuff
    d.rectangle([13, 18, 19, 24], fill=(224, 190, 160, 255), outline=OUTLINE)  # knuckles
    return im

save_icon(draw_bow((110, 78, 48, 255), (220, 220, 200, 255)), 'hunting_bow')
save_icon(draw_bow((70, 110, 140, 255), (170, 220, 255, 255)), 'storm_bow')
save_icon(draw_wraps((180, 170, 150, 255), (140, 130, 110, 255)), 'wraps')
save_icon(draw_wraps((190, 120, 60, 255), (240, 180, 80, 255)), 'tiger_wraps')
save_icon(draw_wraps((90, 90, 140, 255), (160, 200, 255, 255)), 'comet_wraps')

def icon24(painter):
    im = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
    painter(ImageDraw.Draw(im))
    return im

def helm(d, c1, c2):
    d.polygon([(4, 14), (6, 6), (12, 3), (18, 6), (20, 14)], fill=c1, outline=OUTLINE)
    d.rectangle([4, 14, 20, 17], fill=c2, outline=OUTLINE)
    d.rectangle([9, 10, 15, 13], fill=(20, 16, 24, 255))

def chest(d, c1, c2):
    d.polygon([(5, 5), (12, 3), (19, 5), (20, 12), (17, 20), (7, 20), (4, 12)], fill=c1, outline=OUTLINE)
    d.line([(12, 4), (12, 19)], fill=c2, width=1)
    d.line([(6, 9), (18, 9)], fill=c2, width=1)

def legs(d, c1, c2):
    d.polygon([(6, 4), (18, 4), (18, 9), (14, 9), (14, 20), (10, 20), (10, 9), (6, 9)], fill=c1, outline=OUTLINE)
    d.line([(6, 6), (18, 6)], fill=c2, width=1)

def boots(d, c1, c2):
    d.rectangle([6, 4, 11, 16], fill=c1, outline=OUTLINE)
    d.rectangle([6, 16, 16, 20], fill=c1, outline=OUTLINE)
    d.line([(7, 8), (10, 8)], fill=c2, width=1)

def ring(d, c1, gem):
    d.ellipse([6, 8, 18, 20], outline=c1, width=3)
    d.rectangle([10, 3, 14, 8], fill=gem, outline=OUTLINE)

def amulet(d, c1, gem):
    d.arc([5, 2, 19, 16], 200, 340, fill=c1, width=2)
    d.polygon([(12, 12), (16, 16), (12, 21), (8, 16)], fill=gem, outline=OUTLINE)

def potion(d, liquid):
    d.rectangle([10, 3, 14, 7], fill=(160, 160, 170, 255), outline=OUTLINE)
    d.ellipse([5, 7, 19, 21], fill=(210, 220, 230, 90), outline=OUTLINE)
    d.ellipse([7, 11, 17, 20], fill=liquid)

def scroll(d, c):
    d.rectangle([5, 5, 19, 19], fill=(222, 205, 165, 255), outline=OUTLINE)
    d.rectangle([4, 3, 20, 6], fill=c, outline=OUTLINE)
    d.rectangle([4, 18, 20, 21], fill=c, outline=OUTLINE)
    for y in (9, 12, 15):
        d.line([(8, y), (16, y)], fill=(120, 100, 70, 255), width=1)

def bomb(d):
    d.ellipse([5, 8, 19, 21], fill=(40, 40, 48, 255), outline=OUTLINE)
    d.rectangle([11, 5, 13, 9], fill=(90, 90, 100, 255))
    d.line([(13, 5), (17, 2)], fill=(180, 140, 60, 255), width=1)
    d.point((18, 2), fill=(255, 200, 80, 255))
    d.point((17, 1), fill=(255, 120, 40, 255))

GEN_ICONS = {
    'leather_cap': lambda d: helm(d, (140, 100, 60, 255), (100, 70, 40, 255)),
    'iron_helm': lambda d: helm(d, (150, 155, 165, 255), (100, 105, 118, 255)),
    'scholars_hood': lambda d: helm(d, (90, 90, 150, 255), (60, 60, 110, 255)),
    'dragonbone_helm': lambda d: helm(d, (220, 210, 190, 255), (170, 60, 50, 255)),
    'cloth_garb': lambda d: chest(d, (150, 120, 90, 255), (110, 85, 60, 255)),
    'leather_jerkin': lambda d: chest(d, (135, 95, 55, 255), (95, 65, 38, 255)),
    'chainmail': lambda d: chest(d, (145, 150, 160, 255), (105, 110, 122, 255)),
    'wardweave': lambda d: chest(d, (95, 85, 160, 255), (150, 140, 220, 255)),
    'frostplate': lambda d: chest(d, (140, 175, 205, 255), (95, 130, 170, 255)),
    'shadow_shroud': lambda d: chest(d, (60, 50, 80, 255), (110, 90, 150, 255)),
    'aegis': lambda d: chest(d, (215, 185, 90, 255), (255, 230, 150, 255)),
    'cloth_trousers': lambda d: legs(d, (150, 120, 90, 255), (110, 85, 60, 255)),
    'chain_leggings': lambda d: legs(d, (145, 150, 160, 255), (105, 110, 122, 255)),
    'windstriders': lambda d: legs(d, (100, 170, 150, 255), (70, 130, 115, 255)),
    'worn_boots': lambda d: boots(d, (130, 95, 60, 255), (95, 65, 38, 255)),
    'scouts_boots': lambda d: boots(d, (90, 130, 90, 255), (60, 95, 60, 255)),
    'stoneroot_sabatons': lambda d: boots(d, (130, 130, 140, 255), (95, 95, 105, 255)),
    'seven_league': lambda d: boots(d, (170, 140, 220, 255), (120, 95, 170, 255)),
    'lucky_coin': lambda d: (d.ellipse([5, 5, 19, 19], fill=(230, 190, 80, 255), outline=OUTLINE), d.text((9, 7), '?', fill=(120, 85, 30, 255))),
    'iron_ring': lambda d: ring(d, (150, 155, 165, 255), (110, 115, 128, 255)),
    'hawk_charm': lambda d: amulet(d, (160, 130, 70, 255), (240, 200, 90, 255)),
    'herald_ribbon': lambda d: amulet(d, (170, 60, 70, 255), (230, 120, 130, 255)),
    'seer_monocle': lambda d: (d.ellipse([6, 6, 18, 18], outline=(220, 190, 110, 255), width=2), d.line([(17, 17), (20, 21)], fill=(220, 190, 110, 255), width=2)),
    'vampire_fang': lambda d: (d.polygon([(9, 4), (15, 4), (12, 20)], fill=(235, 230, 220, 255), outline=OUTLINE), d.line([(11, 15), (12, 19)], fill=(190, 60, 60, 255), width=1)),
    'greed_band': lambda d: ring(d, (230, 190, 80, 255), (250, 230, 130, 255)),
    'phoenix_feather': lambda d: (d.arc([4, 2, 24, 30], 180, 300, fill=(240, 130, 50, 255), width=3), d.arc([7, 5, 24, 28], 180, 290, fill=(255, 200, 80, 255), width=2)),
    'kings_eye': lambda d: (d.ellipse([4, 8, 20, 16], fill=(240, 235, 220, 255), outline=OUTLINE), d.ellipse([10, 9, 15, 15], fill=(90, 60, 140, 255)), d.point((12, 11), fill=(255, 255, 255, 255))),
    'potion_s': lambda d: potion(d, (210, 70, 70, 255)),
    'potion_l': lambda d: potion(d, (240, 90, 60, 255)),
    'mana_vial': lambda d: potion(d, (80, 130, 220, 255)),
    'calming_tea': lambda d: potion(d, (110, 200, 150, 255)),
    'bomb': lambda d: bomb(d),
    'smelling_salts': lambda d: potion(d, (230, 220, 160, 255)),
    'appraisal_scroll': lambda d: scroll(d, (150, 60, 60, 255)),
}
for iid, painter in GEN_ICONS.items():
    save_icon(icon24(painter), iid, scale=2)

# ---- Raven Fantasy Icons: high-quality 32x32 tiles override the generated
# placeholders where a good match exists (grid is 16 cols wide). Indexes read
# off the contact sheets in tools; each is item_id -> flat tile index. ----
RAVEN_MAP = {
    # armor (torso rows ~1856-1900)
    'cloth_garb': 1857, 'leather_jerkin': 1858, 'chainmail': 1873, 'wardweave': 1969,
    'frostplate': 1875, 'shadow_shroud': 1888, 'aegis': 2081,
    # helmets (row ~1904)
    'leather_cap': 1953, 'iron_helm': 1904, 'scholars_hood': 1965, 'dragonbone_helm': 1906,
    # legs (row ~1936) + boots (row ~1984)
    'cloth_trousers': 1936, 'chain_leggings': 1937, 'windstriders': 1938,
    'worn_boots': 1984, 'scouts_boots': 1985, 'stoneroot_sabatons': 1986, 'seven_league': 1987,
    # accessories: rings (row ~1840) + amulets (row ~2064) + gems (row ~160)
    'lucky_coin': 128, 'iron_ring': 1840, 'hawk_charm': 2064, 'herald_ribbon': 2065,
    'seer_monocle': 706, 'vampire_fang': 224, 'greed_band': 1841, 'kings_eye': 2113,
    'phoenix_feather': 992,
    # consumables: potions (row ~272) + scroll (row ~304) + bomb (row ~368)
    'potion_s': 272, 'potion_l': 273, 'mana_vial': 288, 'calming_tea': 259,
    'bomb': 368, 'smelling_salts': 274, 'appraisal_scroll': 304,
    # relics get flavorful symbols
    'ember_heart': 656, 'frozen_tear': 160, 'whetstone': 208, 'tortoise_shell': 112,
    'moon_dial': 688, 'blood_chalice': 128, 'golden_idol': 496, 'renown_lantern': 80,
    'xp_tome': 288, 'boss_bane': 656, 'heros_ashes': 224, 'gamblers_die': 704,
    'greed': 496, 'hourglass': 320, 'war_drum': 496, 'mimic_tooth': 224,
    'second_wind': 592, 'demon_pact': 672, 'sanity_lantern': 80,
}
# the Raven sheet may live in this staging dir OR a sibling assets2 dir
_raven_png = None
if STAGE:
    for cand in [
        os.path.join(STAGE, 'RavenIcons', 'Free - Raven Fantasy Icons', 'Full Spritesheet', '32x32.png'),
        os.path.join(os.path.dirname(STAGE), 'assets2', 'RavenIcons', 'Free - Raven Fantasy Icons', 'Full Spritesheet', '32x32.png'),
    ]:
        if os.path.exists(cand):
            _raven_png = cand
            break
if _raven_png:
    rav = Image.open(_raven_png).convert('RGBA')
    RCOLS = rav.width // 32
    for iid, idx in RAVEN_MAP.items():
        c, r = idx % RCOLS, idx // RCOLS
        tile = rav.crop((c * 32, r * 32, c * 32 + 32, r * 32 + 32))
        if tile.getbbox() is None:
            continue  # blank tile — keep the generated fallback
        tile.save(os.path.join(OUT, 'img/items', f'{iid}.png'))
        artmap['items'][iid] = f'assets/img/items/{iid}.png'
    print('raven icons applied:', sum(1 for i in RAVEN_MAP if os.path.exists(os.path.join(OUT, 'img/items', f'{i}.png'))))

# ============ 4. CLASS HERO SPRITES (generated 2-frame idle strips) ============
HERO_PAL = {
    'warrior': ((178, 96, 46), (120, 60, 30), (170, 175, 185)),
    'mage': ((92, 116, 200), (60, 76, 150), (240, 220, 140)),
    'archer': ((104, 176, 82), (66, 120, 54), (150, 110, 70)),
    'rogue': ((150, 104, 196), (100, 66, 140), (120, 120, 130)),
    'priest': ((222, 198, 110), (170, 145, 70), (250, 245, 230)),
    'monk': ((96, 190, 190), (60, 135, 135), (224, 190, 160)),
    'warlock': ((140, 86, 200), (92, 52, 140), (60, 220, 160)),
    'bard': ((222, 130, 176), (165, 85, 125), (240, 220, 140)),
    'necromancer': ((116, 150, 104), (76, 104, 66), (200, 230, 190)),
}

# Each class gets a genuinely DIFFERENT silhouette — distinct body, headgear,
# and weapon — not just a recolor. 32x32, drawn twice for a 2-frame idle bob.
SKIN = (224, 190, 158, 255)
STEEL = (176, 182, 196, 255)
STEEL_D = (120, 126, 140, 255)
WOOD = (140, 100, 58, 255)

def _base(d, y, m, dk, cloak=True):
    # legs
    d.rectangle([13, 24, 15, 30], fill=dk, outline=OUTLINE)
    d.rectangle([17, 24, 19, 30], fill=dk, outline=OUTLINE)
    if cloak:
        d.polygon([(10, 13 + y), (22, 13 + y), (24, 27), (8, 27)], fill=m, outline=OUTLINE)
    else:
        d.polygon([(11, 13 + y), (21, 13 + y), (22, 25), (10, 25)], fill=m, outline=OUTLINE)

def _head(d, y, hood=None, skin=SKIN):
    d.ellipse([12, 5 + y, 20, 14 + y], fill=skin, outline=OUTLINE)
    d.point((14, 9 + y), fill=(30, 24, 34, 255)); d.point((18, 9 + y), fill=(30, 24, 34, 255))
    if hood:
        d.polygon([(11, 4 + y), (21, 4 + y), (22, 11 + y), (10, 11 + y)], fill=hood, outline=OUTLINE)
        d.ellipse([13, 8 + y, 19, 14 + y], fill=(26, 20, 32, 210))
        d.point((14, 11 + y), fill=(220, 90, 90, 255)); d.point((18, 11 + y), fill=(220, 90, 90, 255))

def hero_warrior(d, y, m, dk, tr):
    _base(d, y, m, dk, cloak=False)
    d.rectangle([10, 13 + y, 22, 24], fill=STEEL, outline=OUTLINE)  # plate torso
    d.line([(16, 14 + y), (16, 23)], fill=STEEL_D, width=1)
    _head(d, y, skin=SKIN)
    d.arc([12, 4 + y, 20, 10 + y], 180, 360, fill=STEEL_D, width=2)  # helm brow
    d.line([(6, 9 + y), (6, 27)], fill=STEEL, width=2)  # sword blade left
    d.line([(4, 17), (8, 17)], fill=tr, width=1)  # crossguard
    d.rectangle([23, 12 + y, 27, 24], fill=m, outline=OUTLINE)  # shield right
    d.point((25, 18), fill=tr)

def hero_mage(d, y, m, dk, tr):
    _base(d, y, m, dk)
    _head(d, y, skin=SKIN)
    d.polygon([(11, 6 + y), (21, 6 + y), (16, -6 + y)], fill=m, outline=OUTLINE)  # tall pointed hat
    d.point((16, -5 + y), fill=tr)
    d.line([(6, 4 + y), (6, 30)], fill=WOOD, width=2)  # staff
    d.ellipse([3, 1 + y, 9, 7 + y], fill=tr, outline=OUTLINE)  # orb
    d.point((6, 4 + y), fill=(255, 255, 255, 255))

def hero_archer(d, y, m, dk, tr):
    _base(d, y, m, dk)
    _head(d, y, hood=dk)
    d.arc([22, 6 + y, 30, 28], 270, 90, fill=WOOD, width=2)  # bow curve right
    d.line([(26, 7 + y), (26, 27)], fill=(230, 230, 210, 255), width=1)  # string
    d.line([(14, 16), (26, 16)], fill=tr, width=1)  # nocked arrow
    d.polygon([(9, 12 + y), (11, 8 + y), (12, 13 + y)], fill=(120, 160, 90, 255))  # quiver feather

def hero_rogue(d, y, m, dk, tr):
    _base(d, y, m, dk)
    _head(d, y, hood=m)
    d.polygon([(10, 12 + y), (13, 12 + y), (12, 26)], fill=dk)  # cape swish
    d.line([(6, 20), (10, 16 + y)], fill=STEEL, width=2)  # dagger L
    d.line([(22, 16 + y), (26, 20)], fill=STEEL, width=2)  # dagger R
    d.point((6, 20), fill=tr); d.point((26, 20), fill=tr)

def hero_priest(d, y, m, dk, tr):
    _base(d, y, m, dk)
    d.line([(9, 26), (23, 26)], fill=tr, width=1)  # robe hem trim
    _head(d, y, skin=SKIN)
    d.ellipse([11, 1 + y, 21, 5 + y], outline=(255, 240, 180, 255), width=1)  # halo
    d.line([(24, 8 + y), (24, 26)], fill=(210, 190, 120, 255), width=2)  # mace/staff
    d.rectangle([22, 6 + y, 26, 10 + y], fill=tr, outline=OUTLINE)  # mace head
    d.line([(15, 15), (17, 15)], fill=tr, width=1); d.line([(16, 14), (16, 17)], fill=tr, width=1)  # chest cross

def hero_monk(d, y, m, dk, tr):
    _base(d, y, m, dk, cloak=False)
    d.polygon([(11, 13 + y), (21, 13 + y), (20, 25), (12, 25)], fill=m, outline=OUTLINE)  # simple gi
    d.line([(11, 18 + y), (21, 20 + y)], fill=dk, width=1)  # sash
    _head(d, y, skin=SKIN)  # bald
    d.point((16, 6 + y), fill=dk)
    d.ellipse([7, 17, 11, 21], fill=SKIN, outline=OUTLINE)  # raised fist L
    d.ellipse([21, 17, 25, 21], fill=SKIN, outline=OUTLINE)  # raised fist R
    d.line([(9, 14 + y), (9, 24)], fill=WOOD, width=1)  # bo staff faint

def hero_warlock(d, y, m, dk, tr):
    _base(d, y, m, dk)
    _head(d, y, hood=dk)
    d.polygon([(11, 6 + y), (9, 1 + y), (13, 5 + y)], fill=STEEL_D)  # horn L
    d.polygon([(21, 6 + y), (23, 1 + y), (19, 5 + y)], fill=STEEL_D)  # horn R
    d.ellipse([4, 14, 12, 22], fill=tr, outline=OUTLINE)  # eldritch orb in hand
    d.point((8, 18), fill=(255, 255, 255, 255))
    d.line([(8, 18), (12, 15 + y)], fill=(180, 120, 240, 200), width=1)

def hero_bard(d, y, m, dk, tr):
    _base(d, y, m, dk)
    _head(d, y, skin=SKIN)
    d.polygon([(10, 6 + y), (22, 6 + y), (16, 2 + y)], fill=dk, outline=OUTLINE)  # feathered cap
    d.polygon([(21, 5 + y), (28, -1 + y), (22, 6 + y)], fill=tr)  # feather plume
    d.ellipse([3, 16, 13, 28], fill=WOOD, outline=OUTLINE)  # lute body L
    d.line([(11, 20), (16, 12 + y)], fill=WOOD, width=1)  # lute neck
    d.point((7, 22), fill=(30, 20, 16, 255))  # sound hole

def hero_necromancer(d, y, m, dk, tr):
    _base(d, y, m, dk)
    d.polygon([(10, 12 + y), (13, 12 + y), (11, 27)], fill=dk)  # tattered cloak
    d.polygon([(22, 12 + y), (19, 12 + y), (21, 27)], fill=dk)
    # skull mask
    d.ellipse([12, 5 + y, 20, 14 + y], fill=(228, 228, 214, 255), outline=OUTLINE)
    d.point((14, 9 + y), fill=(20, 16, 20, 255)); d.point((18, 9 + y), fill=(20, 16, 20, 255))
    d.line([(15, 12 + y), (17, 12 + y)], fill=(60, 56, 60, 255), width=1)  # teeth
    d.line([(6, 2 + y), (6, 30)], fill=(90, 90, 96, 255), width=1)  # scythe snath
    d.arc([2, 1 + y, 12, 9 + y], 180, 300, fill=STEEL, width=2)  # scythe blade
    d.point((7, 20), fill=(120, 220, 140, 255))  # essence wisp

HERO_DRAW = {
    'warrior': hero_warrior, 'mage': hero_mage, 'archer': hero_archer, 'rogue': hero_rogue,
    'priest': hero_priest, 'monk': hero_monk, 'warlock': hero_warlock, 'bard': hero_bard,
    'necromancer': hero_necromancer,
}

def draw_hero(cid, main, dark, trim, bob=0):
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    HERO_DRAW[cid](d, bob, main + (255,), dark + (255,), trim + (255,))
    return im

for cid, (main, dark, trim) in HERO_PAL.items():
    strip = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    strip.paste(draw_hero(cid, main, dark, trim, 0), (0, 0))
    strip.paste(draw_hero(cid, main, dark, trim, 1), (32, 0))
    strip.save(os.path.join(OUT, 'img/heroes', f'{cid}.png'))
    artmap['heroes'][cid] = {'f': f'assets/img/heroes/{cid}.png', 'w': 32, 'h': 32}

# ============ 5. BIOME BACKGROUNDS (generated 320x180 parallax scenes) ============
import random
def dither_band(d, x0, x1, y0, y1, c_top, c_bot, rnd):
    steps = 4
    for i in range(steps):
        yy0 = y0 + (y1 - y0) * i // steps
        yy1 = y0 + (y1 - y0) * (i + 1) // steps
        t = i / (steps - 1)
        c = tuple(int(a + (b - a) * t) for a, b in zip(c_top, c_bot))
        d.rectangle([x0, yy0, x1, yy1], fill=c)
        # dither seam
        if i > 0:
            prev = tuple(int(a + (b - a) * (i - 1) / (steps - 1)) for a, b in zip(c_top, c_bot))
            for x in range(x0, x1, 2):
                if rnd.random() < 0.5:
                    d.point((x + (i % 2), yy0), fill=prev)

BIOME_SCENES = {
    'forest': {'sky': ((34, 48, 44), (12, 20, 18)), 'far': (20, 34, 28), 'mid': (14, 26, 20), 'ground': (10, 18, 14), 'shape': 'trees'},
    'ruins': {'sky': ((56, 48, 38), (24, 20, 16)), 'far': (42, 36, 28), 'mid': (30, 26, 20), 'ground': (20, 17, 13), 'shape': 'columns'},
    'frost': {'sky': ((40, 58, 76), (16, 24, 36)), 'far': (54, 74, 96), 'mid': (36, 52, 70), 'ground': (26, 38, 52), 'shape': 'spires'},
    'swamp': {'sky': ((36, 46, 34), (14, 20, 14)), 'far': (28, 38, 26), 'mid': (18, 28, 18), 'ground': (12, 20, 14), 'shape': 'willows'},
    'hell': {'sky': ((70, 30, 24), (26, 10, 10)), 'far': (54, 22, 18), 'mid': (38, 14, 12), 'ground': (26, 10, 9), 'shape': 'crags'},
    'throne': {'sky': ((52, 26, 52), (18, 8, 20)), 'far': (40, 18, 40), 'mid': (28, 12, 28), 'ground': (18, 8, 18), 'shape': 'pillars'},
}

def silhouette(d, shape, base_y, color, rnd, tall=1.0):
    x = -10
    while x < 330:
        if shape == 'trees':
            w = rnd.randint(10, 22); h = int(rnd.randint(30, 70) * tall)
            d.polygon([(x, base_y), (x + w // 2, base_y - h), (x + w, base_y)], fill=color)
            x += rnd.randint(8, 18)
        elif shape == 'columns':
            w = rnd.randint(6, 10); h = int(rnd.randint(24, 60) * tall)
            if rnd.random() < 0.3: h = int(h * 0.4)  # broken stub
            d.rectangle([x, base_y - h, x + w, base_y], fill=color)
            d.rectangle([x - 1, base_y - h, x + w + 1, base_y - h + 3], fill=color)
            x += rnd.randint(16, 34)
        elif shape == 'spires':
            w = rnd.randint(8, 16); h = int(rnd.randint(40, 85) * tall)
            d.polygon([(x, base_y), (x + w // 2, base_y - h), (x + w, base_y)], fill=color)
            d.point((x + w // 2, base_y - h - 1), fill=color)
            x += rnd.randint(10, 22)
        elif shape == 'willows':
            w = rnd.randint(14, 26); h = int(rnd.randint(26, 50) * tall)
            d.ellipse([x, base_y - h, x + w, base_y - h // 3], fill=color)
            d.rectangle([x + w // 2 - 1, base_y - h // 2, x + w // 2 + 1, base_y], fill=color)
            x += rnd.randint(14, 26)
        elif shape == 'crags':
            w = rnd.randint(16, 30); h = int(rnd.randint(28, 66) * tall)
            d.polygon([(x, base_y), (x + w // 3, base_y - h), (x + 2 * w // 3, base_y - h // 2), (x + w, base_y)], fill=color)
            x += rnd.randint(6, 16)
        elif shape == 'pillars':
            w = rnd.randint(10, 14); h = int(rnd.randint(50, 90) * tall)
            d.rectangle([x, base_y - h, x + w, base_y], fill=color)
            d.polygon([(x - 2, base_y - h), (x + w // 2, base_y - h - 8), (x + w + 2, base_y - h)], fill=color)
            x += rnd.randint(30, 50)

for bid, S in BIOME_SCENES.items():
    rnd = random.Random(hash(bid) & 0xFFFF)
    im = Image.new('RGB', (320, 180), S['sky'][1])
    d = ImageDraw.Draw(im)
    dither_band(d, 0, 320, 0, 120, S['sky'][0], S['sky'][1], rnd)
    # glow orb (moon/sun/void)
    gx = rnd.randint(60, 260)
    glow = tuple(min(255, c + 60) for c in S['sky'][0])
    d.ellipse([gx - 14, 18, gx + 14, 46], fill=glow)
    d.ellipse([gx - 10, 22, gx + 10, 42], fill=tuple(min(255, c + 90) for c in S['sky'][0]))
    silhouette(d, S['shape'], 130, S['far'], rnd, tall=0.8)
    silhouette(d, S['shape'], 150, S['mid'], rnd, tall=1.1)
    d.rectangle([0, 150, 320, 180], fill=S['ground'])
    # ground speckle
    for _ in range(160):
        x, y = rnd.randint(0, 319), rnd.randint(152, 179)
        d.point((x, y), fill=tuple(min(255, c + rnd.randint(4, 14)) for c in S['ground']))
    im.save(os.path.join(OUT, 'img/bg', f'{bid}.png'))
    artmap['bg'][bid] = f'assets/img/bg/{bid}.png'

# title backdrop from the forest pack mockup
if have(FOREST):
    shutil.copy(os.path.join(FOREST, 'Mockup1.png'), os.path.join(OUT, 'img/bg', 'title.png'))
    artmap['bg']['title'] = 'assets/img/bg/title.png'

# ============ 6. MUSIC (wav -> ogg, with the pack's official loop points) ============
TRACKS = {
    'title': ('xDeviruchi - Title Theme .wav', 0.0, 120.600),
    'forest': ('xDeviruchi - And The Journey Begins .wav', 7.967, 117.333),
    'ruins': ('xDeviruchi - Exploring The Unknown.wav', 8.733, 120.767),
    'frost': ('xDeviruchi - The Icy Cave .wav', 0.0, 122.667),
    'swamp': ('xDeviruchi - Mysterious Dungeon.wav', 0.0, 0.0),   # pure loop
    'hell': ('xDeviruchi - Mysterious Dungeon.wav', 0.0, 0.0),
    'battle': ('xDeviruchi - Prepare for Battle! .wav', 4.533, 120.800),
    'boss': ('xDeviruchi - Decisive Battle.wav', 0.0, 116.033),
    'rest': ('xDeviruchi - Take some rest and eat some food!.wav', 0.333, 123.033),
    'minigame': ('xDeviruchi - Minigame .wav', 5.467, 73.500),
    'victory': ('xDeviruchi - The Final of The Fantasy.wav', 0.0, 0.0),
}
if have(MUS):
    try:
        import imageio_ffmpeg
        FF = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        FF = 'ffmpeg'
    done = {}
    for key, (src, ls, le) in TRACKS.items():
        out = os.path.join(OUT, 'music', f'{key}.ogg')
        srcp = os.path.join(MUS, src)
        if src in done:
            artmap['music'][key] = {'f': f'assets/music/{done[src]}.ogg', 'ls': ls, 'le': le}
            continue
        subprocess.run([FF, '-y', '-i', srcp, '-c:a', 'libvorbis', '-q:a', '3', '-ac', '1', out],
                       check=True, capture_output=True)
        done[src] = key
        artmap['music'][key] = {'f': f'assets/music/{key}.ogg', 'ls': ls, 'le': le}

# ============ 7. emit js/data/artmap.js ============
with open(os.path.join(ROOT, 'js', 'data', 'artmap.js'), 'w', encoding='utf-8') as f:
    f.write('// GENERATED by tools/build_assets.py — do not edit by hand.\n')
    f.write('// Sprites: PixelFlush Mega Packs (user-licensed). Music: xDeviruchi,\n')
    f.write('// CC-BY-SA 4.0. Generated art: this repo. See CREDITS.md.\n\n')
    f.write('export const ENEMY_ART = ' + json.dumps(artmap['enemies'], indent=1) + ';\n\n')
    f.write('export const ITEM_ART = ' + json.dumps(artmap['items'], indent=1) + ';\n\n')
    f.write('export const HERO_ART = ' + json.dumps(artmap['heroes'], indent=1) + ';\n\n')
    f.write('export const BIOME_BG = ' + json.dumps(artmap['bg'], indent=1) + ';\n\n')
    f.write('export const MUSIC_TRACKS = ' + json.dumps(artmap['music'], indent=1) + ';\n')

print('enemies:', len(artmap['enemies']), '| items:', len(artmap['items']),
      '| heroes:', len(artmap['heroes']), '| bgs:', len(artmap['bg']), '| tracks:', len(artmap['music']))
