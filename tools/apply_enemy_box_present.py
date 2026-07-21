"""Build js/data/sprite_present.js from the enemy-box settings JSON.

Source of truth: data/enemy-box-settings.json (kept in sync with tools/ copy).

Combat loads that JSON at boot (loadEnemyBoxSettings) so editor Publish →
replace data/enemy-box-settings.json → refresh game matches live roster cards.
The baked ENEMY_PRESENT map is a fast fallback when fetch is unavailable.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS_EXPORT = ROOT / "tools" / "enemy-box-settings-2026-07-21.json"
WEB_EXPORT = ROOT / "data" / "enemy-box-settings.json"
ANIMMAP = ROOT / "js" / "data" / "animmap.js"
ARTMAP = ROOT / "js" / "data" / "artmap.js"
OUT = ROOT / "js" / "data" / "sprite_present.js"

HELPER = r'''
/** Live map used by combat; baked ENEMY_PRESENT is the offline fallback. */
let LIVE_PRESENT = Object.assign(Object.create(null), ENEMY_PRESENT);

function isAdded(item) {
  return item.section === 'added' || String(item.uid || '').startsWith('added::');
}

function scoreItem(item) {
  const zoom = +(item.zoom || 1);
  const ox = +(item.offsetX || 0);
  const oy = +(item.offsetY || 0);
  const flip = item.flip ? 1 : 0;
  const dw = +((item.defaultBox && item.defaultBox.w) || item.defaultBoxW || 96);
  const dh = +((item.defaultBox && item.defaultBox.h) || item.defaultBoxH || 96);
  const bw = +(item.boxW || dw);
  const bh = +(item.boxH || dh);
  const box = (bw !== dw || bh !== dh) ? 1 : 0;
  const sectionRank = isAdded(item) ? 0 : 2;
  return [sectionRank, zoom !== 1 ? 1 : 0, Math.abs(ox) + Math.abs(oy), flip, box];
}

function better(a, b) {
  const sa = scoreItem(a), sb = scoreItem(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] > sb[i];
  }
  return false;
}

function presentEntry(item) {
  const eid = item.id;
  const defaultScale = +(item.defaultScale || 1);
  const zoom = +(item.zoom || 1);
  let eff = item.effectiveScale;
  if (eff == null) eff = defaultScale * zoom;
  else eff = +eff;
  const dw = +((item.defaultBox && item.defaultBox.w) || item.defaultBoxW || 96);
  const dh = +((item.defaultBox && item.defaultBox.h) || item.defaultBoxH || 96);
  const boxW = +(item.boxW || dw);
  const boxH = +(item.boxH || dh);
  let anchor = item.anchor;
  if (anchor !== 'center' && anchor !== 'feet') {
    if (ENEMY_ANIM[eid]?.anchor === 'center' || ENEMY_ART[eid]?.anchor === 'center') {
      anchor = 'center';
    } else {
      anchor = item.boss ? 'feet' : 'center';
    }
  }
  return {
    zoom: Math.round(zoom * 1000) / 1000,
    ox: +(item.offsetX || 0) | 0,
    oy: +(item.offsetY || 0) | 0,
    flip: !!item.flip,
    boxW,
    boxH,
    anchor,
    defaultScale: Math.round(defaultScale * 1000) / 1000,
    scale: Math.round((+eff) * 1000) / 1000,
  };
}

/** Rebuild combat presentation from an enemy-boxes export / data/enemy-box-settings.json. */
export function applyEnemyBoxSettings(data) {
  const chosen = Object.create(null);
  for (const item of data.items || []) {
    if (item.placeholder || !item.id) continue;
    const prev = chosen[item.id];
    if (!prev || better(item, prev)) chosen[item.id] = item;
  }
  const next = Object.create(null);
  for (const eid of Object.keys(chosen).sort()) {
    next[eid] = presentEntry(chosen[eid]);
  }
  LIVE_PRESENT = next;
  return LIVE_PRESENT;
}

export function enemyPresent(id) {
  return LIVE_PRESENT[id] || ENEMY_PRESENT[id] || null;
}

/** Load shipping JSON so combat matches the enemy-boxes page after Publish. */
export async function loadEnemyBoxSettings(url = 'data/enemy-box-settings.json') {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    applyEnemyBoxSettings(await res.json());
    return true;
  } catch (_) {
    return false;
  }
}

/** Mirror enemy-boxes.html box + sprite-wrap presentation around inner sprite HTML. */
export function enemyBoxHtml(id, innerHtml, { boss = false, domId = '' } = {}) {
  const p = enemyPresent(id);
  const boxW = p?.boxW || (boss ? 200 : 96);
  const boxH = p?.boxH || (boss ? 200 : 96);
  const zoom = p?.zoom ?? 1;
  const ox = p?.ox ?? 0;
  const oy = p?.oy ?? 0;
  const flip = !!p?.flip;
  const anchor = p?.anchor || (boss ? 'feet' : 'center');
  const xf = `translate(${ox}px, ${oy}px) scale(${flip ? -zoom : zoom}, ${zoom})`;
  const idAttr = domId ? ` id="${domId}"` : '';
  return `<div class="fighter-sprite"${idAttr} data-anchor="${anchor}" style="width:${boxW}px;height:${boxH}px">`
    + `<div class="sprite-wrap" style="transform:${xf}">${innerHtml}</div>`
    + `</div>`;
}
'''.lstrip()


def score(item: dict) -> tuple:
    zoom = float(item.get("zoom") or 1)
    ox = int(item.get("offsetX") or 0)
    oy = int(item.get("offsetY") or 0)
    flip = 1 if item.get("flip") else 0
    dw = int((item.get("defaultBox") or {}).get("w") or item.get("defaultBoxW") or 96)
    dh = int((item.get("defaultBox") or {}).get("h") or item.get("defaultBoxH") or 96)
    bw = int(item.get("boxW") or dw)
    bh = int(item.get("boxH") or dh)
    box = 1 if (bw != dw or bh != dh) else 0
    section = item.get("section") or ""
    section_rank = 0 if (section == "added" or str(item.get("uid") or "").startswith("added::")) else 2
    return (section_rank, zoom != 1.0, abs(ox) + abs(oy), flip, box)


def pick_items(data: dict) -> dict[str, dict]:
    chosen: dict[str, dict] = {}
    for item in data.get("items") or []:
        if item.get("placeholder"):
            continue
        eid = item.get("id")
        if not eid:
            continue
        prev = chosen.get(eid)
        if prev is None or score(item) >= score(prev):
            chosen[eid] = item
    return chosen


def center_ids_from_maps() -> set[str]:
    ids: set[str] = set()
    for path in (ANIMMAP, ARTMAP):
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(
            r'"([a-z0-9_]+)"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{]*)*)\}',
            text,
            re.I,
        ):
            body = m.group(2)
            if re.search(r'"anchor"\s*:\s*"center"', body):
                ids.add(m.group(1))
    return ids


def present_entry(item: dict, center_ids: set[str]) -> dict:
    default_scale = float(item.get("defaultScale") or 1)
    zoom = float(item.get("zoom") or 1)
    eff = item.get("effectiveScale")
    if eff is None:
        eff = default_scale * zoom
    else:
        eff = float(eff)
    dw = int((item.get("defaultBox") or {}).get("w") or item.get("defaultBoxW") or 96)
    dh = int((item.get("defaultBox") or {}).get("h") or item.get("defaultBoxH") or 96)
    bw = int(item.get("boxW") or dw)
    bh = int(item.get("boxH") or dh)
    eid = item["id"]
    if item.get("anchor") in ("center", "feet"):
        anchor = item["anchor"]
    elif eid in center_ids:
        anchor = "center"
    elif item.get("boss"):
        anchor = "feet"
    else:
        anchor = "center"
    return {
        "zoom": round(zoom, 3),
        "ox": int(item.get("offsetX") or 0),
        "oy": int(item.get("offsetY") or 0),
        "flip": bool(item.get("flip")),
        "boxW": bw,
        "boxH": bh,
        "anchor": anchor,
        "defaultScale": round(default_scale, 3),
        "scale": round(eff, 3),
    }


def resolve_export() -> Path:
    if WEB_EXPORT.exists():
        return WEB_EXPORT
    return TOOLS_EXPORT


def main() -> None:
    src = resolve_export()
    if not src.exists():
        raise SystemExit(f"missing box settings: {WEB_EXPORT} or {TOOLS_EXPORT}")
    raw = src.read_text(encoding="utf-8")
    data = json.loads(raw)
    center_ids = center_ids_from_maps()
    picked = pick_items(data)
    present = {eid: present_entry(item, center_ids) for eid, item in sorted(picked.items())}
    tuned = sum(
        1
        for e in present.values()
        if e["zoom"] != 1 or e["ox"] or e["oy"] or e["flip"] or e["boxW"] not in (96, 200)
    )

    lines = [
        "// GENERATED by tools/apply_enemy_box_present.py - do not edit by hand.",
        f"// Source: {src.relative_to(ROOT).as_posix()}",
        "// Combat also loads data/enemy-box-settings.json at boot (same framing as enemy-boxes.html).",
        "import { ENEMY_ANIM } from './animmap.js';",
        "import { ENEMY_ART } from './artmap.js';",
        "",
        "export const ENEMY_PRESENT = " + json.dumps(present, indent=2) + ";",
        "",
        HELPER,
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")

    text = json.dumps(data, indent=2) + "\n"
    WEB_EXPORT.parent.mkdir(parents=True, exist_ok=True)
    WEB_EXPORT.write_text(text, encoding="utf-8")
    TOOLS_EXPORT.write_text(text, encoding="utf-8")

    print(f"wrote {OUT} entries={len(present)} tuned={tuned} centerIds={len(center_ids)} from {src.name}")
    print(f"wrote {WEB_EXPORT}")
    print(f"wrote {TOOLS_EXPORT}")


if __name__ == "__main__":
    main()
