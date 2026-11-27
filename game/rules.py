"""Scoring and personal-best rules for a finished show."""
from __future__ import annotations

from .levels import LEVELS, SHOW

MAX_TIME = 600.0


def validate_rounds(raw, plan: list[dict] = SHOW) -> list[dict]:
    """Check the round results sent by the browser against the show that was played."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= len(plan):
        raise ValueError("rounds must be a list with one entry per round played")
    rounds = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError("each round must be an object")
        expected = plan[i]["level"]
        if item.get("level") != expected:
            raise ValueError(f"round {i + 1} must be {expected!r}")
        qualified = item.get("qualified")
        if not isinstance(qualified, bool):
            raise ValueError("qualified must be true or false")
        time = item.get("time")
        if isinstance(time, bool) or not isinstance(time, (int, float)) or not 0 <= time <= MAX_TIME:
            raise ValueError("time must be a number of seconds")
        place = item.get("place")
        if place is not None and (isinstance(place, bool) or not isinstance(place, int) or not 1 <= place <= 100):
            raise ValueError("place must be a positive whole number or null")
        if qualified is False and i != len(raw) - 1:
            raise ValueError("a show ends at the first round you are eliminated in")
        rounds.append({"level": expected, "qualified": qualified,
                       "time": round(float(time), 2), "place": place})
    if rounds[-1]["qualified"] and len(rounds) < len(plan):
        raise ValueError("show is not finished")
    return rounds


def round_score(index: int, result: dict, plan: list[dict] = SHOW) -> int:
    level = LEVELS[result["level"]]
    cfg = plan[index]
    final = index == len(plan) - 1
    if level["type"] == "race":
        if not result["qualified"]:
            return 20
        place = result["place"] or cfg["qualify"]
        place_bonus = max(0, cfg["qualify"] - place + 1) * 15
        time_bonus = max(0, int((level.get("par_time", 90) - result["time"]) * 3))
        return 100 + place_bonus + time_bonus
    survived = int(result["time"])
    if not result["qualified"]:
        return survived
    return (650 if final else 150) + survived


def score_show(rounds: list[dict], plan: list[dict] = SHOW) -> int:
    return sum(round_score(i, r, plan) for i, r in enumerate(rounds))


def is_win(rounds: list[dict], plan: list[dict] = SHOW) -> bool:
    return len(rounds) == len(plan) and rounds[-1]["qualified"]


def apply_results(profile: dict, rounds: list[dict], plan: list[dict] = SHOW) -> tuple[int, list[dict]]:
    """Update stats and personal bests in place. Returns (score, new records)."""
    score = score_show(rounds, plan)
    won = is_win(rounds, plan)
    stats = profile["stats"]
    pb = profile["personal_best"]
    records: list[dict] = []

    stats["shows_played"] += 1
    stats["rounds_qualified"] += sum(r["qualified"] for r in rounds)
    if won:
        stats["wins"] += 1
        if stats["wins"] == 1:
            records.append({"label": "First crown!", "value": "You won a show"})

    if score > pb["best_score"]:
        pb["best_score"] = score
        records.append({"label": "Best show score", "value": str(score)})

    reached = len(rounds)
    # Going out in round 1 isn't worth celebrating, even on a first show.
    if reached > pb["furthest_round"] and (reached > 1 or won):
        pb["furthest_round"] = reached
        label = f"Won a {len(plan)}-round show" if won else f"Reached round {reached}"
        records.append({"label": "Furthest round", "value": label})

    for r in rounds:
        records += round_records(profile, r)

    return score, records


def round_records(profile: dict, r: dict) -> list[dict]:
    """Personal best for one finished round (saved as soon as the round ends)."""
    level = LEVELS[r["level"]]
    if level["type"] == "race" and not r["qualified"]:
        return []
    if not update_level_best(profile, r["level"], r["time"]):
        return []
    what = "best time" if level["type"] == "race" else "longest survival"
    return [{"label": f"{level['name']} {what}", "value": f"{r['time']:.2f}s"}]


def update_level_best(profile: dict, level_id: str, time: float) -> bool:
    """Race levels: lower time is better. Survival levels: longer is better."""
    level = LEVELS[level_id]
    levels = profile["personal_best"]["levels"]
    old = levels.get(level_id, {}).get("best_time")
    lower_is_better = level["type"] == "race"
    if old is None or (time < old if lower_is_better else time > old):
        levels[level_id] = {"best_time": round(time, 2)}
        return True
    return False
