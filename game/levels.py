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


SPIN_SPRINT = {
    "id": "spin_sprint",
    "name": "Spin Sprint",
    "type": "race",
    "description": "Dash through spinning bars, leap the gaps, dodge sliding walls "
                   "and bumpers, then cross a wobbly bridge to the finish.",
    "goal": "Reach the finish line before the spots run out.",
    "par_time": 60,
    "time_limit": 180,
    # Computer players in this race: overall speed, how often they wait for a
    # spinning bar instead of jumping it, and how often clumsy ones trip.
    "bot_pace": 0.8,
    "bot_hesitation": 0.5,
    "bot_stumble": 0.2,
    "camera": "follow",
    "bounds": {"w": 720, "h": 4000},
    "theme": {"sky": ["#5fb4ff", "#ffe1f0"], "sea": "#ff6fb5",
              "void": ["#2a1b5e", "#120a2e"], "floorA": "#ffd6e8", "floorB": "#ffc2dc",
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
    "theme": {"sky": ["#58c7ff", "#e8fbff"], "sea": "#3fc6ff",
              "void": ["#123a5e", "#071a2e"], "floorA": "#d6f5ff", "floorB": "#c2ecff",
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
              "side": "#3f9a6a", "crack": "#ffb347", "bar": "#ff5757", "bar2": "#ffffff"},
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
              "side": "#c48a3f", "bar": "#5b8cff", "bar2": "#ffffff"},
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

# Computer players on the newer races: a bit slower and clumsier so you get time to recover.
RACE_BOTS = {"bot_pace": 0.66, "bot_hesitation": 0.6, "bot_stumble": 0.3}


def theme(sky, sea, floor_a, floor_b, side, bar="#ff5757"):
    return {"sky": sky, "sea": sea, "void": ["#2a1b5e", "#120a2e"], "floorA": floor_a,
            "floorB": floor_b, "side": side, "bar": bar, "bar2": "#ffffff"}


def cp(y, spread=200, x=360):
    """A checkpoint line at ``y``; you respawn just past it."""
    return {"y": y, "spawn_y": y - 20, "x": x, "spread": spread}


def wp(y, spread=200, x=360):
    """A route hint for computer players."""
    return {"x": x, "y": y, "spread": spread}


def race_level(level_id, name, description, length, theme_, floors, checkpoints, waypoints, **extra):
    level = {
        "id": level_id, "name": name, "type": "race", "description": description,
        "goal": "Reach the finish line before the spots run out.",
        "par_time": 60, "time_limit": 180, "camera": "follow",
        "bounds": {"w": 720, "h": length}, "theme": theme_, "floors": floors,
        "spawn": rect(120, length - 160, 480, 120), "finish_y": 150,
        "checkpoints": checkpoints, "waypoints": waypoints,
        "spinners": [], "sliders": [], "bumpers": [], **RACE_BOTS,
    }
    level.update(extra)
    return level


def pad(x, y, w=160, h=50, speed=330, vz=620):
    """Bounce pad that launches you straight up the course."""
    return {"x": x, "y": y, "w": w, "h": h, "dx": 0, "dy": -1, "speed": speed, "vz": vz}


CONVEYOR_CANYON = race_level(
    "conveyor_canyon", "Conveyor Canyon",
    "Conveyor belts everywhere: pick the lane that carries you forward, fight the "
    "sideways belts and ride the express belt along the narrow bridge.",
    3600, theme(["#6ec3ff", "#fff0d9"], "#ff9f43", "#ffe4c4", "#ffd3a6", "#d98a4a"),
    floors=[rect(60, 2600, 600, 1000), rect(60, 1500, 600, 1020), rect(220, 700, 280, 720), rect(60, 0, 600, 700)],
    checkpoints=[cp(2640), cp(2480), cp(1400, 60), cp(690)],
    waypoints=[wp(3150, 30), wp(2640), wp(2480), wp(1440, 70), wp(700, 60), wp(60)],
    zones=[
        {"type": "conveyor", **rect(60, 2860, 200, 400), "fx": 0, "fy": 120},
        {"type": "conveyor", **rect(260, 2860, 200, 400), "fx": 0, "fy": -110},
        {"type": "conveyor", **rect(460, 2860, 200, 400), "fx": 0, "fy": 120},
        {"type": "conveyor", **rect(60, 2250, 600, 110), "fx": 140, "fy": 0},
        {"type": "conveyor", **rect(60, 1950, 600, 110), "fx": -140, "fy": 0},
        {"type": "conveyor", **rect(60, 1650, 600, 110), "fx": 140, "fy": 0},
        {"type": "conveyor", **rect(220, 760, 280, 640), "fx": 0, "fy": -90},
    ],
    spinners=[
        {"x": 210, "y": 2720, "arm": 130, "arms": 2, "speed": 1.6, "thick": 16, "hub": 18},
        {"x": 510, "y": 2720, "arm": 130, "arms": 2, "speed": -1.6, "thick": 16, "hub": 18},
        {"x": 360, "y": 420, "arm": 240, "arms": 2, "speed": 1.2, "thick": 16, "hub": 22},
    ],
    sliders=[
        {"x": 360, "y": 1200, "w": 120, "h": 26, "amp": 80, "speed": 1.8, "phase": 0},
        {"x": 360, "y": 950, "w": 120, "h": 26, "amp": 80, "speed": 2.2, "phase": 2},
    ],
    bumpers=[{"x": 200, "y": 2100, "r": 30}, {"x": 520, "y": 2100, "r": 30}, {"x": 360, "y": 1800, "r": 30},
             {"x": 200, "y": 1560, "r": 28}, {"x": 520, "y": 1560, "r": 28}],
    bot_pace=0.76,  # tuned so the 8th spot fills after roughly a minute
)

BOUNCE_BAY = race_level(
    "bounce_bay", "Bounce Bay",
    "The gaps are far too wide to jump, so step on the glowing bounce pads and "
    "fly across. Then dodge the sliders and spinners to the finish.",
    3600, theme(["#4fd6c8", "#f0fff9"], "#2ec4b6", "#d4fff4", "#b5f5e6", "#3aa794", "#ff5fa2"),
    floors=[rect(60, 3000, 600, 600), rect(60, 2440, 600, 400), rect(160, 1900, 400, 400),
            rect(60, 1100, 600, 700), rect(60, 0, 600, 1020)],
    checkpoints=[cp(2820), cp(2280, 120), cp(1780), cp(1000)],
    waypoints=[wp(3000, 160), wp(2820), wp(2460, 110), wp(2280, 120), wp(1920, 110), wp(1780), wp(1080), wp(60)],
    pads=[pad(80, 3010), pad(280, 3010), pad(480, 3010),
          pad(180, 2450), pad(380, 2450),
          pad(180, 1910), pad(380, 1910)],
    sliders=[
        {"x": 360, "y": 2620, "w": 200, "h": 26, "amp": 160, "speed": 1.5, "phase": 0},
        {"x": 360, "y": 2540, "w": 200, "h": 26, "amp": 160, "speed": 1.9, "phase": 2.5},
        {"x": 360, "y": 800, "w": 240, "h": 28, "amp": 180, "speed": 1.6, "phase": 0},
        {"x": 360, "y": 650, "w": 240, "h": 28, "amp": 180, "speed": 2.0, "phase": 2},
    ],
    spinners=[
        {"x": 210, "y": 1500, "arm": 130, "arms": 2, "speed": 1.7, "thick": 16, "hub": 18},
        {"x": 510, "y": 1500, "arm": 130, "arms": 2, "speed": -1.7, "thick": 16, "hub": 18},
        {"x": 360, "y": 1250, "arm": 220, "arms": 2, "speed": 1.2, "thick": 16, "hub": 20},
    ],
    bumpers=[{"x": 360, "y": 2000, "r": 30}, {"x": 200, "y": 420, "r": 30}, {"x": 520, "y": 420, "r": 30}],
    bot_pace=0.72,  # tuned so the 8th spot fills after roughly a minute
)

FROSTY_SLOPES = race_level(
    "frosty_slopes", "Frosty Slopes",
    "Slippery ice makes it hard to stop or turn, and giant snowballs come rolling "
    "down the slopes. Keep your balance all the way to the top.",
    3600, theme(["#7cc8ff", "#f4fbff"], "#7fd6ff", "#f2fbff", "#dff2ff", "#7aa9cc", "#5b8cff"),
    floors=[rect(60, 2500, 600, 1100), rect(60, 1400, 600, 1020), rect(60, 0, 600, 1320)],
    checkpoints=[cp(3000), cp(2400), cp(1300), cp(650)],
    waypoints=[wp(2520), wp(2400), wp(1420), wp(1300), wp(60)],
    zones=[
        {"type": "ice", **rect(60, 2550, 600, 600)},
        {"type": "ice", **rect(60, 1450, 600, 500)},
        {"type": "ice", **rect(60, 250, 600, 500)},
    ],
    rollers=[
        {"x0": 100, "x1": 620, "y0": 2560, "y1": 3300, "r": 30, "speed": 170, "every": 0.9},
        {"x0": 100, "x1": 620, "y0": 1450, "y1": 2380, "r": 32, "speed": 200, "every": 0.8},
    ],
    spinners=[
        {"x": 360, "y": 1050, "arm": 220, "arms": 2, "speed": 1.3, "thick": 16, "hub": 20},
        {"x": 210, "y": 820, "arm": 130, "arms": 2, "speed": 1.8, "thick": 16, "hub": 18},
        {"x": 510, "y": 820, "arm": 130, "arms": 2, "speed": -1.8, "thick": 16, "hub": 18},
    ],
    bumpers=[{"x": 200, "y": 450, "r": 30}, {"x": 520, "y": 450, "r": 30}, {"x": 360, "y": 330, "r": 30}],
    bot_pace=0.8,  # tuned so the 8th spot fills after roughly a minute
)

HAMMER_HALL = race_level(
    "hammer_hall", "Hammer Hall",
    "Giant hammers swing across a narrow walkway. Time your run between the "
    "swings, or get knocked flying into the sea.",
    3400, theme(["#9f8cff", "#fbeaff"], "#b47cff", "#efe6ff", "#e0d2ff", "#8a6cc9", "#ffd23f"),
    floors=[rect(60, 2600, 600, 800), rect(200, 1300, 320, 1300), rect(60, 0, 600, 1300)],
    checkpoints=[cp(2580, 100), cp(1900, 100), cp(1280), cp(600)],
    waypoints=[wp(2600, 60), wp(1320, 60), wp(60)],
    pendulums=[
        {"x": 360, "y": 2400, "amp": 190, "speed": 1.6, "phase": 0.0, "r": 34},
        {"x": 360, "y": 2200, "amp": 190, "speed": 1.9, "phase": 1.5, "r": 34},
        {"x": 360, "y": 2000, "amp": 190, "speed": 1.4, "phase": 3.0, "r": 34},
        {"x": 360, "y": 1800, "amp": 190, "speed": 2.1, "phase": 0.7, "r": 34},
        {"x": 360, "y": 1600, "amp": 190, "speed": 1.7, "phase": 2.2, "r": 34},
        {"x": 360, "y": 1450, "amp": 190, "speed": 2.0, "phase": 4.0, "r": 34},
        {"x": 360, "y": 1000, "amp": 260, "speed": 1.3, "phase": 0.0, "r": 38},
        {"x": 360, "y": 750, "amp": 260, "speed": 1.6, "phase": 2.0, "r": 38},
        {"x": 360, "y": 500, "amp": 260, "speed": 1.1, "phase": 4.0, "r": 38},
    ],
    bumpers=[{"x": 180, "y": 300, "r": 30}, {"x": 540, "y": 300, "r": 30}],
)

DRIFT_LIFTS = race_level(
    "drift_lifts", "Drift Lifts",
    "Hop across a chain of sliding platforms over the sea. Wait for each one to "
    "line up, then jump!",
    3400, theme(["#ffc94d", "#fff8e0"], "#ffb347", "#fff4cf", "#ffe9a8", "#d9a441", "#5b8cff"),
    floors=[rect(60, 2900, 600, 500), rect(60, 1300, 600, 740), rect(60, 0, 600, 840)],
    checkpoints=[cp(2020), cp(820)],
    waypoints=[wp(2770, 40), wp(2570, 40), wp(2370, 40), wp(2170, 40), wp(2020), wp(1170, 40), wp(970, 40), wp(820), wp(60)],
    movers=[
        {"x": 360, "y": 2700, "w": 300, "h": 140, "amp": 150, "speed": 0.7, "phase": 0.0},
        {"x": 360, "y": 2500, "w": 300, "h": 140, "amp": 150, "speed": 0.8, "phase": 2.0},
        {"x": 360, "y": 2300, "w": 300, "h": 140, "amp": 150, "speed": 0.6, "phase": 4.0},
        {"x": 360, "y": 2100, "w": 300, "h": 140, "amp": 150, "speed": 0.9, "phase": 1.0},
        {"x": 360, "y": 1100, "w": 320, "h": 140, "amp": 140, "speed": 0.7, "phase": 0.5},
        {"x": 360, "y": 900, "w": 320, "h": 140, "amp": 140, "speed": 0.8, "phase": 2.5},
    ],
    spinners=[{"x": 360, "y": 1650, "arm": 220, "arms": 2, "speed": 1.2, "thick": 16, "hub": 20}],
    sliders=[{"x": 360, "y": 450, "w": 240, "h": 28, "amp": 180, "speed": 1.6, "phase": 0}],
    bumpers=[{"x": 200, "y": 650, "r": 30}, {"x": 520, "y": 650, "r": 30}],
)

GUSTY_GORGE = race_level(
    "gusty_gorge", "Gusty Gorge",
    "Strong gusts switch on and off across a narrow path and windy islands. Lean "
    "into the wind, or wait for it to drop, so you don't get blown away.",
    3400, theme(["#7fb6ff", "#ffeaf4"], "#8fa8ff", "#e8f0ff", "#d6e3ff", "#7088c4", "#ff8c42"),
    floors=[rect(60, 2700, 600, 700), rect(240, 1900, 240, 880), rect(60, 1300, 600, 520),
            rect(160, 900, 400, 320), rect(60, 0, 600, 820)],
    checkpoints=[cp(2680, 60), cp(1800), cp(1200, 120), cp(800)],
    waypoints=[wp(2720, 40), wp(1920, 50), wp(1800), wp(1240, 120), wp(820), wp(60)],
    zones=[
        {"type": "wind", **rect(60, 2450, 600, 220), "fx": 130, "fy": 0, "period": 3.0, "duty": 0.6, "phase": 0.0},
        {"type": "wind", **rect(60, 2150, 600, 220), "fx": -130, "fy": 0, "period": 3.0, "duty": 0.6, "phase": 1.5},
        {"type": "wind", **rect(60, 1350, 600, 400), "fx": 0, "fy": 120, "period": 4.0, "duty": 0.5, "phase": 0.0},
        {"type": "wind", **rect(60, 300, 600, 300), "fx": 140, "fy": 0, "period": 3.0, "duty": 0.5, "phase": 0.7},
    ],
    spinners=[{"x": 360, "y": 600, "arm": 240, "arms": 2, "speed": 1.1, "thick": 16, "hub": 22}],
    bumpers=[{"x": 200, "y": 1550, "r": 30}, {"x": 520, "y": 1550, "r": 30}, {"x": 360, "y": 1450, "r": 30}],
    bot_pace=0.75,  # tuned so the 8th spot fills after roughly a minute
)

TURNTABLE_TRAIL = race_level(
    "turntable_trail", "Turntable Trail",
    "Hop across a chain of spinning discs. Each one carries you round, so aim "
    "ahead of where you want to go.",
    3600, theme(["#ff9ad5", "#fff1f8"], "#ff6fb5", "#ffe0f0", "#ffcce6", "#c4588f", "#5b8cff"),
    floors=[rect(60, 3100, 600, 500), rect(60, 1500, 600, 610), rect(60, 0, 600, 520)],
    checkpoints=[cp(2090), cp(500)],
    waypoints=[wp(2930, 40), wp(2600, 40, 260), wp(2290, 40, 460), wp(2090), wp(1290, 40),
               wp(960, 40, 270), wp(680, 40, 450), wp(500), wp(60)],
    discs=[
        {"x": 360, "y": 2930, "r": 150, "speed": 0.4},
        {"x": 260, "y": 2600, "r": 140, "speed": -0.5},
        {"x": 460, "y": 2290, "r": 140, "speed": 0.5},
        {"x": 360, "y": 1290, "r": 170, "speed": -0.35},
        {"x": 270, "y": 960, "r": 130, "speed": 0.55},
        {"x": 450, "y": 680, "r": 130, "speed": -0.6},
    ],
    spinners=[
        {"x": 210, "y": 1800, "arm": 130, "arms": 2, "speed": 1.6, "thick": 16, "hub": 18},
        {"x": 510, "y": 1800, "arm": 130, "arms": 2, "speed": -1.6, "thick": 16, "hub": 18},
        {"x": 360, "y": 260, "arm": 240, "arms": 2, "speed": 1.1, "thick": 16, "hub": 22},
    ],
    sliders=[{"x": 360, "y": 1600, "w": 240, "h": 28, "amp": 180, "speed": 1.7, "phase": 0}],
    bumpers=[{"x": 360, "y": 1290, "r": 32}],
    bot_pace=0.85,
)

PISTON_PASS = race_level(
    "piston_pass", "Piston Pass",
    "Pistons punch out of the corridor walls and blocks pop up out of the floor. "
    "Read the rhythm and slip through the gaps.",
    3600, theme(["#5ec8ff", "#e9fbff"], "#38bdf8", "#e3f6ff", "#cdeeff", "#4a90b8", "#ff5757"),
    floors=[rect(60, 3200, 600, 400), rect(180, 1900, 360, 1320), rect(60, 1100, 600, 720),
            rect(180, 500, 360, 620), rect(60, 0, 600, 520)],
    checkpoints=[cp(2400, 120), cp(1800), cp(1050, 120), cp(480)],
    waypoints=[wp(3200, 100), wp(1920, 100), wp(1800), wp(1120, 100), wp(500, 100), wp(60)],
    pistons=[
        # x0 = block centre when pulled in; dir = which way it punches.
        {"x0": 120, "y": 3000, "w": 160, "h": 60, "dir": 1, "reach": 200, "period": 2.6, "phase": 0.0},
        {"x0": 600, "y": 2850, "w": 160, "h": 60, "dir": -1, "reach": 200, "period": 2.4, "phase": 0.8},
        {"x0": 120, "y": 2700, "w": 160, "h": 60, "dir": 1, "reach": 200, "period": 2.8, "phase": 1.6},
        {"x0": 600, "y": 2550, "w": 160, "h": 60, "dir": -1, "reach": 200, "period": 2.5, "phase": 0.3},
        {"x0": 120, "y": 2250, "w": 160, "h": 60, "dir": 1, "reach": 200, "period": 2.4, "phase": 1.1},
        {"x0": 600, "y": 2100, "w": 160, "h": 60, "dir": -1, "reach": 200, "period": 2.7, "phase": 2.0},
        {"x0": 120, "y": 1000, "w": 160, "h": 60, "dir": 1, "reach": 170, "period": 2.6, "phase": 0.0},
        {"x0": 600, "y": 1000, "w": 160, "h": 60, "dir": -1, "reach": 170, "period": 2.6, "phase": 1.3},
        {"x0": 120, "y": 760, "w": 160, "h": 60, "dir": 1, "reach": 170, "period": 2.2, "phase": 0.6},
        {"x0": 600, "y": 760, "w": 160, "h": 60, "dir": -1, "reach": 170, "period": 2.2, "phase": 1.7},
    ],
    popups=[
        # Blocks that rise out of the floor for part of each cycle.
        *({"x": x, "y": y, "w": 100, "h": 100, "period": 3.0, "duty": 0.5, "phase": ph}
          for y, ph in ((1650, 0.0), (1450, 1.5), (1250, 0.0))
          for x in (110, 310, 510)),
    ],
    spinners=[{"x": 360, "y": 300, "arm": 240, "arms": 2, "speed": 1.2, "thick": 16, "hub": 22}],
    bot_pace=0.68,
)

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
              "bar": "#ff5757", "bar2": "#ffffff"},
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
    "theme": {"sky": ["#9cc9ff", "#f4fbff"], "sea": "#7fd6ff", "void": ["#1b2a4a", "#070e1f"],
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
    "theme": {"sky": ["#ff8f6b", "#ffe3c4"], "sea": "#ff6b6b", "void": ["#3a1b1b", "#140707"],
              "floorA": "#fff1c4", "floorB": "#ffe08a", "side": "#c48a3f", "bar": "#5b8cff", "bar2": "#ffffff"},
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
    "theme": {"sky": ["#8f7bff", "#ffe6fb"], "sea": "#b46bff", "void": ["#25163f", "#0d0618"],
              "floorA": "#e9e2ff", "floorB": "#d6c9ff", "side": "#7a5cc4", "bar": "#ff5fa2", "bar2": "#ffffff"},
    "arena": {"x": 400, "y": 400, "r": 330, "min_r": 160, "shrink_after": 30, "shrink_rate": 4},
    "spinners": [
        {"x": 290, "y": 400, "arm": 110, "arms": 2, "speed": 1.2, "ramp": 0.02, "max_speed": 3.0, "thick": 16, "hub": 20},
        {"x": 510, "y": 400, "arm": 110, "arms": 2, "speed": -1.2, "ramp": 0.02, "max_speed": 3.0, "thick": 16, "hub": 20},
    ],
    "bumpers": [{"x": x, "y": y, "r": 32, "power": 640}
                for x, y in ((400, 230), (400, 570), (230, 240), (570, 240), (230, 560), (570, 560))],
}

EXTRA_RACES = (CONVEYOR_CANYON, BOUNCE_BAY, FROSTY_SLOPES, HAMMER_HALL, DRIFT_LIFTS, GUSTY_GORGE,
               TURNTABLE_TRAIL, PISTON_PASS)

LEVELS = {lvl["id"]: lvl for lvl in (SPIN_SPRINT, PRACTICE, TILE_PANIC, SPIN_ARENA, *EXTRA_RACES,
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
