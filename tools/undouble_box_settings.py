"""Remove added:: gallery staging cards that duplicate live roster ids.

Live roster entries (forest::, alt_bosses::, npc::, …) are what combat uses.
The added:: copies were staging previews — keeping both doubles the editor and
often applied preview zoom onto live anim strips (broken framing in combat).

Keeps the live uid. Copies flip (and rename if live is blank) from added::,
but does NOT copy zoom/offsets — those were tuned against pack-preview scale.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools" / "enemy-box-settings-2026-07-21.json"
WEB = ROOT / "data" / "enemy-box-settings.json"


def is_added(uid: str) -> bool:
    return str(uid).startswith("added::")


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    items = list(data.get("items") or [])
    by_id: dict[str, list[dict]] = {}
    for it in items:
        by_id.setdefault(it["id"], []).append(it)

    drop_uids: set[str] = set()
    kept_live = 0
    flip_merged = 0
    for eid, group in by_id.items():
        lives = [i for i in group if not is_added(i["uid"])]
        addeds = [i for i in group if is_added(i["uid"])]
        if not lives or not addeds:
            continue
        # Prefer the live card that is already on the combat roster.
        live = next((i for i in lives if i.get("hasAnim") or i.get("section") != "art_only"), lives[0])
        # Staging flip was often correct (player-facing packs); keep it on live.
        if any(a.get("flip") for a in addeds) and not live.get("flip"):
            live["flip"] = True
            flip_merged += 1
        # If live has no rename but added does, keep the nicer name on live.
        for a in addeds:
            if not (live.get("renameName") or "").strip() and (a.get("renameName") or "").strip():
                live["renameName"] = a["renameName"]
                live["renamed"] = True
                live["name"] = a.get("name") or live.get("name")
        for a in addeds:
            drop_uids.add(a["uid"])
        kept_live += 1

    data["items"] = [i for i in items if i["uid"] not in drop_uids]
    if isinstance(data.get("customItems"), list):
        data["customItems"] = [c for c in data["customItems"] if c.get("uid") not in drop_uids]
    if isinstance(data.get("order"), list):
        data["order"] = [u for u in data["order"] if u not in drop_uids]

    if isinstance(data.get("summary"), dict):
        data["summary"]["total"] = len(data["items"])
        data["summary"]["added"] = sum(1 for i in data["items"] if is_added(i["uid"]))

    text = json.dumps(data, indent=2) + "\n"
    SRC.write_text(text, encoding="utf-8")
    WEB.parent.mkdir(parents=True, exist_ok=True)
    WEB.write_text(text, encoding="utf-8")
    print(f"dropped {len(drop_uids)} added:: duplicates across {kept_live} ids (flip merged {flip_merged})")
    print(f"items now {len(data['items'])} customItems {len(data.get('customItems') or [])}")
    print(f"wrote {SRC}")
    print(f"wrote {WEB}")


if __name__ == "__main__":
    main()
