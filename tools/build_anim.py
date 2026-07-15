"""Animated-monster asset pipeline: multi-state sprite packs -> assets/img/anim/
and js/data/animmap.js (ENEMY_ANIM).

Unlike build_assets.py (2-frame idle strips), this stages full animation sets
(idle / attack / hurt / death / ...) as horizontal frame strips, one PNG per
state, plus a data map the runtime (js/anim.js) uses to play them.

Sources are the free packs the friend + Rishi picked (see CREDITS.md):
  - Tiny RPG Character Asset Pack 02  -> imp (Demon_A), demon_slime (Blood Monster_A)
  - boss_demon_slime_FREE_v1.0        -> demon_king  (Demon King, phase 2)
  - Mimic_Animation_Pack              -> mimic

Frames are copied verbatim from packs that already ship horizontal strips; the
boss pack ships individual frames, so we pack those into a strip here.

Run:  python tools/build_anim.py       (reads tools/spritestage/, writes committed output)
The staging dir is disposable — the OUTPUT under assets/img/anim/ is what ships.
"""
import os, glob, json, shutil
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

# fps tuning per role-ish state name (frames/sec). idle is slow + breathing.
FPS = {'idle': 7, 'walk': 10, 'attack01': 13, 'attack02': 13, 'hurt': 12,
       'death': 10, 'cleave': 14, 'take_hit': 12, 'bite': 14, 'tongue': 13,
       'hit': 13, 'reveal': 14}

animmap = {}


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


def new_mon(mon, fw, fh, disp, roles):
    animmap[mon] = {'fw': fw, 'fh': fh, 'disp': disp, 'states': {}, 'roles': roles}


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

# ---- write js/data/animmap.js ----
banner = ('// AUTO-GENERATED by tools/build_anim.py — do not edit by hand.\n'
          '// Multi-state monster animation sets. Each state is a horizontal frame\n'
          '// strip of `n` frames at fw x fh; `roles` maps combat events\n'
          '// (idle/attack/special/hurt/death/intro) to a state. See js/anim.js.\n')
body = 'export const ENEMY_ANIM = ' + json.dumps(animmap, indent=1) + ';\n'
with open(os.path.join(ROOT, 'js', 'data', 'animmap.js'), 'w', encoding='utf-8') as f:
    f.write(banner + body)

print('Wrote js/data/animmap.js and assets/img/anim/ for:',
      ', '.join(f'{m}({len(animmap[m]["states"])} states)' for m in animmap))
