"""Local save file: player profile, stats and personal bests (JSON on disk)."""
from __future__ import annotations

import copy
import json
import os
import threading

_lock = threading.Lock()

DEFAULT_PROFILE = {
    "name": "Player",
    "color": "#ff5fa2",
    "tutorial_done": False,
    "stats": {"shows_played": 0, "wins": 0, "rounds_qualified": 0},
    "personal_best": {
        "best_score": 0,
        "furthest_round": 0,
        "levels": {},  # level id -> {"best_time": seconds}
    },
}


def _merge(defaults: dict, data: dict) -> dict:
    """Fill in keys missing from ``data`` so older save files keep working."""
    out = copy.deepcopy(defaults)
    for key, value in data.items():
        if isinstance(out.get(key), dict) and isinstance(value, dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load(path: str) -> dict:
    with _lock:
        if not os.path.exists(path):
            return copy.deepcopy(DEFAULT_PROFILE)
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                raise ValueError("save file is not an object")
        except (OSError, ValueError):
            # Keep the broken file for inspection and start fresh.
            os.replace(path, path + ".bak")
            return copy.deepcopy(DEFAULT_PROFILE)
        return _merge(DEFAULT_PROFILE, data)


def save(path: str, profile: dict) -> None:
    with _lock:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(profile, fh, indent=2)
        os.replace(tmp, path)


def reset_progress(profile: dict) -> dict:
    """Clear stats and personal bests but keep name, colour and tutorial flag."""
    fresh = copy.deepcopy(DEFAULT_PROFILE)
    fresh["name"] = profile.get("name", fresh["name"])
    fresh["color"] = profile.get("color", fresh["color"])
    fresh["tutorial_done"] = profile.get("tutorial_done", False)
    return fresh
