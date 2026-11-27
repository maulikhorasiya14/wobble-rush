"""Level layouts, physics tuning and the show format.

Python is the source of truth for all game data. The browser fetches it from
``/api/levels`` and runs the moment-to-moment simulation with these numbers.

Coordinates are in world pixels. On race courses the start is at the bottom
(large ``y``) and the finish line is near ``y = 0``.
"""
from __future__ import annotations

from .courses import RACES

PHYSICS = {
    "radius": 16,          # character body radius
    "max_speed": 230,      # running speed (px/s)
    "ground_accel": 1600,  # how quickly you reach running speed
    "air_accel": 700,      # steering while airborne
    "ground_friction": 9.0,
    "gravity": 1200,
    "jump_speed": 380,     # initial upward speed of a jump
    "dive_speed": 420,     # forward burst of a dive
    "dive_hop": 150,       # small upward boost when diving
    "dive_recover": 0.4,   # seconds lying on the ground after a dive
    "slide_friction": 12.0,  # how quickly a dive slide stops
    "bar_height": 24,      # spinning bars only hit you below this height
    "fall_time": 0.9,      # seconds of falling before respawn / elimination
    "coyote_time": 0.08,   # grace period to still jump just after running off an edge
}

PLAYER_COUNT = 12

# The classic 3-round show (a race, Tile Panic, the final). Random shows are
# built by ``make_show`` from the pool of rounds further down.
SHOW = [
    {"level": "spin_sprint", "qualify": 8},
    {"level": "tile_panic", "qualify": 4},
    {"level": "spin_arena", "qualify": 1},
]

# Twelve colours that are easy to tell apart (no two pinks or two yellows).
PALETTE_NAMES = {
    "#ff5fa2": "Pink", "#5b8cff": "Blue", "#ffd23f": "Yellow", "#3ddc97": "Green",
    "#ff8c42": "Orange", "#b47cff": "Purple", "#40d9ff": "Sky", "#ff5757": "Red",
    "#a3e635": "Lime", "#8d6e63": "Cocoa", "#94a3b8": "Grey", "#f5f5f4": "Snow",
}
PALETTE = list(PALETTE_NAMES)

BOT_NAMES = [
    "Wobbles", "Bonk", "Squish", "Pip", "Noodle", "Mochi", "Gumdrop",
    "Zippy", "Blip", "Taffy", "Doodle", "Pogo", "Fizz", "Sprout", "Bubbles",
    "Jelly", "Wiggle", "Puddle", "Sprinkle", "Boing",
]


def rect(x: float, y: float, w: float, h: float) -> dict:
    return {"x": x, "y": y, "w": w, "h": h}


PRACTICE = {
    "id": "practice",
    "name": "Practice Run",
    "type": "race",
    "description": "A guided course that teaches every move you need.",
    "goal": "Follow the tips and reach the finish line.",
    "par_time": 40,
    "camera": "follow",
    "bounds": {"w": 720, "h": 2600},
    "theme": {"sky": ["#58c7ff", "#e8fbff"], "sea": "#3fc6ff",
              "void": ["#123a5e", "#071a2e"], "floorA": "#d6f5ff", "floorB": "#c2ecff",
              "side": "#5a9ec4", "bar": "#ff8c42", "bar2": "#ffffff", "env": "sky"},
    "floors": [
        rect(160, 2200, 400, 400),
        rect(160, 1800, 400, 320),   # 80 px gap before this: a normal jump clears it
        rect(160, 800, 400, 830),    # 170 px gap before this: needs jump + dive
    ],
    "spawn": rect(340, 2480, 40, 40),
    "finish_y": 950,
    "checkpoints": [
        {"y": 2100, "spawn_y": 2080, "x": 360, "spread": 60},
        {"y": 1610, "spawn_y": 1590, "x": 360, "spread": 60},
    ],
    "spinners": [
        {"x": 360, "y": 1960, "arm": 200, "arms": 2, "speed": 1.2, "thick": 16, "hub": 18},
    ],
    "sliders": [
        {"x": 360, "y": 1500, "w": 180, "h": 28, "amp": 120, "speed": 1.4, "phase": 0},
        {"x": 360, "y": 1400, "w": 180, "h": 28, "amp": 120, "speed": 1.4, "phase": 3.1},
    ],
    "bumpers": [
        {"x": 250, "y": 1220, "r": 30}, {"x": 470, "y": 1220, "r": 30}, {"x": 360, "y": 1090, "r": 30},
    ],
    "tips": [
        {"y0": 2300, "y1": 2700, "text": "Move with WASD and look around with the mouse (click the game to capture it). Run to the finish!",
         "text_2d": "Move with WASD or the arrow keys. Run to the finish!"},
        {"y0": 2150, "y1": 2300, "text": "Gap ahead! Press SPACE to jump across it."},
        {"y0": 2040, "y1": 2150, "text": "Checkpoint! If you fall from here on, you respawn at this line."},
        {"y0": 1870, "y1": 2040, "text": "Spinning bar! JUMP just before it reaches you to hop over it."},
        {"y0": 1780, "y1": 1870, "text": "Huge gap! JUMP, then press SHIFT in mid-air to DIVE and fly further."},
        {"y0": 1450, "y1": 1630, "text": "Moving walls shove you around. Wait for an opening, then go!"},
        {"y0": 1150, "y1": 1450, "text": "Bumpers bounce you away. Steer around them."},
        {"y0": 800, "y1": 1150, "text": "Cross the FINISH line to complete the tutorial!"},
    ],
    "waypoints": [{"x": 360, "y": 900, "spread": 60}],
}

TILE_PANIC = {
    "id": "tile_panic",
    "name": "Tile Panic",
    "type": "tiles",
    "description": "Every tile you step on crumbles a moment later. Keep moving, "
                   "jump over holes and don't fall through.",
    "goal": "Be one of the last players standing.",
    "time_limit": 120,
    "camera": "chase",  # third-person camera behind the player, like the race
    "bounds": {"w": 1560, "h": 1480},
    "theme": {"sky": ["#6fd0ff", "#f4ffe8"], "sea": "#7be06a",
              "void": ["#1b3a2e", "#07140f"], "floorA": "#b8f5d0", "floorB": "#9be8bd",
              "side": "#3f9a6a", "crack": "#ffb347", "bar": "#ff5757", "bar2": "#ffffff", "env": "tropical"},
    # Hexagonal tiles (pointy-top, offset rows) trimmed to a round arena.
    # Same 172-tile layout as before, with every tile twice as big.
    "tiles": {"shape": "hex", "x": 0, "y": 0, "cols": 15, "rows": 17, "pitch": 100, "size": 94,
              "radius": 690, "crack_time": 0.75, "auto_crack_after": 35, "auto_crack_every": 0.4,
              # Player assist: tiles YOU step on take longer to drop.
              "human_crack_time": 1.4},
    # Player assist: falling through gives you another go this many times.
    "human_lives": 2,
    # Computer players here are deliberately clumsy: low skill, slower, and they
    # sometimes zone out on a tile until it drops from under them.
    "bot_skill_max": 0.2,
    "bot_pace": 0.72,
    "bot_dawdle": 0.2,
}

SPIN_ARENA = {
    "id": "spin_arena",
    "name": "Spin Arena",
    "type": "arena",
    "description": "A giant sweeping beam spins faster and faster while the arena "
                   "shrinks. Jump the beam and stay on the platform.",
    "goal": "Be the last one standing to win the crown!",
    "camera": "fit",
    "bounds": {"w": 800, "h": 800},
    "theme": {"sky": ["#ff9a6b", "#ffe7b0"], "sea": "#b46bff",
              "void": ["#3a1b1b", "#140707"], "floorA": "#ffe8b8", "floorB": "#ffd98a",
              "side": "#c48a3f", "bar": "#5b8cff", "bar2": "#ffffff", "env": "candy"},
    "arena": {"x": 400, "y": 400, "r": 330, "min_r": 140, "shrink_after": 30, "shrink_rate": 5},
    "spinners": [
        {"x": 400, "y": 400, "arm": 336, "arms": 2, "speed": 0.9, "ramp": 0.035,
         "max_speed": 2.4, "thick": 16, "hub": 26, "follow_arena": True,
         "extra_arms_after": 60},
    ],
}

# ---------------------------------------------------------------- more races
# Original race courses built from the same pieces, each adding one new
# obstacle type:
#   zones:      conveyor belts / slippery ice / switching gusts of wind
#   pads:       bounce pads that launch you across a gap
#   rollers:    big balls that roll down the course toward you
#   pendulums:  hammers swinging side to side
#   movers:     moving platforms you ride and jump between

METEOR_MEADOW = {
    "id": "meteor_meadow",
    "name": "Meteor Meadow",
    "type": "tiles",
    "description": "Glowing targets light up on the meadow, then meteors smash those "
                   "tiles away. Watch the sky and keep off the targets!",
    "goal": "Stay on the meadow until enough players have fallen.",
    "time_limit": 120,
    "camera": "chase",
    "bounds": {"w": 810, "h": 810},
    "theme": {"sky": ["#ffb36b", "#fff1d6"], "sea": "#5eead4", "void": ["#1b3a2e", "#07140f"],
              "floorA": "#d9f99d", "floorB": "#bef264", "side": "#65a30d", "crack": "#ff5757",
              "bar": "#ff5757", "bar2": "#ffffff", "env": "tropical"},
    "tiles": {"x": 0, "y": 0, "cols": 9, "rows": 9, "pitch": 90, "size": 84,
              "touch_crumble": False, "crack_time": 1.8, "auto_crack_after": 9999, "auto_crack_every": 1,
              "meteors": {"start": 3.0, "every": 2.4, "every_min": 0.8, "ramp": 0.025,
                          "radius": 120, "warn": 1.8, "max_count": 3}},
    "human_lives": 1,
}

BLIZZARD_BLUFF = {
    "id": "blizzard_bluff",
    "name": "Blizzard Bluff",
    "type": "survival",
    "description": "A snowy clifftop in a blizzard. Gusts keep changing direction and "
                   "snowballs roll across. Don't get blown off the edge!",
    "goal": "Stay on the bluff until enough players have fallen.",
    "time_limit": 90,
    "camera": "fit",
    "bounds": {"w": 800, "h": 800},
    # A pale winter sky (not a dark void) with snow blowing on the gusts.
    "theme": {"sky": ["#9cc9ff", "#f4fbff"], "sea": "#7fd6ff", "void": ["#e4f1ff", "#a8c7ea"], "snow": True, "env": "snow",
              "floorA": "#f2fbff", "floorB": "#dff2ff", "side": "#7aa9cc", "bar": "#5b8cff", "bar2": "#ffffff"},
    "arena": {"x": 400, "y": 400, "r": 340, "min_r": 200, "shrink_after": 40, "shrink_rate": 2.5},
    "zones": [{"type": "gust", **rect(0, 0, 800, 800), "base": 70, "ramp": 2.0, "max": 190,
               "period": 5.0, "calm": 1.0, "phase": 0.0}],
    "rollers": [{"x0": 170, "x1": 630, "y0": 40, "y1": 780, "r": 32, "speed": 190, "every": 2.0}],
    "human_lives": 1,
}

CANNON_CLASH = {
    "id": "cannon_clash",
    "name": "Cannon Clash",
    "type": "arena",
    "description": "Cannons around the edge fire giant balls across a shrinking arena, "
                   "faster and faster. Dodge, jump and stay on!",
    "goal": "Be the last one standing to win the crown!",
    "camera": "fit",
    "bounds": {"w": 800, "h": 800},
    "theme": {"sky": ["#ff8f6b", "#ffe3c4"], "sea": "#1fb5d9", "void": ["#3a1b1b", "#140707"],
              "floorA": "#fff1c4", "floorB": "#ffe08a", "side": "#c48a3f", "bar": "#5b8cff", "bar2": "#ffffff",
              "env": "water"},
    "arena": {"x": 400, "y": 400, "r": 330, "min_r": 150, "shrink_after": 35, "shrink_rate": 4},
    "cannons": [
        {"angle": a, "dist": 390, "every": 4.8, "speed": 250, "r": 30, "spread": 160, "phase": 2.0 + i * 0.8,
         "push": 0.55}
        for i, a in enumerate((0, 60, 120, 180, 240, 300))
    ],
    "cannon_ramp": 0.01,
}

PINBALL_PIT = {
    "id": "pinball_pit",
    "name": "Pinball Pit",
    "type": "arena",
    "description": "Super-bouncy bumpers and two spinning bars that keep speeding up, "
                   "on an arena that shrinks. Last one standing wins!",
    "goal": "Be the last one standing to win the crown!",
    "camera": "fit",
    "bounds": {"w": 800, "h": 800},
    "theme": {"sky": ["#140b4a", "#ff6fd8"], "sea": "#2a0f5e", "void": ["#25163f", "#0d0618"],
              "floorA": "#8f7bff", "floorB": "#7a64f0", "side": "#2a1b6e", "bar": "#40d9ff", "bar2": "#ffffff",
              "env": "neon"},
    "arena": {"x": 400, "y": 400, "r": 330, "min_r": 160, "shrink_after": 30, "shrink_rate": 4},
    "spinners": [
        {"x": 290, "y": 400, "arm": 110, "arms": 2, "speed": 1.2, "ramp": 0.02, "max_speed": 3.0, "thick": 16, "hub": 20},
        {"x": 510, "y": 400, "arm": 110, "arms": 2, "speed": -1.2, "ramp": 0.02, "max_speed": 3.0, "thick": 16, "hub": 20},
    ],
    "bumpers": [{"x": x, "y": y, "r": 32, "power": 640}
                for x, y in ((400, 230), (400, 570), (230, 240), (570, 240), (230, 560), (570, 560))],
}

# The twelve races are built section by section in courses.py.
LEVELS = {lvl["id"]: lvl for lvl in (*RACES, PRACTICE, TILE_PANIC, SPIN_ARENA,
                                     METEOR_MEADOW, BLIZZARD_BLUFF, CANNON_CLASH, PINBALL_PIT)}

# ---------------------------------------------------------------- shows
# Where each round can appear in a show, like a TV game show running order:
#   opener - round 1 (races everyone can get going on)
#   middle - rounds between the opener and the final (harder races, survival)
#   final  - the last round, always last one standing
SLOTS = {
    "spin_sprint": ["opener", "middle"],
    "conveyor_canyon": ["opener", "middle"],
    "bounce_bay": ["opener", "middle"],
    "hammer_hall": ["opener", "middle"],
    "turntable_trail": ["middle"],  # too punishing as a first round
    "piston_pass": ["opener", "middle"],
    "lagoon_leap": ["opener", "middle"],
    "neon_nexus": ["middle"],
    "sky_spires": ["middle"],
    "frosty_slopes": ["middle"],
    "drift_lifts": ["middle"],
    "gusty_gorge": ["middle"],
    "tile_panic": ["middle"],
    "meteor_meadow": ["middle"],
    "blizzard_bluff": ["middle"],
    "spin_arena": ["final"],
    "cannon_clash": ["final"],
    "pinball_pit": ["final"],
}
for _id, _slots in SLOTS.items():
    LEVELS[_id]["slots"] = _slots

POOL = {
    slot: [lid for lid, slots in SLOTS.items() if slot in slots] for slot in ("opener", "middle", "final")
}
POOL["race"] = [lid for lid in SLOTS if LEVELS[lid]["type"] == "race"]
POOL["survival"] = [lid for lid in SLOTS if LEVELS[lid]["type"] in ("tiles", "survival")]
# How many players qualify from each round, for each show length.
QUALIFY_BY_LENGTH = {3: [8, 4, 1], 4: [9, 6, 3, 1], 5: [10, 8, 6, 3, 1]}
ROUND_OPTIONS = sorted(QUALIFY_BY_LENGTH)
DEFAULT_ROUNDS = 3

# Multiplayer rooms: up to MAX_ROOM_PLAYERS people share one code. Small groups
# can play shorter shows (a show needs at least rounds + 1 players so someone
# is knocked out every round).
MAX_ROOM_PLAYERS = 20
MP_ROUND_OPTIONS = [1, 2, 3, 4, 5]
MP_BOT_OPTIONS = [0, 12, 20]  # 0 = people only, otherwise fill up with bots to this many


def qualify_counts(rounds: int, players: int) -> list[int]:
    """How many qualify from each round when ``players`` start the show.

    Scales the 12-player table to any group size, always knocks at least one
    player out per round and leaves exactly one winner in the final.
    """
    if rounds < 1 or rounds > max(MP_ROUND_OPTIONS):
        raise ValueError(f"rounds must be one of {MP_ROUND_OPTIONS}")
    if players < rounds + 1:
        raise ValueError(f"a {rounds}-round show needs at least {rounds + 1} players")
    base = QUALIFY_BY_LENGTH.get(rounds) or {1: [1], 2: [6, 1]}[rounds]
    counts = []
    for i, q in enumerate(base):
        want = round(players * q / PLAYER_COUNT)
        lo, hi = rounds - i, players - 1 - i  # room for the rounds still to come
        counts.append(max(lo, min(hi, want)))
    counts[-1] = 1
    for i in range(1, rounds):
        counts[i] = min(counts[i], counts[i - 1] - 1)
    return counts


def jump_distance(physics: dict = PHYSICS) -> float:
    """Horizontal distance covered by a running jump."""
    airtime = 2 * physics["jump_speed"] / physics["gravity"]
    return physics["max_speed"] * airtime


def dive_jump_distance(physics: dict = PHYSICS) -> float:
    """Distance covered by jumping, then diving at the top of the jump."""
    g = physics["gravity"]
    up = physics["jump_speed"] / g
    peak = physics["jump_speed"] ** 2 / (2 * g)
    hop = physics["dive_hop"]
    down = (hop + (hop ** 2 + 2 * g * peak) ** 0.5) / g
    return physics["max_speed"] * up + physics["dive_speed"] * down


def make_show(rounds: int, rng=None, players: int | None = None) -> list[dict]:
    """A random show: an opener, random middle rounds, then a random final.

    No round repeats. Survival rounds only appear in the middle (at most one,
    or two in a 5-round show). ``players`` (multiplayer) scales how many
    qualify per round and allows 1- and 2-round shows.
    """
    import random
    rng = rng or random.Random()
    if players is None:
        if rounds not in QUALIFY_BY_LENGTH:
            raise ValueError(f"rounds must be one of {ROUND_OPTIONS}")
        qualify = QUALIFY_BY_LENGTH[rounds]
    else:
        qualify = qualify_counts(rounds, players)
    if rounds == 1:
        return [{"level": rng.choice(POOL["final"]), "qualify": 1}]
    opener = rng.choice(POOL["opener"])
    races = [lid for lid in POOL["middle"] if lid in POOL["race"] and lid != opener]
    survivals = [lid for lid in POOL["middle"] if lid in POOL["survival"]]
    rng.shuffle(races)
    rng.shuffle(survivals)
    max_survival = 2 if rounds >= 5 else 1
    middle = []
    for _ in range(rounds - 2):
        if survivals and max_survival and rng.random() < 0.5:
            middle.append(survivals.pop())
            max_survival -= 1
        else:
            middle.append(races.pop())
    plan = [opener, *middle, rng.choice(POOL["final"])]
    return [{"level": lvl, "qualify": q} for lvl, q in zip(plan, qualify)]


def game_data() -> dict:
    """Everything the browser needs to run the game."""
    return {
        "physics": PHYSICS,
        "levels": LEVELS,
        "show": SHOW,
        "round_options": ROUND_OPTIONS,
        "default_rounds": DEFAULT_ROUNDS,
        "pool": POOL,
        "players": PLAYER_COUNT,
        "palette": PALETTE,
        "palette_names": PALETTE_NAMES,
        "bot_names": BOT_NAMES,
        "tutorial_level": "practice",
        "multiplayer": {
            "max_players": MAX_ROOM_PLAYERS,
            "round_options": MP_ROUND_OPTIONS,
            "bot_options": MP_BOT_OPTIONS,
        },
    }
