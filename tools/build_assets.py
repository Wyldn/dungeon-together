"""Asset pipeline: packs + generated pixel art -> assets/ + js/data/artmap.js

Sources (user-provided packs, staged outside the repo):
  - PixelFlush Pixel Monsters Mega Pack (enemy sprites, multi-frame idle strips)
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
    for key, var in [('enemies', 'ENEMY_ART'), ('items', 'ITEM_ART'), ('heroes', 'HERO_ART'), ('bg', 'BIOME_BG'), ('music', 'MUSIC_TRACKS'), ('races', 'RACE_ART'), ('origins', 'ORIGIN_ART'), ('events', 'EVENT_CAT_ART'), ('npc', 'NPC_ART')]:
        m = _re.search(r'export const ' + var + r' = (\{.*?\});', _txt, _re.S)
        if m:
            try:
                artmap[key] = json.loads(m.group(1))
            except Exception:
                pass

def have(path):
    return path and os.path.isdir(path)

# ============ 1. ENEMIES (idle strips from the monsters pack; 2–4 frames) ============
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
        # Idle strips are usually square frames in a horizontal row (2, 3, or 4).
        # Older code always used width//2, which doubled 4-frame sheets on screen.
        if im.height > 0 and im.width % im.height == 0:
            frames = max(1, im.width // im.height)
        else:
            frames = 2
        fw, fh = im.width // frames, im.height
        shutil.copy(p, os.path.join(OUT, 'img/enemies', f'{eid}.png'))
        artmap['enemies'][eid] = {
            'f': f'assets/img/enemies/{eid}.png',
            'w': fw, 'h': fh, 'frames': frames,
        }

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

# Classes whose art comes from a real sprite pack via tools/build_anim.py. Their
# HERO_ART entries are preserved from the existing artmap.js above, so leave both
# the PNG and the entry alone — redrawing the placeholder would undo that pack.
PACK_HEROES = {'warrior', 'mage', 'viking'}

for cid, (main, dark, trim) in HERO_PAL.items():
    if cid in PACK_HEROES:
        continue
    strip = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    strip.paste(draw_hero(cid, main, dark, trim, 0), (0, 0))
    strip.paste(draw_hero(cid, main, dark, trim, 1), (32, 0))
    strip.save(os.path.join(OUT, 'img/heroes', f'{cid}.png'))
    artmap['heroes'][cid] = {'f': f'assets/img/heroes/{cid}.png', 'w': 32, 'h': 32, 'frames': 2}

# ============ 4b. RACE PORTRAITS (distinct 32x32 busts) ============
for d in ['img/races', 'img/origins', 'img/events']:
    os.makedirs(os.path.join(OUT, d), exist_ok=True)
artmap.setdefault('races', {}); artmap.setdefault('origins', {}); artmap.setdefault('events', {})

def _portrait_base(d, skin, hair, hair_dark):
    # shoulders
    d.polygon([(6, 30), (9, 22), (23, 22), (26, 30)], fill=(48, 42, 60, 255), outline=OUTLINE)
    # neck + face
    d.rectangle([14, 18, 18, 23], fill=skin)
    d.ellipse([9, 5, 23, 21], fill=skin, outline=OUTLINE)
    # eyes
    d.rectangle([12, 12, 13, 14], fill=(30, 24, 34, 255))
    d.rectangle([19, 12, 20, 14], fill=(30, 24, 34, 255))
    return skin, hair, hair_dark

def race_human(d):
    _portrait_base(d, (226, 190, 156, 255), (120, 82, 48, 255), (86, 58, 34, 255))
    d.polygon([(8, 8), (16, 2), (24, 8), (23, 12), (9, 12)], fill=(120, 82, 48, 255), outline=OUTLINE)  # hair
    d.line([(10, 10), (22, 10)], fill=(86, 58, 34, 255), width=1)
    d.line([(11, 16), (13, 16)], fill=(150, 120, 90, 255), width=1)  # slight brow

def race_elf(d):
    _portrait_base(d, (232, 214, 196, 255), (232, 224, 180, 255), (190, 178, 130, 255))
    # long pale hair
    d.polygon([(7, 7), (16, 1), (25, 7), (26, 22), (23, 22), (22, 9), (10, 9), (9, 22), (6, 22)], fill=(232, 224, 180, 255), outline=OUTLINE)
    # pointed ears
    d.polygon([(8, 12), (5, 8), (9, 15)], fill=(232, 214, 196, 255), outline=OUTLINE)
    d.polygon([(24, 12), (27, 8), (23, 15)], fill=(232, 214, 196, 255), outline=OUTLINE)
    d.point((16, 4), fill=(180, 220, 255, 255))  # circlet gem
    d.line([(11, 5), (21, 5)], fill=(200, 200, 220, 255), width=1)  # circlet

def race_orc(d):
    _portrait_base(d, (110, 150, 88, 255), (40, 36, 30, 255), (26, 24, 20, 255))
    d.polygon([(8, 8), (16, 3), (24, 8), (23, 11), (9, 11)], fill=(40, 36, 30, 255), outline=OUTLINE)  # dark hair
    # tusks jutting up from jaw
    d.polygon([(12, 20), (11, 15), (13, 20)], fill=(235, 232, 220, 255), outline=OUTLINE)
    d.polygon([(20, 20), (21, 15), (19, 20)], fill=(235, 232, 220, 255), outline=OUTLINE)
    d.line([(11, 11), (14, 12)], fill=(70, 100, 55, 255), width=1)  # heavy brow
    d.line([(18, 12), (21, 11)], fill=(70, 100, 55, 255), width=1)
    d.rectangle([12, 12, 13, 13], fill=(220, 90, 60, 255))  # reddish eyes
    d.rectangle([19, 12, 20, 13], fill=(220, 90, 60, 255))

def race_dwarf(d):
    _portrait_base(d, (222, 168, 132, 255), (150, 90, 50, 255), (110, 64, 34, 255))
    # helmet
    d.polygon([(8, 9), (10, 3), (22, 3), (24, 9)], fill=(150, 155, 165, 255), outline=OUTLINE)
    d.rectangle([8, 8, 24, 10], fill=(110, 115, 128, 255))
    d.line([(16, 3), (16, 9)], fill=(90, 95, 108, 255), width=1)  # nose guard
    # huge braided beard covering lower face
    d.polygon([(9, 15), (23, 15), (21, 31), (11, 31)], fill=(150, 90, 50, 255), outline=OUTLINE)
    d.line([(13, 18), (13, 30)], fill=(110, 64, 34, 255), width=1)
    d.line([(16, 17), (16, 31)], fill=(110, 64, 34, 255), width=1)
    d.line([(19, 18), (19, 30)], fill=(110, 64, 34, 255), width=1)
    d.ellipse([13, 27, 15, 29], fill=(200, 170, 90, 255))  # braid bead
    d.ellipse([17, 27, 19, 29], fill=(200, 170, 90, 255))

def race_halfling(d):
    # slightly smaller face, curly hair, round cheeks
    skin = (236, 198, 164, 255)
    d.polygon([(7, 30), (10, 23), (22, 23), (25, 30)], fill=(70, 92, 58, 255), outline=OUTLINE)  # cloak
    d.rectangle([14, 18, 18, 23], fill=skin)
    d.ellipse([10, 7, 22, 21], fill=skin, outline=OUTLINE)
    d.rectangle([12, 13, 13, 14], fill=(30, 24, 34, 255))
    d.rectangle([18, 13, 19, 14], fill=(30, 24, 34, 255))
    d.ellipse([9, 4, 23, 12], fill=(180, 120, 70, 255), outline=OUTLINE)  # curly mop
    d.point((12, 7), fill=(150, 96, 52, 255)); d.point((16, 5), fill=(150, 96, 52, 255)); d.point((20, 7), fill=(150, 96, 52, 255))
    d.ellipse([11, 16, 13, 18], fill=(220, 150, 130, 255))  # rosy cheek
    d.ellipse([19, 16, 21, 18], fill=(220, 150, 130, 255))
    d.point((16, 3), fill=(90, 200, 110, 255))  # lucky clover fleck

def race_tiefling(d):
    _portrait_base(d, (188, 110, 118, 255), (40, 28, 48, 255), (28, 18, 34, 255))
    d.polygon([(8, 8), (16, 2), (24, 8), (23, 11), (9, 11)], fill=(40, 28, 48, 255), outline=OUTLINE)
    # horns
    d.polygon([(10, 8), (7, 1), (12, 7)], fill=(70, 48, 58, 255), outline=OUTLINE)
    d.polygon([(22, 8), (25, 1), (20, 7)], fill=(70, 48, 58, 255), outline=OUTLINE)
    d.rectangle([12, 12, 13, 13], fill=(255, 170, 80, 255))  # ember eyes
    d.rectangle([19, 12, 20, 13], fill=(255, 170, 80, 255))
    d.line([(15, 18), (17, 18)], fill=(120, 60, 70, 255), width=1)
    d.point((16, 4), fill=(255, 120, 60, 255))

def race_beastfolk(d):
    fur = (168, 120, 78, 255)
    d.polygon([(6, 30), (9, 22), (23, 22), (26, 30)], fill=(58, 48, 42, 255), outline=OUTLINE)
    d.rectangle([14, 18, 18, 23], fill=fur)
    d.ellipse([9, 6, 23, 21], fill=fur, outline=OUTLINE)
    # ears
    d.polygon([(10, 8), (8, 1), (14, 7)], fill=fur, outline=OUTLINE)
    d.polygon([(22, 8), (24, 1), (18, 7)], fill=fur, outline=OUTLINE)
    d.polygon([(10, 8), (9, 3), (12, 7)], fill=(210, 160, 120, 255))  # inner ear
    d.polygon([(22, 8), (23, 3), (20, 7)], fill=(210, 160, 120, 255))
    d.rectangle([12, 12, 13, 14], fill=(40, 180, 90, 255))  # predator eyes
    d.rectangle([19, 12, 20, 14], fill=(40, 180, 90, 255))
    d.polygon([(14, 16), (16, 19), (18, 16)], fill=(90, 60, 40, 255))  # snout tip
    d.line([(11, 10), (14, 11)], fill=(120, 80, 50, 255), width=1)
    d.line([(18, 11), (21, 10)], fill=(120, 80, 50, 255), width=1)

def race_dragonkin(d):
    scale = (72, 140, 110, 255)
    d.polygon([(6, 30), (9, 22), (23, 22), (26, 30)], fill=(48, 70, 90, 255), outline=OUTLINE)
    d.rectangle([14, 18, 18, 23], fill=scale)
    d.ellipse([9, 5, 23, 21], fill=scale, outline=OUTLINE)
    # crest / horns
    d.polygon([(12, 7), (11, 1), (15, 6)], fill=(50, 100, 80, 255), outline=OUTLINE)
    d.polygon([(20, 7), (21, 1), (17, 6)], fill=(50, 100, 80, 255), outline=OUTLINE)
    d.polygon([(16, 5), (16, 0), (18, 5)], fill=(40, 90, 70, 255), outline=OUTLINE)
    d.rectangle([12, 12, 13, 13], fill=(255, 210, 80, 255))  # gold eyes
    d.rectangle([19, 12, 20, 13], fill=(255, 210, 80, 255))
    # snout plate
    d.polygon([(13, 16), (16, 20), (19, 16)], fill=(90, 170, 130, 255), outline=OUTLINE)
    d.point((14, 9), fill=(40, 80, 65, 255)); d.point((18, 9), fill=(40, 80, 65, 255))  # scale marks

RACE_DRAW = {
    'human': race_human, 'elf': race_elf, 'orc': race_orc, 'dwarf': race_dwarf,
    'halfling': race_halfling, 'tiefling': race_tiefling, 'beastfolk': race_beastfolk, 'dragonkin': race_dragonkin,
}
for rid, painter in RACE_DRAW.items():
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    painter(ImageDraw.Draw(im))
    im.save(os.path.join(OUT, 'img/races', f'{rid}.png'))
    artmap['races'][rid] = f'assets/img/races/{rid}.png'

# ============ 4c. ORIGIN EMBLEMS (32x32 scene icons) ============
def emblem(painter, iid, bucket='origins', folder='origins'):
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    painter(ImageDraw.Draw(im))
    im.save(os.path.join(OUT, f'img/{folder}', f'{iid}.png'))
    artmap[bucket][iid] = f'assets/img/{folder}/{iid}.png'

def org_mage(d):
    d.rectangle([9, 18, 23, 27], fill=(70, 60, 130, 255), outline=OUTLINE)  # book
    d.line([(16, 18), (16, 27)], fill=(40, 34, 80, 255), width=1)
    d.polygon([(16, 3), (18, 9), (24, 9), (19, 13), (21, 19), (16, 15), (11, 19), (13, 13), (8, 9), (14, 9)], fill=(240, 220, 130, 255), outline=OUTLINE)  # star

def org_sword(d):
    d.line([(7, 25), (23, 7)], fill=STEEL, width=2)  # blade 1
    d.line([(25, 25), (9, 7)], fill=STEEL, width=2)  # blade 2
    d.line([(6, 22), (12, 26)], fill=(150, 110, 60, 255), width=2)  # hilt 1
    d.line([(26, 22), (20, 26)], fill=(150, 110, 60, 255), width=2)  # hilt 2

def org_merc(d):
    d.rectangle([9, 5, 11, 28], fill=(90, 70, 50, 255), outline=OUTLINE)  # pole
    d.polygon([(11, 6), (26, 9), (11, 15)], fill=(170, 60, 60, 255), outline=OUTLINE)  # banner
    d.line([(15, 9), (22, 10)], fill=(230, 200, 120, 255), width=1)

def org_guild(d):
    d.polygon([(8, 6), (24, 6), (24, 18), (16, 27), (8, 18)], fill=(80, 110, 150, 255), outline=OUTLINE)  # shield
    d.polygon([(16, 10), (20, 18), (12, 18)], fill=(230, 210, 140, 255))  # emblem
    d.point((16, 14), fill=(255, 255, 255, 255))

def org_temple(d):
    d.ellipse([10, 4, 22, 16], fill=(250, 235, 170, 255), outline=(230, 200, 110, 255))  # sun
    for a in range(0, 360, 45):
        import math as _m
        x = 16 + int(11 * _m.cos(_m.radians(a))); yy = 10 + int(11 * _m.sin(_m.radians(a)))
        d.point((x, yy), fill=(250, 220, 120, 255))
    d.rectangle([8, 24, 24, 28], fill=(200, 190, 170, 255), outline=OUTLINE)  # steps
    d.rectangle([11, 18, 21, 24], fill=(220, 210, 190, 255), outline=OUTLINE)  # arch

def org_streets(d):
    d.line([(9, 24), (20, 10)], fill=STEEL, width=2)  # dagger blade
    d.line([(7, 26), (12, 22)], fill=(90, 70, 50, 255), width=2)  # hilt
    d.ellipse([18, 18, 27, 27], fill=(210, 180, 80, 255), outline=OUTLINE)  # coin
    d.point((22, 22), fill=(150, 120, 40, 255))

ORIGIN_DRAW = {
    'mage_academy': org_mage, 'sword_academy': org_sword, 'mercenary': org_merc,
    'guild': org_guild, 'temple': org_temple, 'streets': org_streets,
}
for oid, painter in ORIGIN_DRAW.items():
    emblem(painter, oid)

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

# ============ 6b. EVENT CATEGORY EMBLEMS (48x48 pixel scenes) ============
import math as _math
def ev_icon(painter, cid):
    im = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # soft round backing so it reads on any card art
    d.ellipse([2, 2, 46, 46], fill=(18, 14, 26, 170), outline=(120, 100, 60, 120))
    painter(d)
    im.save(os.path.join(OUT, 'img/events', f'cat_{cid}.png'))
    artmap['events'][cid] = f'assets/img/events/cat_{cid}.png'

def ec_combat(d):
    d.line([(12, 36), (32, 12)], fill=STEEL, width=3)  # sword
    d.line([(10, 12), (30, 34)], fill=(200, 130, 70, 255), width=2)  # axe haft
    d.polygon([(28, 30), (36, 30), (34, 40), (26, 40)], fill=(150, 60, 55, 255), outline=OUTLINE)  # axe head
    d.rectangle([30, 26, 40, 40], fill=(90, 110, 150, 200), outline=OUTLINE)  # shield

def ec_mystery(d):
    for i, r in enumerate([18, 13, 8]):
        d.arc([24 - r, 24 - r, 24 + r, 24 + r], 20 + i * 40, 260 + i * 40, fill=(150, 120, 210, 255), width=2)
    d.ellipse([20, 20, 28, 28], fill=(200, 180, 255, 255))
    d.point((24, 24), fill=(255, 255, 255, 255))

def ec_merchant(d):
    d.polygon([(16, 20), (32, 20), (34, 40), (14, 40)], fill=(150, 110, 60, 255), outline=OUTLINE)  # purse
    d.line([(18, 20), (22, 14), (26, 14), (30, 20)], fill=(110, 80, 44, 255), width=2)  # drawstring
    d.ellipse([20, 27, 28, 35], fill=(230, 200, 90, 255))  # coin
    d.point((24, 31), fill=(150, 120, 40, 255))

def ec_recovery(d):
    d.polygon([(24, 14), (34, 40), (14, 40)], fill=(60, 90, 120, 255), outline=OUTLINE)  # tent
    d.polygon([(24, 22), (30, 40), (18, 40)], fill=(20, 16, 26, 255))  # opening
    d.ellipse([20, 34, 28, 42], fill=(240, 150, 50, 255))  # fire glow
    d.point((24, 37), fill=(255, 230, 120, 255))

def ec_training(d):
    for r, c in [(18, (200, 60, 55)), (12, (240, 240, 235)), (6, (200, 60, 55))]:
        d.ellipse([24 - r, 24 - r, 24 + r, 24 + r], fill=c + (255,), outline=OUTLINE)
    d.ellipse([21, 21, 27, 27], (230, 210, 130, 255))
    d.line([(6, 42), (24, 24)], fill=(150, 110, 60, 255), width=2)  # arrow in target

def ec_appraisal(d):
    d.ellipse([12, 12, 28, 28], outline=(220, 200, 120, 255), width=3)  # lens ring
    d.ellipse([15, 15, 25, 25], fill=(120, 180, 220, 120))
    d.line([(26, 26), (38, 38)], fill=(200, 180, 110, 255), width=3)  # handle
    d.polygon([(18, 20), (21, 15), (24, 20), (21, 24)], fill=(180, 230, 255, 255))  # gem glint

def ec_equipment(d):
    d.rectangle([12, 22, 36, 38], fill=(120, 84, 48, 255), outline=OUTLINE)  # chest body
    d.polygon([(12, 22), (24, 14), (36, 22)], fill=(150, 108, 64, 255), outline=OUTLINE)  # lid
    d.rectangle([22, 24, 26, 30], fill=(230, 200, 90, 255))  # lock
    d.line([(12, 30), (36, 30)], fill=(90, 62, 34, 255), width=1)
    d.point((24, 20), fill=(255, 240, 160, 255))

def ec_social(d):
    d.polygon([(8, 14), (24, 14), (24, 26), (16, 26), (12, 32), (13, 26), (8, 26)], fill=(90, 130, 180, 255), outline=OUTLINE)
    d.polygon([(24, 20), (40, 20), (40, 32), (36, 32), (35, 38), (32, 32), (24, 32)], fill=(180, 120, 150, 255), outline=OUTLINE)

def ec_advancement(d):
    d.polygon([(24, 6), (28, 18), (40, 18), (30, 26), (34, 38), (24, 30), (14, 38), (18, 26), (8, 18), (20, 18)], fill=(240, 210, 110, 255), outline=OUTLINE)  # star
    d.point((24, 20), fill=(255, 255, 210, 255))
    d.polygon([(20, 40), (28, 40), (24, 44)], fill=(200, 170, 90, 255))  # upward arrow tail

def ec_dangerous(d):
    d.ellipse([14, 10, 34, 30], fill=(228, 228, 214, 255), outline=OUTLINE)  # skull
    d.rectangle([18, 18, 21, 23], fill=(20, 16, 20, 255))
    d.rectangle([27, 18, 30, 23], fill=(20, 16, 20, 255))
    d.line([(20, 30), (28, 30)], fill=(60, 56, 60, 255), width=1)  # teeth
    d.line([(12, 36), (36, 44)], fill=(200, 60, 55, 255), width=2)  # hazard slash
    d.line([(36, 36), (12, 44)], fill=(200, 60, 55, 255), width=2)

def ec_unknown(d):
    d.ellipse([12, 12, 36, 36], fill=(40, 30, 60, 255), outline=(120, 100, 160, 255))
    # a big drawn "?" using rectangles
    d.arc([17, 14, 31, 26], 150, 400, fill=(210, 200, 240, 255), width=3)
    d.line([(24, 26), (24, 30)], fill=(210, 200, 240, 255), width=3)
    d.rectangle([22, 33, 26, 37], fill=(210, 200, 240, 255))

EVENT_CATS = {
    'combat': ec_combat, 'mystery': ec_mystery, 'merchant': ec_merchant, 'recovery': ec_recovery,
    'training': ec_training, 'appraisal': ec_appraisal, 'equipment': ec_equipment, 'social': ec_social,
    'advancement': ec_advancement, 'dangerous': ec_dangerous, 'unknown': ec_unknown,
}
for cid, painter in EVENT_CATS.items():
    ev_icon(painter, cid)

# ============ 6c. TRAVEL-MAP BACKDROP (1280x720 night ascent) ============
_rnd = random.Random(90210)
tm = Image.new('RGB', (1280, 720), (8, 6, 18))
td = ImageDraw.Draw(tm)
# vertical night gradient, deep indigo -> near black
for y in range(720):
    t = y / 720
    c = (int(20 - 14 * t + 8 * (1 - t)), int(14 - 8 * t + 6 * (1 - t)), int(44 - 30 * t))
    td.line([(0, y), (1280, y)], fill=c)
# star field
for _ in range(320):
    x, y = _rnd.randint(0, 1279), _rnd.randint(0, 520)
    b = _rnd.randint(90, 235)
    s = 1 if _rnd.random() < 0.85 else 2
    td.rectangle([x, y, x + s - 1, y + s - 1], fill=(b, b, min(255, b + 20)))
# a couple of brighter "constellation" stars with faint cross-glow
for _ in range(14):
    x, y = _rnd.randint(80, 1200), _rnd.randint(40, 420)
    td.line([(x - 3, y), (x + 3, y)], fill=(220, 210, 255))
    td.line([(x, y - 3), (x, y + 3)], fill=(220, 210, 255))
    td.point((x, y), fill=(255, 255, 255))
# distant moon
td.ellipse([980, 70, 1080, 170], fill=(210, 205, 230))
td.ellipse([1000, 82, 1082, 164], fill=(228, 224, 244))
# the tower — a tall dark silhouette rising through the centre-lower frame
tx = 560
for i, (w, h0, h1) in enumerate([(160, 720, 360), (120, 720, 300), (88, 720, 250)]):
    shade = (16 + i * 5, 12 + i * 4, 30 + i * 6)
    td.polygon([(tx + 80 - w // 2, 720), (tx + 80 - w // 2 + 8, h1), (tx + 80 + w // 2 - 8, h1), (tx + 80 + w // 2, 720)], fill=shade)
# tower battlement crown + window lights
td.rectangle([tx + 30, 250, tx + 130, 262], fill=(24, 18, 40))
for wx in range(tx + 44, tx + 120, 22):
    for wy in range(300, 700, 90):
        if _rnd.random() < 0.6:
            td.rectangle([wx, wy, wx + 5, wy + 8], fill=(230, 180, 90))
# ground mist band
for y in range(640, 720):
    a = (y - 640) / 80
    td.line([(0, y), (1280, y)], fill=(int(20 * a + 8), int(16 * a + 6), int(30 * a + 12)))
tm.save(os.path.join(OUT, 'img/bg', 'travelmap.png'))
artmap['bg']['travelmap'] = 'assets/img/bg/travelmap.png'

# ============ 7. emit js/data/artmap.js ============
with open(os.path.join(ROOT, 'js', 'data', 'artmap.js'), 'w', encoding='utf-8') as f:
    f.write('// GENERATED by tools/build_assets.py — do not edit by hand.\n')
    f.write('// Sprites: PixelFlush Mega Packs (user-licensed). Music: xDeviruchi,\n')
    f.write('// CC-BY-SA 4.0. Generated art: this repo. See CREDITS.md.\n\n')
    f.write('export const RACE_ART = ' + json.dumps(artmap['races'], indent=1) + ';\n\n')
    f.write('export const ORIGIN_ART = ' + json.dumps(artmap['origins'], indent=1) + ';\n\n')
    f.write('export const EVENT_CAT_ART = ' + json.dumps(artmap['events'], indent=1) + ';\n\n')
    # Written by tools/build_anim.py from the NPC Pack; preserved here so a
    # rebuild without that pack staged doesn't drop the block.
    f.write('export const NPC_ART = ' + json.dumps(artmap.get('npc', {}), indent=1) + ';\n\n')
    f.write('export const ENEMY_ART = ' + json.dumps(artmap['enemies'], indent=1) + ';\n\n')
    f.write('export const ITEM_ART = ' + json.dumps(artmap['items'], indent=1) + ';\n\n')
    f.write('export const HERO_ART = ' + json.dumps(artmap['heroes'], indent=1) + ';\n\n')
    f.write('export const BIOME_BG = ' + json.dumps(artmap['bg'], indent=1) + ';\n\n')
    f.write('export const MUSIC_TRACKS = ' + json.dumps(artmap['music'], indent=1) + ';\n')

print('enemies:', len(artmap['enemies']), '| items:', len(artmap['items']),
      '| heroes:', len(artmap['heroes']), '| bgs:', len(artmap['bg']), '| tracks:', len(artmap['music']))
