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


@pytest.mark.parametrize("level", race_levels(), ids=lambda l: l["id"])
def test_race_gaps_can_be_crossed(level):
    # Everything you can stand on: fixed floors plus moving platforms.
    spans = list(level["floors"]) + [
        {"x": m["x"] - m["amp"] - m["w"] / 2, "y": m["y"], "w": m["w"] + 2 * m["amp"], "h": m["h"]}
        for m in level.get("movers", [])
    ] + [
        {"x": d["x"] - d["r"], "y": d["y"] - d["r"], "w": 2 * d["r"], "h": 2 * d["r"]}
        for d in level.get("discs", [])
    ]
    spans.sort(key=lambda f: -f["y"])
    # Allow for the body radius on both edges (centre may stand right at the edge).
    jump = jump_distance() + PHYSICS["radius"]
    dive = dive_jump_distance() + PHYSICS["radius"]
    for lower, upper in zip(spans, spans[1:]):
        gap = lower["y"] - (upper["y"] + upper["h"])
        overlap = min(lower["x"] + lower["w"], upper["x"] + upper["w"]) - max(lower["x"], upper["x"])
        assert overlap > 2 * PHYSICS["radius"], "consecutive floors must line up"
        if gap <= 0:
            continue
        # A bounce pad at the top of the lower floor must throw you onto the upper one.
        pads = [p for p in level.get("pads", [])
                if lower["y"] <= p["y"] <= lower["y"] + 60 and lower["x"] <= p["x"] <= lower["x"] + lower["w"]]
        if pads:
            for p in pads:
                landing = p["y"] + p["h"] / 2 - pad_reach(p)
                assert upper["y"] + 20 < landing < upper["y"] + upper["h"] - 20, f"pad at y={p['y']} misses"
                assert upper["x"] <= p["x"] and p["x"] + p["w"] <= upper["x"] + upper["w"], "pad must point at the floor"
            continue
        assert gap < dive * 0.8, f"gap of {gap}px is too wide"
        if level["id"] != "practice":
            assert gap < jump * 0.8, f"gap of {gap}px needs a dive in a show round"


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
