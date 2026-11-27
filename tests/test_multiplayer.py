"""Room codes, joining, and running a multiplayer show (no real sockets)."""
import json
import random

import pytest

from game import storage
from game.levels import MAX_ROOM_PLAYERS, make_show, qualify_counts
from game.multiplayer import Lobby


class FakeConn:
    """Stands in for a browser connection: records what the server sends."""

    def __init__(self, save_path):
        self.save_path = save_path
        self.id = None
        self.name = "Player"
        self.color = None
        self.room = None
        self.sent = []
        self.secret = "s3cret"
        self.sim = None
        self.owner = None
        self.closed = False

    def send(self, msg, droppable=False, key=None):
        self.sent.append(json.loads(msg) if isinstance(msg, str) else msg)

    def last(self, kind):
        return next(m for m in reversed(self.sent) if m["t"] == kind)

    def kinds(self):
        return [m["t"] for m in self.sent]


@pytest.fixture
def lobby():
    return Lobby(rng=random.Random(1), timers=False)


@pytest.fixture
def conn(tmp_path):
    n = iter(range(1000))
    return lambda: FakeConn(str(tmp_path / f"save{next(n)}.json"))


def say(lobby, c, **msg):
    lobby.handle(c, json.dumps(msg))


def make_room(lobby, conn, people=3, **settings):
    settings.setdefault("bots", 0)
    host = conn()
    say(lobby, host, t="create", name="Host", color="#5b8cff", **settings)
    code = host.last("joined")["code"]
    others = []
    for i in range(people - 1):
        c = conn()
        say(lobby, c, t="join", code=code.lower(), name=f"Friend{i}", color="#ffd23f")
        others.append(c)
    return code, host, others


def test_qualify_counts_scale_with_players():
    assert qualify_counts(3, 12) == [8, 4, 1]
    for players in range(2, MAX_ROOM_PLAYERS + 1):
        for rounds in range(1, 6):
            if players < rounds + 1:
                with pytest.raises(ValueError):
                    qualify_counts(rounds, players)
                continue
            q = qualify_counts(rounds, players)
            assert q[-1] == 1 and q[0] < players
            assert all(a > b for a, b in zip(q, q[1:])), (players, rounds, q)


def test_short_shows_for_small_groups():
    assert [r["qualify"] for r in make_show(2, players=3)] == [2, 1]
    one = make_show(1, players=2)
    assert len(one) == 1 and one[0]["qualify"] == 1


def test_create_and_join_with_code(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn)
    assert len(code) == 4 and code.isalpha()
    room = a.last("room")
    assert [p["name"] for p in room["players"]] == ["Host", "Friend0", "Friend1"]
    assert room["host"] == host.id

    stranger = conn()
    say(lobby, stranger, t="join", code="ZZZZ", name="X")
    assert "No room" in stranger.last("error")["message"]


def test_room_is_capped_at_20(lobby, conn):
    code, host, others = make_room(lobby, conn, people=MAX_ROOM_PLAYERS)
    assert len(host.last("room")["players"]) == MAX_ROOM_PLAYERS
    late = conn()
    say(lobby, late, t="join", code=code, name="Late")
    assert "full" in late.last("error")["message"]


def test_duplicate_names_get_a_number(lobby, conn):
    code, host, _ = make_room(lobby, conn, people=1)
    twin = conn()
    say(lobby, twin, t="join", code=code, name="Host")
    assert twin.name == "Host 2"


def test_only_host_changes_settings_and_starts(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn)
    say(lobby, a, t="settings", rounds=1)
    say(lobby, a, t="start")
    assert host.last("room")["rounds"] == 3
    assert "round" not in a.kinds()
    say(lobby, host, t="start")  # 3 people can't play 3 rounds
    assert "at least 4" in host.last("error")["message"]
    say(lobby, host, t="settings", rounds=2)
    say(lobby, host, t="start")
    assert a.last("round")["qualify"] == 2


def test_new_rooms_fill_with_bots_by_default(lobby, conn):
    host = conn()
    say(lobby, host, t="create", name="Host")
    assert host.last("room")["bots"] == 12


def test_bots_fill_the_show(lobby, conn):
    code, host, others = make_room(lobby, conn, people=2, rounds=3, bots=12)
    say(lobby, host, t="start")
    rnd = host.last("round")
    assert len(rnd["roster"]) == 12
    assert sum(r["isHuman"] for r in rnd["roster"]) == 2


def test_states_go_to_host_and_snapshots_to_everyone(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn, rounds=2)
    say(lobby, host, t="start")
    say(lobby, a, t="state", s=[1.5, 2, "x", True], ev=[{"type": "jump", "x": 3, "y": 4}, {"type": "hack"}])
    got = host.last("state")
    assert got == {"t": "state", "id": a.id, "at": None, "s": [1.5, 2, 0, 0], "ev": [{"type": "jump", "x": 3, "y": 4}]}
    say(lobby, a, t="snap", i=0)  # only the host may send snapshots
    assert "snap" not in b.kinds()
    say(lobby, host, t="snap", i=0, b=[])
    assert b.last("snap")["i"] == 0 and "snap" not in host.kinds()


def play_round(lobby, host, qualified, results):
    rnd = host.last("round")
    say(lobby, host, t="round_end", index=rnd["index"], qualified=qualified, results=results)
    lobby.advance(host.room.code)


def test_full_show_ends_with_a_winner_and_saves_stats(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn, rounds=2)
    say(lobby, host, t="start")
    first = host.last("round")
    race = first["level"]
    # Round 1: host and a qualify, b is out.
    play_round(lobby, host, [host.id, a.id], {
        host.id: {"time": 40.5, "place": 1}, a.id: {"time": 44.0, "place": 2}, b.id: {"time": 60, "place": None},
    })
    result = b.last("round_result")
    assert result["results"][b.id]["qualified"] is False and result["done"] is False
    final = b.last("round")  # b still gets the next round, to watch
    assert final["index"] == 1 and {r["id"] for r in final["roster"]} == {host.id, a.id}
    # Final: a wins.
    play_round(lobby, host, [a.id], {host.id: {"time": 20.0, "place": 2}, a.id: {"time": 25.0, "place": 1}})
    assert host.last("round_result")["done"] is True
    lobby.advance(code)
    over = a.last("show_over")
    assert over["you"]["won"] is True and [w["id"] for w in over["winners"]] == [a.id]
    assert [s["id"] for s in over["standings"]][0] == a.id
    assert host.last("show_over")["you"]["won"] is False
    assert a.last("room")["phase"] == "lobby"

    saved = storage.load(a.save_path)
    assert saved["stats"]["wins"] == 1 and saved["stats"]["shows_played"] == 1
    assert saved["personal_best"]["levels"][race]["best_time"] == 44.0
    assert storage.load(b.save_path)["stats"]["shows_played"] == 1


def test_host_leaving_mid_round_hands_over_and_restarts(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn, rounds=2)
    say(lobby, host, t="start")
    lobby.disconnect(host)
    rnd = a.last("round")
    assert rnd["host"] == a.id and rnd["index"] == 0
    assert host.id not in {r["id"] for r in rnd["roster"]}
    assert a.last("room")["host"] == a.id


def test_player_leaving_mid_round_is_dropped_by_host(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn, rounds=2)
    say(lobby, host, t="start")
    lobby.disconnect(b)
    assert host.last("left") == {"t": "left", "id": b.id}


def test_everyone_else_leaving_ends_the_show(lobby, conn):
    code, host, (a,) = make_room(lobby, conn, people=2, rounds=1)
    say(lobby, host, t="start")
    lobby.disconnect(host)
    over = a.last("show_over")
    assert [w["id"] for w in over["winners"]] == [a.id]


def test_empty_room_is_removed(lobby, conn):
    code, host, (a,) = make_room(lobby, conn, people=2)
    lobby.disconnect(a)
    lobby.disconnect(host)
    assert code not in lobby.rooms


def test_late_joiner_watches_the_current_round(lobby, conn):
    code, host, (a,) = make_room(lobby, conn, people=2, rounds=1)
    say(lobby, host, t="start")
    late = conn()
    say(lobby, late, t="join", code=code, name="Late")
    assert late.last("round")["index"] == 0
    assert late.id not in {r["id"] for r in late.last("round")["roster"]}


def test_silent_players_are_dropped(lobby, conn):
    code, host, (a,) = make_room(lobby, conn, people=2)
    host.last_seen = a.last_seen = 100.0
    say(lobby, host, t="ping")  # host is still there
    host.last_seen = 200.0
    assert lobby.reap(now=230.0) == [a]  # a silent for 130 s
    assert [p["id"] for p in host.last("room")["players"]] == [host.id]


def test_joiners_get_a_free_colour(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn)  # Friend0 and Friend1 both asked for yellow
    colours = [p["color"] for p in host.last("room")["players"]]
    assert len(set(colours)) == 3
    assert b.last("joined")["color"] == b.color != "#ffd23f"
    assert "different one" in b.last("notice")["message"]


def test_players_who_left_are_marked_in_standings(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn, rounds=2)
    say(lobby, host, t="start")
    play_round(lobby, host, [host.id, a.id, b.id][:2], {})
    lobby.disconnect(b)
    play_round(lobby, host, [a.id], {})
    lobby.advance(code)
    standings = {s["id"]: s for s in a.last("show_over")["standings"]}
    assert standings[b.id]["left"] is True and standings[a.id]["won"] is True


def test_host_game_worker_attaches_and_runs_the_round(lobby, conn):
    code, host, (a, b) = make_room(lobby, conn, rounds=2)
    worker = conn()
    say(lobby, worker, t="attach", id=host.id, secret="wrong")
    assert worker.last("error") and host.sim is None
    say(lobby, worker, t="attach", id=host.id, secret=host.secret)
    assert worker.last("attached") and host.sim is worker
    say(lobby, host, t="start")
    # Reports go straight to the worker, with their timestamp.
    say(lobby, a, t="state", at=12.5, s=[1, 2], ev=[])
    assert worker.last("state")["at"] == 12.5 and "state" not in host.kinds()
    # The worker's snapshots reach everyone, the host's page included.
    say(lobby, worker, t="snap", i=0, b=[])
    assert host.last("snap") and a.last("snap") and b.last("snap")
    # Its round result counts as the host's.
    say(lobby, worker, t="round_end", index=0, qualified=[host.id, a.id], results={})
    assert a.last("round_result")["qualified"] == [host.id, a.id]
    # Players leaving are reported to the worker; the worker going away detaches it.
    lobby.advance(code)
    lobby.disconnect(b)
    lobby.disconnect(worker)
    assert host.sim is None and host.room is not None
