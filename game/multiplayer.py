"""Multiplayer rooms: friends type the same room code and race each other.

The Python server keeps track of rooms and runs the show (which rounds, who
is still in, who won). The moment-to-moment game runs in the browsers: each
player moves their own character in their own browser (so it responds
instantly) and reports where it is ("state"); the room host's browser runs
the rest of the round (bots, obstacles, the rules) in a background worker and
sends back what everyone should see ("snapshots").

    player browser --state--> server --state--> host browser (runs the round)
    player browser <--snap--- server <--snap--- host browser

If the host leaves, the next player in the room becomes host and the current
round starts again.
"""
from __future__ import annotations

import json
import random
import threading
import time
import uuid
from collections import deque

from . import rules, storage
from .levels import (BOT_NAMES, LEVELS, MAX_ROOM_PLAYERS, MP_BOT_OPTIONS, MP_ROUND_OPTIONS,
                     PALETTE, make_show)

CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # no I or O: easy to read out loud
CODE_LEN = 4
MAX_ROOMS = 100
INTRO_SECONDS = 5      # round intro card before the 3-2-1 countdown
RESULT_SECONDS = 6     # result card between rounds
STATE_EVENTS = {"jump", "dive", "land", "hit", "pad", "fall", "respawn", "bump"}
ROUND_TIMEOUT = rules.MAX_TIME + 60  # give up on a round the host never finishes
IDLE_TIMEOUT = 120     # browsers send a heartbeat every few seconds; silent ones are dropped
                       # (generous: background tabs may only get to send one a minute)


def clean_name(raw) -> str | None:
    if not isinstance(raw, str):
        return None
    name = " ".join(raw.split())[:16]
    return name if name and name.isprintable() else None


class Conn:
    """One connected browser. Messages are queued and sent from a background
    thread so a slow connection never holds up the rest of the room."""

    MAX_SNAPS = 3  # queued snapshots beyond this are dropped (only the newest matter)

    def __init__(self, send_text, save_path: str):
        self._send_text = send_text
        self.save_path = save_path
        self.id: str | None = None
        self.name = "Player"
        self.color = PALETTE[0]
        self.room: Room | None = None
        self.closed = False
        self.last_seen = time.monotonic()
        self._q: deque[list] = deque()  # [text, droppable, key]
        self._cv = threading.Condition()
        # This thread is the only one that writes to the socket: the socket
        # compresses messages, and two writers at once would garble them.
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def send(self, msg, droppable: bool = False, key: str | None = None) -> None:
        """Queue a message. ``droppable`` snapshots may be skipped on a slow
        connection; a message with a ``key`` replaces a queued one with the same key."""
        text = msg if isinstance(msg, str) else json.dumps(msg, separators=(",", ":"))
        with self._cv:
            if self.closed:
                return
            if key is not None:
                for item in self._q:
                    if item[2] == key:
                        item[0] = text
                        return
            if droppable and sum(1 for item in self._q if item[1]) >= self.MAX_SNAPS:
                for item in self._q:
                    if item[1]:
                        self._q.remove(item)
                        break
            self._q.append([text, droppable, key])
            self._cv.notify()

    def _run(self) -> None:
        while True:
            with self._cv:
                while not self._q and not self.closed:
                    self._cv.wait()
                if self.closed:
                    return
                text = self._q.popleft()[0]
            try:
                self._send_text(text)
            except Exception:  # connection gone; the receive loop cleans up
                self.close()
                return

    def close(self, wait: bool = False) -> None:
        with self._cv:
            self.closed = True
            self._cv.notify()
        if wait and threading.current_thread() is not self._thread:
            self._thread.join(timeout=2)


class Room:
    def __init__(self, code: str, host: Conn):
        self.code = code
        self.host = host
        self.players: list[Conn] = []
        self.phase = "lobby"      # lobby | round | result
        self.rounds = 3
        self.bots = 12            # fill up to this many players with bots (0 = off)
        self.plan: list[dict] = []
        self.index = 0
        self.roster: list[dict] = []   # everyone still in the show (people and bots)
        self.results: dict[str, list[dict]] = {}  # person id -> their round results
        self.names: dict[str, dict] = {}          # person id -> {name, color} for standings
        self.records: dict[str, list] = {}        # person id -> round records already saved
        self.round_msg: dict | None = None
        self.gen = 0              # bumps whenever the show moves on; stale timers check it
        self.timer: threading.Timer | None = None
        self.pending = None       # (gen, fn) waiting on the timer

    def people(self) -> list[dict]:
        return [{"id": p.id, "name": p.name, "color": p.color} for p in self.players]

    def state(self) -> dict:
        return {
            "t": "room", "code": self.code, "host": self.host.id, "phase": self.phase,
            "rounds": self.rounds, "bots": self.bots, "players": self.people(),
            "max": MAX_ROOM_PLAYERS, "round": self.index if self.phase != "lobby" else None,
        }

    def broadcast(self, msg, skip: Conn | None = None, droppable: bool = False) -> None:
        text = msg if isinstance(msg, str) else json.dumps(msg, separators=(",", ":"))
        for p in self.players:
            if p is not skip:
                p.send(text, droppable)


class Lobby:
    """All rooms on this server. Every method runs under one lock."""

    def __init__(self, rng: random.Random | None = None, timers: bool = True):
        self.rooms: dict[str, Room] = {}
        self.lock = threading.RLock()
        self.rng = rng or random.Random()
        self.use_timers = timers  # tests turn timers off and call advance() instead

    # ------------------------------------------------------------ messages

    def handle(self, conn: Conn, text: str) -> None:
        try:
            msg = json.loads(text)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return
        kind = msg.get("t")
        conn.last_seen = time.monotonic()
        with self.lock:
            if kind == "snap":
                self._snap(conn, text)
            elif kind == "state":
                self._state(conn, msg)
            elif kind == "create":
                self._create(conn, msg)
            elif kind == "join":
                self._join(conn, msg)
            elif kind == "settings":
                self._settings(conn, msg)
            elif kind == "start":
                self._start(conn)
            elif kind == "round_end":
                self._round_end(conn, msg)
            elif kind == "leave":
                self.disconnect(conn)
            elif kind == "ping":
                conn.send({"t": "pong", "at": msg.get("at")})

    def _error(self, conn: Conn, message: str) -> None:
        conn.send({"t": "error", "message": message})

    def _profile(self, conn: Conn, msg: dict) -> None:
        conn.name = clean_name(msg.get("name")) or "Player"
        conn.color = msg.get("color") if msg.get("color") in PALETTE else PALETTE[0]

    def _create(self, conn: Conn, msg: dict) -> None:
        if conn.room:
            return self._error(conn, "You're already in a room.")
        if len(self.rooms) >= MAX_ROOMS:
            return self._error(conn, "This server has too many rooms open right now.")
        code = self._new_code()
        room = Room(code, conn)
        if msg.get("rounds") in MP_ROUND_OPTIONS:
            room.rounds = msg["rounds"]
        if msg.get("bots") in MP_BOT_OPTIONS:
            room.bots = msg["bots"]
        self.rooms[code] = room
        self._profile(conn, msg)
        self._add(room, conn)

    def _join(self, conn: Conn, msg: dict) -> None:
        if conn.room:
            return self._error(conn, "You're already in a room.")
        code = msg.get("code")
        code = "".join(code.split()).upper() if isinstance(code, str) else ""
        room = self.rooms.get(code)
        if not room:
            return self._error(conn, f"No room with code {code or '?'}. Check the code and try again.")
        if len(room.players) >= MAX_ROOM_PLAYERS:
            return self._error(conn, f"Room {code} is full ({MAX_ROOM_PLAYERS} players).")
        self._profile(conn, msg)
        self._add(room, conn)
        if room.phase != "lobby":
            # Joined mid-show: watch until it ends, then play the next one.
            conn.send({"t": "notice", "message": "A show is in progress: you can watch and join the next one."})
            if room.phase == "round" and room.round_msg:
                conn.send(room.round_msg)

    def _add(self, room: Room, conn: Conn) -> None:
        wanted = conn.color
        taken = {p.name for p in room.players}
        base, n = conn.name, 2
        while conn.name in taken:
            conn.name = f"{base[:13]} {n}"
            n += 1
        # Same colour as someone already here? Use a free one so players can tell each other apart.
        used = [p.color for p in room.players]
        if conn.color in used:
            free = [c for c in PALETTE if c not in used]
            conn.color = free[0] if free else min(PALETTE, key=used.count)
        conn.id = "p" + uuid.uuid4().hex[:8]
        conn.room = room
        room.players.append(conn)
        conn.send({"t": "joined", "you": conn.id, "code": room.code, "color": conn.color,
                   "intro": INTRO_SECONDS, "result": RESULT_SECONDS})
        if conn.color != wanted:
            conn.send({"t": "notice", "message": "Someone in this room already has your colour, so you've been given a different one."})
        room.broadcast(room.state())

    def _new_code(self) -> str:
        while True:
            code = "".join(self.rng.choice(CODE_CHARS) for _ in range(CODE_LEN))
            if code not in self.rooms:
                return code

    def _settings(self, conn: Conn, msg: dict) -> None:
        room = conn.room
        if not room or room.host is not conn or room.phase != "lobby":
            return
        if msg.get("rounds") in MP_ROUND_OPTIONS:
            room.rounds = msg["rounds"]
        if msg.get("bots") in MP_BOT_OPTIONS:
            room.bots = msg["bots"]
        room.broadcast(room.state())

    # ------------------------------------------------------------ the show

    def _start(self, conn: Conn) -> None:
        room = conn.room
        if not room or room.host is not conn:
            return
        if room.phase != "lobby":
            return self._error(conn, "A show is already running.")
        people = room.players[:MAX_ROOM_PLAYERS]
        n_bots = max(0, room.bots - len(people))
        total = len(people) + n_bots
        if total < room.rounds + 1:
            need = room.rounds + 1
            return self._error(conn, f"A {room.rounds}-round show needs at least {need} players. "
                                     "Invite more friends, add bots or pick fewer rounds.")
        room.plan = make_show(room.rounds, self.rng, players=total)
        room.roster = [{"id": p.id, "name": p.name, "color": p.color, "isHuman": True} for p in people]
        room.roster += self._bots(n_bots, {p.color for p in people})
        room.results = {p.id: [] for p in people}
        room.records = {}
        room.names = {p.id: {"name": p.name, "color": p.color} for p in people}
        room.index = 0
        self._start_round(room)

    def _bots(self, n: int, used_colors: set[str]) -> list[dict]:
        names = BOT_NAMES[:]
        self.rng.shuffle(names)
        colors = [c for c in PALETTE if c not in used_colors] or PALETTE[:]
        bots = []
        for i in range(n):
            name = names[i % len(names)] + ("" if i < len(names) else f" {i // len(names) + 1}")
            bots.append({"id": f"bot{i}", "name": name, "color": colors[i % len(colors)],
                         "isHuman": False, "skill": round(0.2 + self.rng.random() * 0.65, 3)})
        return bots

    def _start_round(self, room: Room) -> None:
        self._cancel(room)
        people = [r for r in room.roster if r["isHuman"]]
        if not people or len(room.roster) <= 1:
            return self._show_over(room)
        cfg = room.plan[room.index]
        qualify = max(1, min(cfg["qualify"], len(room.roster) - 1))
        room.phase = "round"
        room.round_msg = {
            "t": "round", "index": room.index, "total": len(room.plan), "level": cfg["level"],
            "qualify": qualify, "final": room.index == len(room.plan) - 1,
            "roster": room.roster, "host": room.host.id, "intro": INTRO_SECONDS,
        }
        room.broadcast(room.round_msg)
        self._later(room, INTRO_SECONDS + ROUND_TIMEOUT, self._round_timeout)

    def _round_timeout(self, room: Room) -> None:
        if room.phase == "round":
            room.broadcast({"t": "notice", "message": "The round got stuck, so the show has ended."})
            room.roster = []
            self._show_over(room)

    def _snap(self, conn: Conn, text: str) -> None:
        room = conn.room
        if room and room.host is conn and room.phase == "round":
            room.broadcast(text, skip=conn, droppable=True)

    def _state(self, conn: Conn, msg: dict) -> None:
        """A player reports where their character is; pass it to the host's game."""
        room = conn.room
        if not room or room.phase != "round":
            return
        if not any(r["id"] == conn.id for r in room.roster):
            return
        row = msg.get("s")
        if not isinstance(row, list) or len(row) > 24:
            return
        row = [v if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e7 else 0 for v in row]
        events = []
        for e in msg.get("ev") or []:
            if isinstance(e, dict) and e.get("type") in STATE_EVENTS and len(events) < 12:
                events.append({k: e[k] for k in ("type", "x", "y", "dx", "dy")
                               if k in e and (k == "type" or isinstance(e[k], (int, float)))})
        # Only the newest report matters (unless it carries effects like a jump).
        room.host.send({"t": "state", "id": conn.id, "s": row, "ev": events},
                       key=None if events else "state:" + conn.id)

    def _round_end(self, conn: Conn, msg: dict) -> None:
        room = conn.room
        if not room or room.host is not conn or room.phase != "round" or msg.get("index") != room.index:
            return
        ids = {r["id"] for r in room.roster}
        qualified = msg.get("qualified")
        if not isinstance(qualified, list):
            return
        qualified = [q for q in qualified if q in ids]
        raw = msg.get("results") if isinstance(msg.get("results"), dict) else {}
        cfg = room.plan[room.index]
        results = {}
        for r in room.roster:
            if not r["isHuman"]:
                continue
            got = raw.get(r["id"]) if isinstance(raw.get(r["id"]), dict) else {}
            time = got.get("time")
            time = min(rules.MAX_TIME, max(0.0, float(time))) if isinstance(time, (int, float)) and not isinstance(time, bool) else 0.0
            place = got.get("place")
            place = place if isinstance(place, int) and not isinstance(place, bool) and 1 <= place <= 100 else None
            res = {"level": cfg["level"], "qualified": r["id"] in qualified, "time": round(time, 2), "place": place}
            room.results.setdefault(r["id"], []).append(res)
            results[r["id"]] = {k: res[k] for k in ("qualified", "time", "place")}
            player = next((p for p in room.players if p.id == r["id"]), None)
            if player:  # keep round bests even if they leave before the show ends
                room.records.setdefault(r["id"], []).extend(self._save_round(player, res))
        room.roster = [r for r in room.roster if r["id"] in qualified]
        last = room.index == len(room.plan) - 1
        done = last or len(room.roster) <= 1 or not any(r["isHuman"] for r in room.roster)
        room.phase = "result"
        room.round_msg = None
        room.broadcast({"t": "round_result", "index": room.index, "qualified": qualified,
                        "results": results, "done": done, "next_in": RESULT_SECONDS})
        self._later(room, RESULT_SECONDS, self._next)

    def _next(self, room: Room) -> None:
        if room.phase != "result":
            return
        last = room.index == len(room.plan) - 1
        if last or len(room.roster) <= 1 or not any(r["isHuman"] for r in room.roster):
            return self._show_over(room)
        room.index += 1
        self._start_round(room)

    def _show_over(self, room: Room) -> None:
        self._cancel(room)
        winners = room.roster if len(room.roster) <= 1 or room.index == len(room.plan) - 1 else []
        winner_ids = {w["id"] for w in winners}
        here = {p.id for p in room.players}
        standings = []
        for pid, res in room.results.items():
            standings.append({"id": pid, **room.names.get(pid, {"name": "?", "color": PALETTE[0]}),
                              "reached": len(res), "won": pid in winner_ids, "left": pid not in here})
        standings.sort(key=lambda s: (not s["won"], s["left"], -s["reached"]))
        base = {"t": "show_over", "winners": winners, "standings": standings}
        for p in room.players:
            mine = room.results.get(p.id)
            you = {"played": mine is not None}
            if mine:
                you.update(self._save(p, mine, room.plan, p.id in winner_ids))
                you["records"] = room.records.get(p.id, []) + you["records"]
            p.send({**base, "you": you})
        room.phase = "lobby"
        room.plan, room.roster, room.results, room.round_msg = [], [], {}, None
        room.index = 0
        room.broadcast(room.state())

    def _save_round(self, conn: Conn, res: dict) -> list[dict]:
        try:
            profile = storage.load(conn.save_path)
            records = rules.round_records(profile, res)
            if records:
                storage.save(conn.save_path, profile)
            return records
        except OSError:
            return []

    def _save(self, conn: Conn, rounds: list[dict], plan: list[dict], won: bool) -> dict:
        """Add a finished show to this player's own stats and personal bests."""
        out = {"won": won, "reached": len(rounds), "score": rules.score_show(rounds, plan), "records": []}
        try:
            checked = rules.validate_rounds(rounds, plan)
        except ValueError:
            return out  # show cut short (everyone else left): nothing to save
        try:
            profile = storage.load(conn.save_path)
            out["score"], out["records"] = rules.apply_results(profile, checked, plan)
            storage.save(conn.save_path, profile)
            out["profile"] = profile
        except OSError:
            pass
        return out

    # ------------------------------------------------------------ leaving

    def disconnect(self, conn: Conn) -> None:
        with self.lock:
            room = conn.room
            if not room:
                return
            conn.room = None
            if conn in room.players:
                room.players.remove(conn)
            if not room.players:
                self._cancel(room)
                self.rooms.pop(room.code, None)
                return
            was_host = room.host is conn
            if was_host:
                room.host = room.players[0]
            in_round = any(r["id"] == conn.id for r in room.roster)
            room.roster = [r for r in room.roster if r["id"] != conn.id]
            room.broadcast(room.state())
            if room.phase == "round":
                if was_host:
                    room.broadcast({"t": "notice", "message": f"The host left. {room.host.name} is the new host: restarting the round."})
                    self._start_round(room)
                elif in_round:
                    room.host.send({"t": "left", "id": conn.id})
            elif room.phase == "lobby" and was_host:
                room.broadcast({"t": "notice", "message": f"{room.host.name} is the new host."})

    # ------------------------------------------------------------ timers

    def _later(self, room: Room, seconds: float, fn) -> None:
        self._cancel(room)
        room.gen += 1
        gen = room.gen
        room.pending = (gen, fn)
        if not self.use_timers:
            return

        def fire():
            with self.lock:
                if room.gen == gen and self.rooms.get(room.code) is room:
                    room.pending = None
                    fn(room)

        room.timer = threading.Timer(seconds, fire)
        room.timer.daemon = True
        room.timer.start()

    def _cancel(self, room: Room) -> None:
        if room.timer:
            room.timer.cancel()
            room.timer = None
        room.pending = None

    def reap(self, now: float | None = None) -> list[Conn]:
        """Drop players whose browser has gone silent (lost Wi-Fi, laptop closed)."""
        now = time.monotonic() if now is None else now
        with self.lock:
            idle = [p for room in list(self.rooms.values()) for p in room.players
                    if now - getattr(p, "last_seen", now) > IDLE_TIMEOUT]
            for p in idle:
                self.disconnect(p)
        return idle

    def advance(self, code: str) -> None:
        """Tests: run the room's pending timer now."""
        with self.lock:
            room = self.rooms[code]
            pending = getattr(room, "pending", None)
            if pending:
                room.pending = None
                pending[1](room)


def init_multiplayer(app) -> Lobby:
    """Add the /ws endpoint that browsers connect to for multiplayer."""
    from flask_sock import ConnectionClosed, Sock

    from . import identity

    # No library pings: they'd be written from another thread (see Conn). The
    # browser sends its own heartbeat instead and reap() drops silent ones.
    app.config.setdefault("SOCK_SERVER_OPTIONS", {"ping_interval": None, "max_message_size": 1 << 20})
    lobby = Lobby()
    app.extensions["wobble_lobby"] = lobby
    sock = Sock(app)
    sockets: dict[Conn, object] = {}

    def reaper():
        while True:
            time.sleep(5)
            for conn in lobby.reap():
                conn.close(wait=True)
                ws = sockets.get(conn)
                try:
                    ws.close()
                except Exception:
                    pass

    threading.Thread(target=reaper, daemon=True, name="wobble-reaper").start()

    @sock.route("/ws")
    def ws_endpoint(ws):
        conn = Conn(ws.send, identity.profile_path())
        sockets[conn] = ws
        try:
            while True:
                data = ws.receive()
                if isinstance(data, str):
                    lobby.handle(conn, data)
        except ConnectionClosed:
            pass
        finally:
            sockets.pop(conn, None)
            lobby.disconnect(conn)
            conn.close(wait=True)  # stop writing before flask-sock closes the socket

    return lobby
