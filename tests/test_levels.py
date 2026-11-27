"""Sanity checks on level data so every course is actually playable."""
import random

import pytest

from game.levels import (LEVELS, PHYSICS, PLAYER_COUNT, POOL, ROUND_OPTIONS, SHOW, dive_jump_distance,
                         jump_distance, make_show)


def on_floor(level, x, y):
    return any(f["x"] <= x <= f["x"] + f["w"] and f["y"] <= y <= f["y"] + f["h"]
               for f in level.get("floors", []))


def race_levels():
    return [lvl for lvl in LEVELS.values() if lvl["type"] == "race"]


def test_show_levels_exist():
    for rnd in SHOW:
        assert rnd["level"] in LEVELS
    assert SHOW[-1]["qualify"] == 1
    counts = [r["qualify"] for r in SHOW]
    assert counts == sorted(counts, reverse=True)


@pytest.mark.parametrize("level", race_levels(), ids=lambda l: l["id"])
def test_race_spawn_checkpoints_and_finish_on_floor(level):
    s = level["spawn"]
    for x in (s["x"], s["x"] + s["w"]):
        for y in (s["y"], s["y"] + s["h"]):
            assert on_floor(level, x, y), "spawn area must be on the floor"
    for cp in level["checkpoints"]:
        assert cp["spawn_y"] < cp["y"], "respawn point must be past the checkpoint line"
        for dx in (-cp["spread"], 0, cp["spread"]):
            assert on_floor(level, cp["x"] + dx, cp["spawn_y"])
    assert on_floor(level, level["bounds"]["w"] / 2, level["finish_y"] + 20)


def pad_reach(p):
    """How far a bounce pad throws you."""
    return p["speed"] * 2 * p["vz"] / PHYSICS["gravity"]


def standable(level):
    """Everything you can stand on: fixed floors plus the full sweep of lifts and turntables."""
    return list(level["floors"]) + [
        {"x": m["x"] - m["amp"] - m["w"] / 2, "y": m["y"], "w": m["w"] + 2 * m["amp"], "h": m["h"]}
        for m in level.get("movers", [])
    ] + [
        {"x": d["x"] - d["r"], "y": d["y"] - d["r"], "w": 2 * d["r"], "h": 2 * d["r"]}
        for d in level.get("discs", [])
    ] + [
        {"x": t["x"], "y": t["y"], "w": t["w"], "h": t["h"]} for t in level.get("tilts", [])
    ] + ghost_tiles(level)


def ghost_tiles(level):
    """Every tile of the trust/crumble grids (the real path is picked each round, so
    the test checks that the grid as a whole connects; the game guarantees a path)."""
    out = []
    for g in level.get("ghosts", []):
        cw, rh = g["w"] / g["cols"], g["h"] / g["rows"]
        for r in range(g["rows"]):
            for c in range(g["cols"]):
                out.append({"x": g["x"] + c * cw + g["gap"] / 2, "y": g["y"] + r * rh + g["gap"] / 2,
                            "w": cw - g["gap"], "h": rh - g["gap"]})
    return out


def can_reach(level, lower, upper):
    """Can you get from floor ``lower`` onto ``upper`` (further toward the finish)?"""
    if upper["y"] >= lower["y"]:
        return False
    overlap = min(lower["x"] + lower["w"], upper["x"] + upper["w"]) - max(lower["x"], upper["x"])
    if overlap <= 2 * PHYSICS["radius"]:
        return False
    gap = lower["y"] - (upper["y"] + upper["h"])
    if gap <= 0:
        return True  # touching: walk across
    # A bounce pad at the far edge of the lower floor that lands you on the upper one.
    for p in level.get("pads", []):
        if lower["y"] <= p["y"] <= lower["y"] + 60 and upper["x"] <= p["x"] and p["x"] + p["w"] <= upper["x"] + upper["w"]:
            landing = p["y"] + p["h"] / 2 - pad_reach(p)
            if upper["y"] + 20 < landing < upper["y"] + upper["h"] - 20:
                return True
    jump = jump_distance() + PHYSICS["radius"]
    dive = dive_jump_distance() + PHYSICS["radius"]
    limit = (dive if level["id"] == "practice" else jump) * 0.8
    return gap < limit


@pytest.mark.parametrize("level", race_levels(), ids=lambda l: l["id"])
def test_race_course_can_be_completed(level):
    """There's a route from the start to the finish, and no platform is a dead end."""
    spans = standable(level)
    n = len(spans)
    edges = {i: [j for j in range(n) if i != j and can_reach(level, spans[i], spans[j])] for i in range(n)}
    inside = lambda f, x, y: f["x"] <= x <= f["x"] + f["w"] and f["y"] <= y <= f["y"] + f["h"]
    s = level["spawn"]
    start = next(i for i, f in enumerate(spans) if inside(f, s["x"] + s["w"] / 2, s["y"] + s["h"] / 2))
    goal = next(i for i, f in enumerate(spans) if inside(f, level["bounds"]["w"] / 2, level["finish_y"] + 20))
    seen, todo = {start}, [start]
    while todo:
        for j in edges[todo.pop()]:
            if j not in seen:
                seen.add(j)
                todo.append(j)
    assert goal in seen, "the finish can't be reached from the start"
    assert len(seen) == n, f"unreachable platforms: {[spans[i] for i in range(n) if i not in seen]}"
    # From every platform you can still get to the finish.
    back = {goal}
    changed = True
    while changed:
        changed = False
        for i in range(n):
            if i not in back and any(j in back for j in edges[i]):
                back.add(i)
                changed = True
    assert len(back) == n, f"dead-end platforms: {[spans[i] for i in range(n) if i not in back]}"


@pytest.mark.parametrize("level", race_levels(), ids=lambda l: l["id"])
def test_race_courses_are_long_and_varied(level):
    """Long enough that the finish is hidden in the distance at the start, with many sections."""
    if level["id"] == "practice":
        return
    assert level["spawn"]["y"] - level["finish_y"] > 9000
    assert len(level["sections"]) >= 9
    assert len(set(level["sections"])) >= 7, "a course should mix at least seven kinds of section"
    inner = [n for n in level["sections"] if n not in ("Start", "Finish")]
    assert len(inner) == len(set(inner)), "no section should repeat within a race"
    assert len(level["checkpoints"]) >= 7
    gaps = sorted(a["y"] - b["y"] for a, b in zip(level["checkpoints"], level["checkpoints"][1:]))
    assert gaps[-1] < 2000, "no stretch longer than 2000 px without a checkpoint"


def test_every_round_in_the_pool_exists():
    for kind, ids in POOL.items():
        for level_id in ids:
            assert level_id in LEVELS
    assert len(POOL["race"]) >= 9 and len(POOL["survival"]) >= 3 and len(POOL["final"]) >= 3
    # Openers are races; finals are last-one-standing rounds.
    assert all(LEVELS[i]["type"] == "race" for i in POOL["opener"])
    assert all(LEVELS[i]["type"] == "arena" for i in POOL["final"])


@pytest.mark.parametrize("rounds", ROUND_OPTIONS)
def test_make_show_structure(rounds):
    rng = random.Random(rounds)
    for _ in range(50):
        plan = make_show(rounds, rng)
        levels = [r["level"] for r in plan]
        assert len(plan) == rounds
        assert levels[0] in POOL["opener"]
        assert all(lvl in POOL["middle"] for lvl in levels[1:-1])
        assert levels[-1] in POOL["final"] and plan[-1]["qualify"] == 1
        assert sum(lvl in POOL["survival"] for lvl in levels) <= (2 if rounds >= 5 else 1)
        assert len(set(levels)) == len(levels), "no repeated rounds"
        counts = [PLAYER_COUNT] + [r["qualify"] for r in plan]
        assert counts == sorted(counts, reverse=True) and len(set(counts)) == len(counts)


def test_tutorial_has_a_dive_gap_and_tips():
    practice = LEVELS["practice"]
    floors = sorted(practice["floors"], key=lambda f: -f["y"])
    gaps = [a["y"] - (b["y"] + b["h"]) for a, b in zip(floors, floors[1:])]
    assert max(gaps) > jump_distance(), "tutorial should teach jump + dive"
    assert len(practice["tips"]) >= 5


def test_races_each_have_their_own_character():
    """Section types are spread out: none appears in more than four of the nine races,
    and every race has at least two sections no more than one other race has."""
    from collections import Counter
    races = [lvl for lvl in race_levels() if lvl["id"] != "practice"]
    use = Counter(n for lvl in races for n in set(lvl["sections"]) if n not in ("Start", "Finish"))
    assert max(use.values()) <= 4, use.most_common(3)
    for lvl in races:
        rare = [n for n in set(lvl["sections"]) if use.get(n, 99) <= 2]
        assert len(rare) >= 2, (lvl["id"], rare)


def test_waypoints_ordered_toward_finish():
    for level in race_levels():
        ys = [w["y"] for w in level["waypoints"]]
        assert ys == sorted(ys, reverse=True)


def test_arena_and_tiles_config():
    assert LEVELS["spin_arena"]["arena"]["min_r"] < LEVELS["spin_arena"]["arena"]["r"]
    t = LEVELS["tile_panic"]["tiles"]
    assert t["size"] <= t["pitch"]
    assert t["cols"] * t["pitch"] <= LEVELS["tile_panic"]["bounds"]["w"]


def test_finals_are_varied():
    rng = random.Random(3)
    finals = {make_show(3, rng)[-1]["level"] for _ in range(200)}
    assert finals == set(POOL["final"])
