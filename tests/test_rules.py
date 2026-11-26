import copy

import pytest

from game import rules, storage


def full_win():
    return [
        {"level": "spin_sprint", "qualified": True, "time": 30.0, "place": 1},
        {"level": "tile_panic", "qualified": True, "time": 40.0, "place": None},
        {"level": "spin_arena", "qualified": True, "time": 25.0, "place": 1},
    ]


def test_validate_accepts_win_and_early_exit():
    assert len(rules.validate_rounds(full_win())) == 3
    out = rules.validate_rounds([{"level": "spin_sprint", "qualified": False, "time": 150, "place": None}])
    assert out[0]["qualified"] is False


@pytest.mark.parametrize("bad", [
    None,
    [],
    [{"level": "tile_panic", "qualified": False, "time": 3, "place": None}],          # wrong order
    [{"level": "spin_sprint", "qualified": True, "time": 3, "place": 1}],            # unfinished show
    [{"level": "spin_sprint", "qualified": "yes", "time": 3, "place": 1}],
    [{"level": "spin_sprint", "qualified": False, "time": -1, "place": None}],
    [{"level": "spin_sprint", "qualified": False, "time": True, "place": None}],
    [{"level": "spin_sprint", "qualified": False, "time": 9, "place": 0}],
    full_win() + [full_win()[0]],
])
def test_validate_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        rules.validate_rounds(bad)


def test_win_scores_more_than_early_exit():
    win = rules.score_show(full_win())
    out = rules.score_show([{"level": "spin_sprint", "qualified": False, "time": 150, "place": None}])
    assert win > 1000 > out


def test_faster_race_scores_higher():
    fast = rules.round_score(0, {"level": "spin_sprint", "qualified": True, "time": 25, "place": 1})
    slow = rules.round_score(0, {"level": "spin_sprint", "qualified": True, "time": 44, "place": 8})
    assert fast > slow


def test_apply_results_updates_personal_bests():
    profile = copy.deepcopy(storage.DEFAULT_PROFILE)
    score, records = rules.apply_results(profile, full_win())
    assert profile["stats"] == {"shows_played": 1, "wins": 1, "rounds_qualified": 3}
    assert profile["personal_best"]["best_score"] == score
    assert profile["personal_best"]["levels"]["spin_sprint"]["best_time"] == 30.0
    labels = {r["label"] for r in records}
    assert {"First crown!", "Best show score", "Furthest round"} <= labels

    # A worse run sets no new records.
    worse = full_win()
    worse[0] = {**worse[0], "time": 40.0, "place": 5}
    worse[1] = {**worse[1], "time": 10.0}
    worse[2] = {**worse[2], "time": 5.0}
    _, records = rules.apply_results(profile, worse)
    assert records == []
    assert profile["personal_best"]["levels"]["spin_sprint"]["best_time"] == 30.0
    assert profile["stats"]["wins"] == 2


def test_race_time_ignored_when_not_qualified():
    profile = copy.deepcopy(storage.DEFAULT_PROFILE)
    rules.apply_results(profile, [{"level": "spin_sprint", "qualified": False, "time": 5.0, "place": None}])
    assert "spin_sprint" not in profile["personal_best"]["levels"]


def test_survival_longer_is_better():
    profile = copy.deepcopy(storage.DEFAULT_PROFILE)
    assert rules.update_level_best(profile, "tile_panic", 10)
    assert not rules.update_level_best(profile, "tile_panic", 8)
    assert rules.update_level_best(profile, "tile_panic", 12)
