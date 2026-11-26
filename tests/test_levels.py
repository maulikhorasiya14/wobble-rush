"""Sanity checks on level data so every course is actually playable."""
import pytest

from game.levels import LEVELS, PHYSICS, SHOW, dive_jump_distance, jump_distance


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


@pytest.mark.parametrize("level", race_levels(), ids=lambda l: l["id"])
def test_race_gaps_can_be_crossed(level):
    floors = sorted(level["floors"], key=lambda f: -f["y"])
    # Allow for the body radius on both edges (centre may stand right at the edge).
    jump = jump_distance() + PHYSICS["radius"]
    dive = dive_jump_distance() + PHYSICS["radius"]
    for lower, upper in zip(floors, floors[1:]):
        gap = lower["y"] - (upper["y"] + upper["h"])
        overlap = min(lower["x"] + lower["w"], upper["x"] + upper["w"]) - max(lower["x"], upper["x"])
        assert overlap > 2 * PHYSICS["radius"], "consecutive floors must line up"
        if gap > 0:
            assert gap < dive * 0.8, f"gap of {gap}px is too wide"
            if level["id"] != "practice":
                assert gap < jump * 0.8, f"gap of {gap}px needs a dive in a show round"


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
