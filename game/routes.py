"""HTTP routes: the game page plus a small JSON API."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, render_template, request

from . import rules, storage
from .levels import LEVELS, PALETTE, game_data

bp = Blueprint("game", __name__)


def _path() -> str:
    return current_app.config["SAVE_PATH"]


def _error(message: str, status: int = 400):
    return jsonify({"error": message}), status


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/api/levels")
def levels():
    return jsonify(game_data())


@bp.get("/api/profile")
def get_profile():
    return jsonify(storage.load(_path()))


@bp.post("/api/profile")
def update_profile():
    data = request.get_json(silent=True) or {}
    profile = storage.load(_path())
    if "name" in data:
        name = data["name"]
        if not isinstance(name, str):
            return _error("name must be text")
        name = " ".join(name.split())[:16]
        if not name or not name.isprintable():
            return _error("name must be 1-16 printable characters")
        profile["name"] = name
    if "color" in data:
        if data["color"] not in PALETTE:
            return _error("unknown colour")
        profile["color"] = data["color"]
    storage.save(_path(), profile)
    return jsonify(profile)


@bp.post("/api/profile/tutorial")
def tutorial_done():
    data = request.get_json(silent=True) or {}
    time = data.get("time")
    if isinstance(time, bool) or not isinstance(time, (int, float)) or not 0 < time <= rules.MAX_TIME:
        return _error("time must be a number of seconds")
    profile = storage.load(_path())
    profile["tutorial_done"] = True
    new_best = rules.update_level_best(profile, "practice", float(time))
    storage.save(_path(), profile)
    return jsonify({"profile": profile, "new_best": new_best})


@bp.post("/api/profile/reset")
def reset():
    profile = storage.reset_progress(storage.load(_path()))
    storage.save(_path(), profile)
    return jsonify(profile)


@bp.post("/api/results")
def results():
    data = request.get_json(silent=True) or {}
    try:
        rounds = rules.validate_rounds(data.get("rounds"))
    except ValueError as exc:
        return _error(str(exc))
    profile = storage.load(_path())
    score, records = rules.apply_results(profile, rounds)
    storage.save(_path(), profile)
    return jsonify({
        "score": score,
        "won": rounds[-1]["qualified"] and len(rounds) == len(rules.SHOW),
        "records": records,
        "profile": profile,
        "level_names": {k: v["name"] for k, v in LEVELS.items()},
    })
