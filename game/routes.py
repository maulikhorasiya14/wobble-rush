"""HTTP routes: the game page plus a small JSON API."""
from __future__ import annotations

import uuid

from flask import Blueprint, current_app, jsonify, make_response, render_template, request

from . import identity, rules, storage
from .levels import LEVELS, PALETTE, ROUND_OPTIONS, game_data, make_show

bp = Blueprint("game", __name__)


def _path() -> str:
    return identity.profile_path()


def _error(message: str, status: int = 400):
    return jsonify({"error": message}), status


@bp.get("/")
def index():
    res = make_response(render_template("index.html"))
    if not identity.is_local() and identity.guest_id() is None:
        # A friend joining over the network: give them their own save file.
        res.set_cookie(identity.GUEST_COOKIE, identity.new_guest_id(),
                       max_age=5 * 365 * 24 * 3600, samesite="Lax")
    return res


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


def _shows() -> dict:
    return current_app.config.setdefault("SHOWS", {})


@bp.post("/api/show")
def new_show():
    """Start a show: pick random rounds for the chosen number of rounds."""
    data = request.get_json(silent=True) or {}
    count = data.get("rounds")
    if count not in ROUND_OPTIONS:
        return _error(f"rounds must be one of {ROUND_OPTIONS}")
    plan = make_show(count)
    shows = _shows()
    while len(shows) >= 50:  # forget abandoned shows
        shows.pop(next(iter(shows)))
    show_id = uuid.uuid4().hex
    shows[show_id] = plan
    return jsonify({"show_id": show_id, "rounds": plan})


@bp.post("/api/round")
def round_done():
    """Save a finished round's personal best straight away (the show may be quit later)."""
    data = request.get_json(silent=True) or {}
    show_id, index = data.get("show_id"), data.get("index")
    plan = _shows().get(show_id) if isinstance(show_id, str) else None
    if plan is None:
        return _error("unknown show")
    if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(plan):
        return _error("index must be a round of the show")
    time, qualified = data.get("time"), data.get("qualified")
    if isinstance(time, bool) or not isinstance(time, (int, float)) or not 0 <= time <= rules.MAX_TIME:
        return _error("time must be a number of seconds")
    if not isinstance(qualified, bool):
        return _error("qualified must be true or false")
    profile = storage.load(_path())
    records = rules.round_records(profile, {"level": plan[index]["level"], "qualified": qualified,
                                            "time": round(float(time), 2)})
    storage.save(_path(), profile)
    return jsonify({"records": records, "profile": profile})


@bp.post("/api/results")
def results():
    data = request.get_json(silent=True) or {}
    show_id = data.get("show_id")
    if show_id is None:
        plan = rules.SHOW  # the classic show
    else:
        plan = _shows().get(show_id) if isinstance(show_id, str) else None
        if plan is None:
            return _error("unknown show")
    try:
        rounds = rules.validate_rounds(data.get("rounds"), plan)
    except ValueError as exc:
        return _error(str(exc))
    if show_id is not None:
        _shows().pop(show_id, None)  # each show can be submitted once
    profile = storage.load(_path())
    score, records = rules.apply_results(profile, rounds, plan)
    storage.save(_path(), profile)
    return jsonify({
        "score": score,
        "won": rules.is_win(rounds, plan),
        "records": records,
        "profile": profile,
        "level_names": {k: v["name"] for k, v in LEVELS.items()},
    })
