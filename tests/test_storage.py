import json
import os

from game import storage


def test_missing_file_gives_defaults(save_path):
    assert storage.load(save_path) == storage.DEFAULT_PROFILE


def test_round_trip(save_path):
    p = storage.load(save_path)
    p["name"] = "Zed"
    storage.save(save_path, p)
    assert storage.load(save_path)["name"] == "Zed"


def test_old_save_gets_new_keys(save_path):
    with open(save_path, "w") as fh:
        json.dump({"name": "Old", "stats": {"wins": 3}}, fh)
    p = storage.load(save_path)
    assert p["name"] == "Old"
    assert p["stats"]["wins"] == 3
    assert p["stats"]["shows_played"] == 0
    assert p["personal_best"]["best_score"] == 0


def test_corrupt_file_is_backed_up(save_path):
    with open(save_path, "w") as fh:
        fh.write("{not json")
    assert storage.load(save_path) == storage.DEFAULT_PROFILE
    assert os.path.exists(save_path + ".bak")


def test_reset_keeps_identity():
    p = storage.load("/nonexistent/x.json")
    p.update(name="Kim", color="#5b8cff", tutorial_done=True)
    p["stats"]["wins"] = 4
    fresh = storage.reset_progress(p)
    assert (fresh["name"], fresh["color"], fresh["tutorial_done"]) == ("Kim", "#5b8cff", True)
    assert fresh["stats"]["wins"] == 0
