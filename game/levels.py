"""Level layouts, physics tuning and the show format.

Python is the source of truth for all game data. The browser fetches it from
``/api/levels`` and runs the moment-to-moment simulation with these numbers.

Coordinates are in world pixels. On race courses the start is at the bottom
(large ``y``) and the finish line is near ``y = 0``.
"""
from __future__ import annotations

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
}

PLAYER_COUNT = 12

# Order of rounds in a show and how many players move on from each one.
SHOW = [
    {"level": "spin_sprint", "qualify": 8},
    {"level": "tile_panic", "qualify": 4},
    {"level": "spin_arena", "qualify": 1},
]

PALETTE = [
    "#ff5fa2", "#5b8cff", "#ffd23f", "#3ddc97",
    "#ff8c42", "#b47cff", "#40d9ff", "#ff5757",
    "#a3e635", "#f472b6", "#94a3b8", "#fbbf24",
]

BOT_NAMES = [
    "Wobbles", "Bonk", "Squish", "Pip", "Noodle", "Mochi", "Gumdrop",
    "Zippy", "Blip", "Taffy", "Doodle", "Pogo", "Fizz", "Sprout", "Bubbles",
]


def rect(x: float, y: float, w: float, h: float) -> dict:
    return {"x": x, "y": y, "w": w, "h": h}


SPIN_SPRINT = {
    "id": "spin_sprint",
    "name": "Spin Sprint",
    "type": "race",
    "description": "Dash through spinning bars, leap the gaps, dodge sliding walls "
                   "and bumpers, then cross a wobbly bridge to the finish.",
    "goal": "Reach the finish line before the spots run out.",
    "par_time": 45,
    "time_limit": 150,
    "camera": "follow",
    "bounds": {"w": 720, "h": 4000},
    "theme": {"void": ["#2a1b5e", "#120a2e"], "floorA": "#ffd6e8", "floorB": "#ffc2dc",
              "side": "#c46a9a", "bar": "#ff5757", "bar2": "#ffffff"},
    "floors": [
        rect(60, 3000, 600, 1000),   # start + spinner field
        rect(60, 2760, 600, 160),    # after first gap
        rect(160, 2520, 400, 160),   # narrow island
        rect(60, 1300, 600, 1140),   # sliding walls + bumpers
        rect(280, 700, 160, 600),    # bridge
        rect(60, 0, 600, 700),       # final stretch
    ],
    "spawn": rect(120, 3840, 480, 120),
    "finish_y": 150,
    "checkpoints": [
        {"y": 3060, "spawn_y": 3045, "x": 360, "spread": 200},
        {"y": 2420, "spawn_y": 2400, "x": 360, "spread": 200},
        {"y": 1960, "spawn_y": 1940, "x": 360, "spread": 200},
        {"y": 1290, "spawn_y": 1270, "x": 360, "spread": 40},
        {"y": 690, "spawn_y": 670, "x": 360, "spread": 200},
    ],
    "spinners": [
        {"x": 210, "y": 3500, "arm": 130, "arms": 2, "speed": 1.7, "thick": 16, "hub": 18},
        {"x": 510, "y": 3500, "arm": 130, "arms": 2, "speed": -1.7, "thick": 16, "hub": 18},
        {"x": 360, "y": 3250, "arm": 200, "arms": 2, "speed": 1.3, "thick": 16, "hub": 20},
        {"x": 360, "y": 1150, "arm": 95, "arms": 2, "speed": 2.0, "thick": 14, "hub": 16},
        {"x": 360, "y": 880, "arm": 95, "arms": 2, "speed": -2.3, "thick": 14, "hub": 16},
        {"x": 360, "y": 420, "arm": 250, "arms": 2, "speed": 1.1, "thick": 16, "hub": 22},
    ],
    "sliders": [
        {"x": 360, "y": 2330, "w": 240, "h": 28, "amp": 180, "speed": 1.6, "phase": 0},
        {"x": 360, "y": 2210, "w": 240, "h": 28, "amp": 180, "speed": 2.0, "phase": 2},
        {"x": 360, "y": 2090, "w": 240, "h": 28, "amp": 180, "speed": 1.8, "phase": 4},
    ],
    "bumpers": [
        {"x": 160, "y": 1850, "r": 32}, {"x": 360, "y": 1850, "r": 32}, {"x": 560, "y": 1850, "r": 32},
        {"x": 260, "y": 1700, "r": 32}, {"x": 460, "y": 1700, "r": 32},
        {"x": 160, "y": 1550, "r": 32}, {"x": 360, "y": 1550, "r": 32}, {"x": 560, "y": 1550, "r": 32},
        {"x": 260, "y": 1420, "r": 32}, {"x": 460, "y": 1420, "r": 32},
        {"x": 170, "y": 560, "r": 30}, {"x": 550, "y": 560, "r": 30},
    ],
    # Route hints for computer players (first point above them is their goal).
    "waypoints": [
        {"x": 360, "y": 3020, "spread": 200},
        {"x": 360, "y": 2840, "spread": 200},
        {"x": 360, "y": 2600, "spread": 120},
        {"x": 360, "y": 2440, "spread": 200},
        {"x": 360, "y": 1320, "spread": 50},
        {"x": 360, "y": 700, "spread": 35},
        {"x": 360, "y": 60, "spread": 200},
    ],
}

PRACTICE = {
    "id": "practice",
    "name": "Practice Run",
    "type": "race",
    "description": "A guided course that teaches every move you need.",
    "goal": "Follow the tips and reach the finish line.",
    "par_time": 40,
    "camera": "follow",
    "bounds": {"w": 720, "h": 2600},
    "theme": {"void": ["#123a5e", "#071a2e"], "floorA": "#d6f5ff", "floorB": "#c2ecff",
              "side": "#5a9ec4", "bar": "#ff8c42", "bar2": "#ffffff"},
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
        {"y0": 2300, "y1": 2700, "text": "Move with WASD or the arrow keys. Run up toward the finish!"},
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
    "camera": "fit",
    "bounds": {"w": 700, "h": 700},
    "theme": {"void": ["#1b3a2e", "#07140f"], "floorA": "#b8f5d0", "floorB": "#9be8bd",
              "side": "#3f9a6a", "crack": "#ffb347", "bar": "#ff5757", "bar2": "#ffffff"},
    "tiles": {"x": 0, "y": 0, "cols": 14, "rows": 14, "pitch": 50, "size": 46,
              "crack_time": 1.1, "auto_crack_after": 30, "auto_crack_every": 0.25},
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
    "theme": {"void": ["#3a1b1b", "#140707"], "floorA": "#ffe8b8", "floorB": "#ffd98a",
              "side": "#c48a3f", "bar": "#5b8cff", "bar2": "#ffffff"},
    "arena": {"x": 400, "y": 400, "r": 330, "min_r": 140, "shrink_after": 30, "shrink_rate": 5},
    "spinners": [
        {"x": 400, "y": 400, "arm": 336, "arms": 2, "speed": 0.9, "ramp": 0.035,
         "max_speed": 2.4, "thick": 16, "hub": 26, "follow_arena": True,
         "extra_arms_after": 60},
    ],
}

LEVELS = {lvl["id"]: lvl for lvl in (SPIN_SPRINT, PRACTICE, TILE_PANIC, SPIN_ARENA)}


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


def game_data() -> dict:
    """Everything the browser needs to run the game."""
    return {
        "physics": PHYSICS,
        "levels": LEVELS,
        "show": SHOW,
        "players": PLAYER_COUNT,
        "palette": PALETTE,
        "bot_names": BOT_NAMES,
        "tutorial_level": "practice",
    }
