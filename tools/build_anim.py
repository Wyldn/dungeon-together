"""Animated-monster asset pipeline: multi-state sprite packs -> assets/img/anim/
and js/data/animmap.js (ENEMY_ANIM).

Unlike build_assets.py (2-frame idle strips), this stages full animation sets
(idle / attack / hurt / death / ...) as horizontal frame strips, one PNG per
state, plus a data map the runtime (js/anim.js) uses to play them.

Sources are the free packs the friend + Rishi picked (see CREDITS.md):
  - Tiny RPG Character Asset Pack 02  -> imp (Demon_A), demon_slime (Blood Monster_A)
  - boss_demon_slime_FREE_v1.0        -> demon_king  (Demon King, phase 2)
  - Mimic_Animation_Pack              -> mimic
  - Knight Hero Platfomer             -> warrior     (HERO)
  - viking_axe_pack                   -> viking      (HERO)
  - blue-mage-free                    -> mage        (HERO)
  - FREE SAMPLE RPG Characters        -> cursed_knight
  - Hooded Knight Sprites             -> crowned_revenant (F15 midboss)

Frames are copied verbatim from packs that already ship horizontal strips; the
boss pack ships individual frames, so we pack those into a strip here. The newer
packs draw each animation on its own canvas and need re-packing — see
aligned_set() below.

Output is TWO maps: ENEMY_ANIM (monsters) and HERO_ANIM (player classes). Both
are played by the same code in js/anim.js.

Run:  python tools/build_anim.py       (reads tools/spritestage/, writes committed output)
The staging dir is disposable — the OUTPUT under assets/img/anim/ is what ships.
"""
import os, glob, json, re, shutil
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGE = os.path.join(ROOT, 'tools', 'spritestage')
OUT = os.path.join(ROOT, 'assets', 'img', 'anim')
os.makedirs(OUT, exist_ok=True)

TINY = os.path.join(STAGE, 'tinyrpg',
    'Tiny RPG Character Asset Pack 02 -Free Demon_A&Blood Monster_A',
    'Characters(100x100 split)')
BOSS = os.path.join(STAGE, 'bossslime', 'boss_demon_slime_FREE_v1.0', 'individual sprites')
MIMIC = os.path.join(STAGE, 'mimic', 'Mimic_Animation_Pack', 'Sprites')
KNIGHT = os.path.join(STAGE, 'knight', 'Knight Hero Platfomer')
VIKING = os.path.join(STAGE, 'viking', 'sprites_viking_axe', 'axe_origin')
BLUEMAGE = os.path.join(STAGE, 'bluemage', 'free')
DARKKNIGHT = os.path.join(STAGE, 'darkknight', 'dark knight')
HOODED = os.path.join(STAGE, 'hooded', 'Spritesheets')

# fps tuning per role-ish state name (frames/sec). idle is slow + breathing.
FPS = {'idle': 7, 'walk': 10, 'attack01': 13, 'attack02': 13, 'attack03': 13,
       'hurt': 12, 'death': 10, 'cleave': 14, 'take_hit': 12, 'bite': 14,
       'tongue': 13, 'hit': 13, 'reveal': 14, 'run': 12, 'guard': 12,
       'attack': 14, 'powerup': 14}

animmap = {}
BUCKET = {}   # sprite key -> 'enemy' | 'hero'
heroart = {}  # class id -> HERO_ART entry (the flat idle strip menus/HUD use)


def emit(mon, state, src_strip_path, fw, fh, loop=False, once=False):
    """Copy an already-horizontal strip into place and register it."""
    dst_dir = os.path.join(OUT, mon)
    os.makedirs(dst_dir, exist_ok=True)
    im = Image.open(src_strip_path).convert('RGBA')
    n = max(1, im.width // fw)
    dst = os.path.join(dst_dir, state + '.png')
    im.save(dst)
    animmap[mon]['states'][state] = {
        'f': f'assets/img/anim/{mon}/{state}.png',
        'n': n, 'fps': FPS.get(state, 12),
        **({'loop': True} if loop else {}),
        **({'once': True} if once else {}),
    }
    return n


def emit_from_frames(mon, state, frame_paths, fw, fh, loop=False, once=False):
    """Pack individual frame PNGs into one horizontal strip, then register."""
    dst_dir = os.path.join(OUT, mon)
    os.makedirs(dst_dir, exist_ok=True)
    strip = Image.new('RGBA', (fw * len(frame_paths), fh), (0, 0, 0, 0))
    for i, p in enumerate(frame_paths):
        strip.paste(Image.open(p).convert('RGBA'), (i * fw, 0))
    dst = os.path.join(dst_dir, state + '.png')
    strip.save(dst)
    animmap[mon]['states'][state] = {
        'f': f'assets/img/anim/{mon}/{state}.png',
        'n': len(frame_paths), 'fps': FPS.get(state, 12),
        **({'loop': True} if loop else {}),
        **({'once': True} if once else {}),
    }


def new_mon(mon, fw, fh, disp, roles, bucket='enemy'):
    animmap[mon] = {'fw': fw, 'fh': fh, 'disp': disp, 'states': {}, 'roles': roles}
    BUCKET[mon] = bucket


# ---- Tiny RPG: Demon_A -> imp,  Blood Monster_A -> demon_slime ----
def tiny(mon, folder, disp):
    base = os.path.join(TINY, folder, folder)
    src = lambda s: os.path.join(base, f'{folder}_{s}.png')
    new_mon(mon, 100, 100, disp, {
        'idle': 'idle', 'attack': 'attack01', 'special': 'attack02',
        'hurt': 'hurt', 'death': 'death'})
    emit(mon, 'idle', src('Idle'), 100, 100, loop=True)
    emit(mon, 'walk', src('Walk'), 100, 100, loop=True)
    emit(mon, 'attack01', src('Attack01'), 100, 100, once=True)
    emit(mon, 'attack02', src('Attack02'), 100, 100, once=True)
    emit(mon, 'hurt', src('Hurt'), 100, 100, once=True)
    emit(mon, 'death', src('Death'), 100, 100, once=True)


tiny('imp', 'Demon_A', 100)
tiny('demon_slime', 'Blood Monster_A', 100)
# Tiny ink in a padded 100x100 canvas — scale by inkH, center in the boss box.
animmap['demon_slime']['inkH'] = 15
animmap['demon_slime']['anchor'] = 'center'

# ---- boss_demon_slime -> demon_king (phase 2) ----
new_mon('demon_king', 288, 160, 168, {
    'idle': 'idle', 'attack': 'cleave', 'special': 'cleave',
    'hurt': 'take_hit', 'death': 'death'})
BOSS_STATES = [('01_demon_idle', 'idle', True, False),
               ('02_demon_walk', 'walk', True, False),
               ('03_demon_cleave', 'cleave', False, True),
               ('04_demon_take_hit', 'take_hit', False, True),
               ('05_demon_death', 'death', False, True)]
for folder, state, loop, once in BOSS_STATES:
    frames = sorted(glob.glob(os.path.join(BOSS, folder, '*.png')),
                    key=lambda p: int(''.join(filter(str.isdigit, os.path.basename(p).rsplit('_', 1)[-1])) or 0))
    emit_from_frames('demon_king', state, frames, 288, 160, loop=loop, once=once)
# Body sits low in the wide attack canvas; center + oy keep Vorath in-frame.
animmap['demon_king']['inkH'] = 105
animmap['demon_king']['anchor'] = 'center'
animmap['demon_king']['oy'] = 26

# ---- Mimic ----
new_mon('mimic', 102, 102, 96, {
    'idle': 'idle', 'attack': 'bite', 'special': 'tongue',
    'hurt': 'hit', 'death': 'death', 'intro': 'reveal'})
MIMIC_STATES = [('Idle', 'idle', True, False), ('Walk', 'walk', True, False),
                ('Reveal', 'reveal', False, True), ('Attack_Tongue', 'tongue', False, True),
                ('Attackk_Bite', 'bite', False, True), ('Hit', 'hit', False, True),
                ('Death', 'death', False, True)]
for fname, state, loop, once in MIMIC_STATES:
    emit(mon='mimic', state=state, src_strip_path=os.path.join(MIMIC, fname + '.png'),
         fw=102, fh=102, loop=loop, once=once)

# ============================================================
#  Aligned packs — one canvas per sprite, re-packed from many
# ============================================================
# The newer packs draw each animation on its own canvas: the Knight idles at
# 22x24 but attacks at 40x30; the Hooded Knight idles at 100x100, attacks at
# 180x100 and powers up at 100x180 (the sword arcs far above his head). js/anim.js
# plays a single fw x fh per sprite, so the frames get re-packed onto one canvas.
#
# Anchor: inside a pack, every animation's first frame is the same neutral pose,
# so states are lined up by that frame's alpha-bbox centre-x and bottom-y (feet
# on the ground), then cropped to the tight union of every frame. Within a pack
# those two values share a fractional part, so the offsets come out exact — e.g.
# the viking's ready_1 bbox + (15,17) lands exactly on attack1_1's bbox.
#
# Don't hand-tune the numbers: fix the anchor frame instead.

def hslice(path, fw, fh=None, n=None):
    """Cut a horizontal strip into frames. fh defaults to the sheet height."""
    im = Image.open(path).convert('RGBA')
    fh = fh or im.height
    n = n or im.width // fw
    return [im.crop((i * fw, 0, (i + 1) * fw, fh)) for i in range(n)]


def dirframes(folder, prefix):
    """Load `prefix_1.png, prefix_2.png, ...` in numeric order."""
    paths = sorted(glob.glob(os.path.join(folder, prefix + '_*.png')),
                   key=lambda p: int(re.search(r'(\d+)\.png$', p).group(1)))
    return [Image.open(p).convert('RGBA') for p in paths]


def _anchor(im):
    """(centre-x, bottom-y) of the drawn pixels — the pose's stance on the ground."""
    bb = im.getbbox()
    if not bb:
        return (0.0, 0.0)
    return ((bb[0] + bb[2]) / 2.0, float(bb[3]))


def aligned_set(mon, target_h, roles, states, flip=False, bucket='enemy'):
    """Re-pack `states` [(name, frames, loop, once)] onto one shared canvas.

    `flip` mirrors a pack that faces the wrong way (combat draws enemies on the
    left facing right, the player on the right facing left). `target_h` is the
    height we want the IDLE BODY to read at; disp is snapped to an exact integer
    multiple of the canvas so js/anim.js scales without blurring.
    """
    if flip:
        states = [(n, [f.transpose(Image.FLIP_LEFT_RIGHT) for f in fr], lo, on)
                  for n, fr, lo, on in states]

    tr = {name: tuple(-v for v in _anchor(frames[0])) for name, frames, _, _ in states}

    minx = miny = 1e9
    maxx = maxy = -1e9
    for name, frames, _lo, _on in states:
        tx, ty = tr[name]
        for f in frames:
            bb = f.getbbox()
            if not bb:
                continue
            minx = min(minx, bb[0] + tx); miny = min(miny, bb[1] + ty)
            maxx = max(maxx, bb[2] + tx); maxy = max(maxy, bb[3] + ty)
    fw, fh = int(round(maxx - minx)), int(round(maxy - miny))

    # Scale off the idle BODY, never the canvas: canvases carry headroom for the
    # big attacks (the Knight's sword arc, the Revenant's overhead raise), so
    # scaling by canvas height would draw the mage half again as tall as the
    # warrior. disp = scale * fh keeps js/anim.js on an exact integer scale.
    idle_name = roles.get('idle') or states[0][0]
    idle_bb = next(fr for n, fr, _, _ in states if n == idle_name)[0].getbbox()
    body_h = (idle_bb[3] - idle_bb[1]) if idle_bb else fh
    new_mon(mon, fw, fh, max(1, int(round(target_h / body_h))) * fh, roles, bucket=bucket)

    # Menus, the HUD and the class-select screen draw heroes from the flat
    # HERO_ART strip, not from HERO_ANIM — so cut a tight idle strip from the same
    # pack. Without this a class would show pack art in combat but the old
    # procedural placeholder everywhere else. Cropped to the idle body (no attack
    # headroom) so it reads at menu sizes.
    if bucket == 'hero':
        frames = next(fr for n, fr, _, _ in states if n == idle_name)
        boxes = [f.getbbox() for f in frames if f.getbbox()]
        u = (min(b[0] for b in boxes), min(b[1] for b in boxes),
             max(b[2] for b in boxes), max(b[3] for b in boxes))
        pw, ph = u[2] - u[0], u[3] - u[1]
        strip = Image.new('RGBA', (pw * len(frames), ph), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f.crop(u), (i * pw, 0))
        strip.save(os.path.join(ROOT, 'assets', 'img', 'heroes', mon + '.png'))
        heroart[mon] = {'f': f'assets/img/heroes/{mon}.png', 'w': pw, 'h': ph,
                        'frames': len(frames)}

    # The union grows toward whichever side the attacks swing, so the idle body
    # is rarely in the middle of its own canvas (the Revenant's lands 40px left).
    # Record that offset so js/anim.js can nudge the sprite back under its HP bar.
    ox = int(round(-minx - fw / 2.0))
    if ox:
        animmap[mon]['ox'] = ox
    for name, frames, loop, once in states:
        tx, ty = tr[name]
        ox, oy = int(round(tx - minx)), int(round(ty - miny))
        strip = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * fw + ox, oy))
        dst_dir = os.path.join(OUT, mon)
        os.makedirs(dst_dir, exist_ok=True)
        strip.save(os.path.join(dst_dir, name + '.png'))
        animmap[mon]['states'][name] = {
            'f': f'assets/img/anim/{mon}/{name}.png',
            'n': len(frames), 'fps': FPS.get(name, 12),
            **({'loop': True} if loop else {}),
            **({'once': True} if once else {}),
        }


# ---- Knight Hero Platfomer -> warrior (hero) ----
# Faces left already, which is the side the player fights from. The pack has no
# death frames, so `death` stays unmapped and the .combatant.dying CSS fade plays.
kn = lambda f, fw: hslice(os.path.join(KNIGHT, f + '.png'), fw)
aligned_set('warrior', 64,
            {'idle': 'idle', 'attack': 'attack01', 'special': 'attack02',
             'hurt': 'hurt', 'guard': 'guard'},
            [('idle', kn('Combat Ready Idle', 22), True, False),
             ('walk', kn('Walk', 22), True, False),
             ('run', kn('Run', 22), True, False),
             ('attack01', kn('Attack 1', 40), False, True),
             ('attack02', kn('Attack 2', 40), False, True),
             ('attack03', kn('Attack 3', 40), False, True),
             ('hurt', kn('Hit Front', 22), False, True),
             ('guard', kn('Shield Raise', 22), False, True)],
            bucket='hero')

# ---- viking_axe_pack -> viking (hero). Ships a real death animation. ----
aligned_set('viking', 64,
            {'idle': 'idle', 'attack': 'attack01', 'special': 'attack02',
             'hurt': 'hurt', 'death': 'death'},
            [('idle', dirframes(VIKING, 'ready'), True, False),
             ('walk', dirframes(VIKING, 'walk'), True, False),
             ('run', dirframes(VIKING, 'run'), True, False),
             ('attack01', dirframes(VIKING, 'attack1'), False, True),
             ('attack02', dirframes(VIKING, 'attack2'), False, True),
             ('hurt', dirframes(VIKING, 'hit'), False, True),
             ('death', dirframes(VIKING, 'dead'), False, True)],
            bucket='hero')

# ---- blue-mage-free -> mage (hero). Idle + walk only: no attack/hurt/death art. ----
aligned_set('mage', 64, {'idle': 'idle'},
            [('idle', hslice(os.path.join(BLUEMAGE, 'blue-mage-staff-idle_strip12.png'), 40), True, False),
             ('walk', hslice(os.path.join(BLUEMAGE, 'blue-mage-staff-walk_strip4.png'), 40), True, False)],
            bucket='hero')

# ---- FREE SAMPLE RPG Characters -> cursed_knight (ruins elite) ----
# Drawn facing left for a player character, so it's mirrored for the enemy side.
# The pack's only idle is a single static frame; the in-place walk cycle reads far
# better in a combat line-up, so `idle` is roled onto it.
dks = lambda f, fw: hslice(os.path.join(DARKKNIGHT, 'Spritesheets', f + '-Sheet.png'), fw)
aligned_set('cursed_knight', 84,
            {'idle': 'walk', 'attack': 'attack01', 'special': 'attack02',
             'hurt': 'hurt', 'death': 'death'},
            [('idle', hslice(os.path.join(DARKKNIGHT, 'dark_knight_idle.png'), 48), True, False),
             ('walk', dks('dark_knight_walk', 48), True, False),
             ('attack01', dks('dark_knight_attack1', 80), False, True),
             ('attack02', dks('dark_knight_attack2', 96), False, True),
             ('hurt', dks('dark_knight_hurt', 48), False, True),
             ('death', dks('dark_knight_defeated', 64), False, True)],
            flip=True)

# ---- Hooded Knight -> crowned_revenant (F15 midboss) ----
# Already faces right. No hurt/death art in the pack; the 19-frame powerup (he
# raises the greatsword and the blade lights up) is his special.
aligned_set('crowned_revenant', 90,
            {'idle': 'idle', 'attack': 'attack', 'special': 'powerup'},
            [('idle', hslice(os.path.join(HOODED, 'hooded knight idle.png'), 100), True, False),
             ('attack', hslice(os.path.join(HOODED, 'hooded knight attack.png'), 180), False, True),
             ('powerup', hslice(os.path.join(HOODED, 'hooded knight powerup.png'), 100), False, True)])

# ---- write js/data/animmap.js ----
banner = ('// AUTO-GENERATED by tools/build_anim.py — do not edit by hand.\n'
          '// Multi-state animation sets. Each state is a horizontal frame strip of\n'
          '// `n` frames at fw x fh; `roles` maps combat events\n'
          '// (idle/attack/special/hurt/death/intro) to a state. A role left unmapped\n'
          '// simply does not play — e.g. packs that ship no death frames fall back to\n'
          '// the .combatant.dying CSS fade. See js/anim.js.\n')
sets = lambda b: {k: v for k, v in animmap.items() if BUCKET[k] == b}
body = ('export const ENEMY_ANIM = ' + json.dumps(sets('enemy'), indent=1) + ';\n\n'
        + '// Player classes. Anything not listed here falls back to the flat\n'
        + '// HERO_ART idle strip in js/data/artmap.js.\n'
        + 'export const HERO_ANIM = ' + json.dumps(sets('hero'), indent=1) + ';\n')
with open(os.path.join(ROOT, 'js', 'data', 'animmap.js'), 'w', encoding='utf-8') as f:
    f.write(banner + body)

for b in ('enemy', 'hero'):
    print(f'{b:6s}:', ', '.join(
        f'{m}({animmap[m]["fw"]}x{animmap[m]["fh"]}, {len(animmap[m]["states"])} states)'
        for m in sets(b)))

# ============================================================
#  NPC Pack -> event portraits (static, not animated)
# ============================================================
# Not animations, but they come from a pack staged here and land in artmap.js the
# same way, so they ride along rather than needing a third pipeline. The sheets
# are 165x153 busts with the character parked off-centre; the event card draws
# them in a square slot, so trim to the drawn pixels and pad to a centred square
# (bottom-aligned — they're busts, they should sit on the baseline).
NPC_SRC = {
    'old_man': 'Old man', 'jester': 'Jester', 'girl': 'Shy little girl',
    'soldier': 'Soldier', 'woman': 'Woman',
}
npcart = {}
npc_out = os.path.join(ROOT, 'assets', 'img', 'npc')
os.makedirs(npc_out, exist_ok=True)
for nid, folder in NPC_SRC.items():
    im = Image.open(os.path.join(STAGE, 'npc', folder, folder + ' portrait.png')).convert('RGBA')
    im = im.crop(im.getbbox())
    side = max(im.width, im.height)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, side - im.height))
    sq.save(os.path.join(npc_out, nid + '.png'))
    npcart[nid] = f'assets/img/npc/{nid}.png'

# ---- merge HERO_ART into js/data/artmap.js ----
# artmap.js is build_assets.py's file; patch just the one block (same approach as
# tools/integrate_new_assets.py). build_assets.py preserves entries it can't
# regenerate and skips the pack-backed classes, so the two pipelines don't fight.
AM = os.path.join(ROOT, 'js', 'data', 'artmap.js')
text = open(AM, encoding='utf-8').read()


def patch_block(src, var, merged):
    m = re.search(r'export const ' + var + r' = (\{.*?\});', src, re.S)
    if not m:
        raise SystemExit(f'Could not find {var} in artmap.js')
    out = dict(json.loads(m.group(1)))
    out.update(merged)
    return src[:m.start()] + f'export const {var} = ' + json.dumps(out, indent=1) + ';' + src[m.end():]


text = patch_block(text, 'HERO_ART', heroart)
if 'export const NPC_ART' in text:
    text = patch_block(text, 'NPC_ART', npcart)
else:  # first run — seed the block build_assets.py now preserves
    text = text.replace('export const ENEMY_ART = ',
                        'export const NPC_ART = ' + json.dumps(npcart, indent=1) + ';\n\nexport const ENEMY_ART = ', 1)
open(AM, 'w', encoding='utf-8').write(text)
print('hero  : patched HERO_ART ->', ', '.join(
    f'{k}({v["w"]}x{v["h"]}, {v["frames"]}f)' for k, v in heroart.items()))
print('npc   : patched NPC_ART ->', ', '.join(npcart))
