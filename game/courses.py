"""Race courses, built from a library of sections.

Each race is a chain of sections (a spinner field, a zig-zag of platforms,
a hammer walkway...) laid end to end from the start line. Courses are long
(roughly 9,500-11,000 px) so the finish is far beyond the fog at the start,
and every section starts with a checkpoint, so a fall only costs you that
section.

Sections are written in "distance from the start" (``d``), which grows
toward the finish; ``Course.build`` turns that into the game's coordinates,
where the start is at the bottom (large ``y``) and the finish near ``y = 0``.
"""
from __future__ import annotations

W = 720          # course width (the floor runs from x=60 to x=660)
LEFT, WIDE, MID = 60, 600, 360
GAP = 72         # a running-jump gap: easy for players (a jump covers ~145 px), and
                 # still within reach of the slower computer players (~90 px)


# The look of each world (the 3D renderer builds the scenery around it):
#   tropical - palm-tree islands floating over a turquoise sea
#   snow     - snowy peaks, pine trees and falling snow
#   candy    - lollipops, donuts and gumdrops on a pink sea
#   sky      - high above the clouds, with hot-air balloons
#   water    - out at sea among boats, buoys and sandy islands
#   future   - a high-tech city with glowing pylons and holo rings
#   neon     - a night-time arena of glowing colours
ENVS = ("tropical", "snow", "candy", "sky", "water", "future", "neon")


def theme(sky, sea, floor_a, floor_b, side, bar="#ff5757", env="tropical", **extra):
    return {"sky": sky, "sea": sea, "void": ["#2a1b5e", "#120a2e"], "floorA": floor_a,
            "floorB": floor_b, "side": side, "bar": bar, "bar2": "#ffffff", "env": env, **extra}


class Course:
    """Collects a course's pieces in distance-from-start coordinates."""

    KINDS = ("floors", "zones", "pads", "popups", "movers", "spinners", "sliders", "bumpers",
             "pendulums", "pistons", "discs", "rollers", "doors", "ghosts", "tilts", "logs", "cannons",
             "hammers", "blinks", "bouncers")

    def __init__(self):
        self.d = 0
        self.parts = {k: [] for k in self.KINDS}
        self.cps, self.wps = [], []
        self.spawn = None
        self.finish_d = None
        self.sections: list[str] = []
        self.kinds: list[str] = []     # which section builder made each section
        self.spans: list[tuple] = []   # (section name, start d, end d)
        self.open_gap = False   # the last section ended in a gap (no floor at c.d)
        self.wide_end = True    # the last floor spans the full width

    # ---- pieces (d0 = the start-side edge, d = a centre line)
    def floor(self, x, d0, w, h):
        self.parts["floors"].append(("rect", x, d0, w, h, {}))

    def rect_item(self, part, x, d0, w, h, **extra):
        self.parts[part].append(("rect", x, d0, w, h, extra))

    def point_item(self, part, d, **fields):
        self.parts[part].append(("point", d, fields))

    def checkpoint(self, d, spread=200, x=MID):
        """A checkpoint line at distance d; you respawn just past it."""
        self.cps.append((d, spread, x))

    def waypoint(self, d, spread=200, x=MID, lanes=None):
        """A route hint for computer players (``lanes``: separate lanes, each bot keeps to one)."""
        self.wps.append((d, spread, x, lanes))

    def build(self, level_id, name, description, theme_, **extra) -> dict:
        L = self.d

        def rect(x, d0, w, h):
            return {"x": x, "y": L - d0 - h, "w": w, "h": h}

        level = {
            "id": level_id, "name": name, "type": "race", "description": description,
            "goal": "Reach the finish line before the spots run out.",
            "par_time": 120, "time_limit": 300, "camera": "follow",
            "bounds": {"w": W, "h": L}, "theme": theme_,
            "spawn": rect(*self.spawn), "finish_y": L - self.finish_d,
            "checkpoints": [{"y": L - d, "spawn_y": L - d - 20, "x": x, "spread": s}
                            for d, s, x in sorted(self.cps)],
            "waypoints": [{"x": x, "y": L - d, "spread": s, **({"lanes": list(ln)} if ln else {})}
                          for d, s, x, ln in sorted(self.wps, key=lambda w: w[0])],
            "sections": self.sections,
            "section_kinds": self.kinds,
            # Where each section lies (y range), for the progress bar and testing.
            "section_spans": [{"name": n, "y0": L - d1, "y1": L - d0} for n, d0, d1 in self.spans],
            "bot_pace": 0.8, "bot_hesitation": 0.55, "bot_stumble": 0.25,
        }
        for kind, items in self.parts.items():
            out = []
            for item in items:
                if item[0] == "rect":
                    _, x, d0, w, h, ex = item
                    out.append({**rect(x, d0, w, h), **ex})
                else:
                    _, d, fields = item
                    f = dict(fields)
                    if kind in ("rollers", "logs"):   # a lane from d (near end) to d + f.pop("len")
                        ln = f.pop("len")
                        f["y0"], f["y1"] = L - d - ln, L - d
                    else:
                        f["y"] = L - d
                    out.append(f)
            level[kind] = out
        level.update(extra)
        # Slower bots can't jump the gaps (a jump only carries as far as you run).
        level["bot_pace"] = max(0.75, level["bot_pace"])
        return level


# ----------------------------------------------------------------- sections
# Each takes the course (and options), starts at c.d and moves c.d forward.

def landing(c, length=200):
    """A short full-width floor with a checkpoint, so the next part has solid ground behind it."""
    c.floor(LEFT, c.d, WIDE, length)
    c.checkpoint(c.d + 40)
    c.waypoint(c.d + length - 20)
    c.d += length


def section(name, needs="floor", ends="floor"):
    """``needs``: "floor" = starts on its own floor right at c.d; "ground" = needs
    a floor (any width) ending at c.d to jump or walk from; "wide" = needs a
    full-width floor ending at c.d. ``ends``: "floor" or "gap"."""
    def wrap(fn):
        def run(c, *a, **k):
            if needs != "floor" and (c.open_gap or (needs == "wide" and not c.wide_end)):
                landing(c)
            title = k.pop("title", name)   # a harder variant can go by its own name
            c.sections.append(title)
            c.kinds.append(fn.__name__)
            d0 = c.d
            fn(c, *a, **k)
            c.spans.append((title, d0, c.d))
            c.open_gap = ends == "gap"
            c.wide_end = ends == "floor" and needs == "floor" and fn.__name__ not in NARROW_ENDS
        run.__name__ = fn.__name__
        return run
    return wrap


# Sections whose last floor is narrower than the full course.
NARROW_ENDS = {"spin_bridge", "beam_walk", "hammer_bridge", "split_path", "express_bridge", "hammer_walk", "wind_path", "piston_corridor",
               "cannon_alley"}


@section("Start")
def start(c, length=520):
    c.floor(LEFT, c.d, WIDE, length)
    c.spawn = (120, c.d + 40, 480, 120)
    c.d += length
    c.waypoint(c.d - 20)


@section("Finish")
def finish(c, length=560):
    """A clear run-in to the finish line: each race's last real challenge comes just before it."""
    c.checkpoint(c.d + 40)
    c.floor(LEFT, c.d, WIDE, length)
    c.finish_d = c.d + length - 150
    c.waypoint(c.d + length - 90)
    c.d += length


@section("Spinner field")
def spinner_field(c, length=720, speed=1.7, big=True):
    c.checkpoint(c.d + 40)
    c.floor(LEFT, c.d, WIDE, length)
    c.point_item("spinners", c.d + 230, x=210, arm=130, arms=2, speed=speed, thick=16, hub=18)
    c.point_item("spinners", c.d + 230, x=510, arm=130, arms=2, speed=-speed, thick=16, hub=18)
    if big:
        c.point_item("spinners", c.d + 500, x=MID, arm=210, arms=2, speed=speed * 0.75, thick=16, hub=20)
    c.d += length
    c.waypoint(c.d - 20)


@section("Island hops", needs="ground", ends="gap")
def islands(c, n=2, narrow=True):
    for i in range(n):
        c.d += GAP + (i % 2) * 6
        w = 400 if narrow and i % 2 else WIDE
        x = MID - w / 2
        c.floor(x, c.d, w, 170)
        if i == 0:
            c.checkpoint(c.d + 40, spread=min(200, w / 2 - 30))
        c.waypoint(c.d + 85, spread=w / 2 - 60)
        c.d += 170
    c.d += GAP


@section("Sliding walls")
def sliders(c, n=3, length=None, speed=1.7, ice=False):
    length = length or 160 + n * 130
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for i in range(n):
        c.point_item("sliders", c.d + 120 + i * 130, x=MID, w=240, h=28, amp=180,
                     speed=speed + 0.25 * ((i * 7) % 3), phase=i * 2.1)
    if ice:
        c.rect_item("zones", LEFT, c.d + 60, WIDE, length - 120, type="ice")
    c.d += length
    c.waypoint(c.d - 20)


@section("Bumper maze")
def bumpers(c, rows=5, wind=False):
    length = 140 + rows * 130
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for r in range(rows):
        xs = (160, 360, 560) if r % 2 == 0 else (260, 460)
        for x in xs:
            c.point_item("bumpers", c.d + 110 + r * 130, x=x, r=32)
    if wind:
        c.rect_item("zones", LEFT, c.d + 60, WIDE, length - 120, type="wind", fx=0, fy=110,
                    period=3.5, duty=0.5, phase=0.0)
    c.d += length
    c.waypoint(c.d - 20)


@section("Spinner bridge", needs="wide")
def spin_bridge(c, length=660, speed=2.1):
    c.checkpoint(c.d - 30)  # on the full-width floor just before
    c.floor(280, c.d, 160, length)
    c.waypoint(c.d + 30, spread=35)
    c.point_item("spinners", c.d + 200, x=MID, arm=95, arms=2, speed=speed, thick=14, hub=16)
    c.point_item("spinners", c.d + 460, x=MID, arm=95, arms=2, speed=-speed * 1.1, thick=14, hub=16)
    c.d += length
    c.waypoint(c.d - 10, spread=35)


@section("Zig-zag platforms", needs="ground", ends="gap")
def zigzag(c, n=5, length=230, ice=False):
    xs = [LEFT, 220, 380, 220]
    for i in range(n):
        c.d += GAP
        x = xs[i % len(xs)]
        c.floor(x, c.d, 280, length)
        if ice:
            c.rect_item("zones", x, c.d + 20, 280, length - 40, type="ice")
        if i == 0:
            c.checkpoint(c.d + 30, spread=100, x=x + 140)
        c.waypoint(c.d + 40, spread=60, x=x + 140)
        # Line up with where the next platform overlaps this one before jumping.
        if i < n - 1:
            nx = xs[(i + 1) % len(xs)]
            c.waypoint(c.d + length - 30, spread=20, x=(max(x, nx) + min(x, nx) + 280) / 2)
        c.d += length
    c.d += GAP


@section("Stepping stones", needs="wide", ends="gap")
def stones(c, rows=4):
    patterns = [(160, 360, 560), (260, 460)]
    for r in range(rows):
        c.d += GAP
        for x in patterns[r % 2]:
            c.floor(x - 90, c.d, 180, 160)
        if r == 0:
            c.checkpoint(c.d + 40, spread=0, x=360)
        # The stones of each row overlap the next row's around x = 400 (and 320).
        c.waypoint(c.d + 80, spread=15, x=400 if r % 2 == 0 else 410)
        c.d += 160
    c.d += GAP


@section("Split path", needs="wide")
def split_path(c, length=960, speed=1.6):
    """Pick a route: a narrow shortcut plank swept by hammers (quick if you time it),
    or a wider road with sliding blocks and bumpers (safer, but slower)."""
    c.checkpoint(c.d - 30)  # on the full-width floor just before
    # Left: the daredevil plank, with two hammers swinging right across it.
    c.floor(LEFT, c.d, 130, length)
    for i in range(2):
        c.point_item("pendulums", c.d + 300 + i * 360, x=LEFT + 65, amp=85, speed=1.5 + 0.35 * i,
                     phase=i * 1.9, r=30)
    # Right: the safe road. Blocks slide across it but stay on it, so nothing hangs over the sea.
    road_x, road_w = 340, 320
    c.floor(road_x, c.d, road_w, length)
    for i in range(3):
        c.point_item("sliders", c.d + 190 + i * 250, x=road_x + road_w / 2, w=110, h=26, amp=(road_w - 110) / 2 - 6,
                     speed=speed + 0.3 * i, phase=i * 1.7)
        c.point_item("bumpers", c.d + 315 + i * 250, x=road_x + 70 if i % 2 else road_x + road_w - 70, r=26)
    # Computer players mostly take the safe road (each picks a lane within it).
    c.waypoint(c.d + 40, spread=90, x=road_x + road_w / 2)
    c.waypoint(c.d + length - 40, spread=90, x=road_x + road_w / 2)
    c.d += length


@section("Conveyor lanes")
def conveyor_lanes(c, length=520, flip=False):
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for i, x in enumerate((60, 260, 460)):
        forward = (i % 2 == 1) != flip
        c.rect_item("zones", x, c.d + 60, 200, length - 120, type="conveyor", fx=0, fy=-110 if forward else 120)
    c.d += length
    c.waypoint(c.d - 20, spread=60, x=360 if not flip else 160)


@section("Cross belts")
def conveyor_cross(c, strips=3):
    length = 120 + strips * 170
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for i in range(strips):
        c.rect_item("zones", LEFT, c.d + 80 + i * 170, WIDE, 110, type="conveyor", fx=140 if i % 2 == 0 else -140, fy=0)
        c.point_item("bumpers", c.d + 165 + i * 170, x=200 if i % 2 else 520, r=28)
    c.d += length
    c.waypoint(c.d - 20)


@section("Express bridge", needs="wide")
def express_bridge(c, length=740):
    c.checkpoint(c.d - 30)  # on the full-width floor just before
    c.floor(220, c.d, 280, length)
    c.rect_item("zones", 220, c.d + 60, 280, length - 120, type="conveyor", fx=0, fy=-90)
    c.point_item("sliders", c.d + 260, x=MID, w=120, h=26, amp=80, speed=1.8, phase=0)
    c.point_item("sliders", c.d + 510, x=MID, w=120, h=26, amp=80, speed=2.2, phase=2)
    c.waypoint(c.d + 30, spread=70)
    c.d += length
    c.waypoint(c.d - 10, spread=60)


def _pad(c, x, d_far, w=160):
    # A pad at the far edge of a floor: throws you ~340 px up the course.
    c.rect_item("pads", x, d_far - 55, w, 50, dx=0, dy=-1, speed=330, vz=620)


@section("Bounce pads")
def pad_jump(c, launch=280, land=320, width=WIDE):
    x = MID - width / 2
    c.checkpoint(c.d + 30, spread=min(200, width / 2 - 40))
    c.floor(x, c.d, width, launch)
    c.d += launch
    for px in range(int(x) + 20, int(x + width) - 159, 200):
        _pad(c, px, c.d)
    c.waypoint(c.d - 30, spread=width / 2 - 60)
    c.d += 220
    c.floor(x, c.d, width, land)
    c.waypoint(c.d + land / 2, spread=width / 2 - 60)
    c.d += land


@section("Bounce chain")
def bounce_chain(c, hops=3):
    """Pad after pad onto ever-narrower islands."""
    widths = [WIDE, 440, 400, 440, WIDE]
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, 260)
    c.d += 260
    for i in range(hops):
        w_next = widths[i + 1]
        zone = min(widths[i], w_next)   # pads only where they land on the next island
        x0 = MID - zone / 2
        for px in range(int(x0) + 20, int(x0 + zone) - 159, 200):
            _pad(c, px, c.d)
        c.waypoint(c.d - 30, spread=zone / 2 - 90)
        c.d += 220
        c.floor(MID - w_next / 2, c.d, w_next, 300)
        c.waypoint(c.d + 150, spread=w_next / 2 - 60)
        c.d += 300


@section("Snowball slope")
def ice_rollers(c, length=820, every=0.9, speed=180):
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    c.rect_item("zones", LEFT, c.d + 60, WIDE, length - 140, type="ice")
    c.point_item("rollers", c.d + 50, x0=100, x1=620, len=length - 120, r=31, speed=speed, every=every)
    c.d += length
    c.waypoint(c.d - 20)


@section("Hammer walk", needs="wide")
def hammer_walk(c, n=5, amp=190):
    length = 150 + n * 200
    c.checkpoint(c.d - 30)  # on the full-width floor just before
    c.floor(200, c.d, 320, length)
    c.waypoint(c.d + 20, spread=60)
    for i in range(n):
        c.point_item("pendulums", c.d + 120 + i * 200, x=MID, amp=amp, speed=1.4 + 0.18 * ((i * 5) % 4),
                     phase=i * 1.45, r=34)
    c.d += length
    c.waypoint(c.d - 10, spread=60)


@section("Giant hammers")
def big_hammers(c, n=3):
    length = 200 + n * 250
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for i in range(n):
        c.point_item("pendulums", c.d + 160 + i * 250, x=MID, amp=260, speed=1.1 + 0.25 * i, phase=i * 2.0, r=38)
    c.d += length
    c.waypoint(c.d - 20)


@section("Drifting lifts", needs="wide", ends="gap")
def lift_chain(c, n=4, speed=0.75, w=300):
    c.checkpoint(c.d - 40)  # on the full-width floor before the lifts
    c.d += 60
    for i in range(n):
        # Lifts slide sideways by amp; _fix_movers turns x into their centre.
        c.rect_item("movers", MID - w / 2, c.d, w, 140,
                    amp=150, speed=speed + 0.1 * ((i * 3) % 3), phase=i * 2.0)
        c.waypoint(c.d + 70, spread=40)
        c.d += 200
    # The last lift stops 60 px short of the next floor.


@section("Wind path", needs="wide")
def wind_path(c, length=900):
    c.checkpoint(c.d - 30)  # on the full-width floor just before
    c.floor(240, c.d, 240, length)
    c.waypoint(c.d + 30, spread=50)
    # Two gusty stretches with a calm patch between them.
    part = (length - 200) / 2
    c.rect_item("zones", LEFT, c.d + 60, WIDE, part - 40, type="wind", fx=105, fy=0, period=3.0, duty=0.5, phase=0.0)
    c.rect_item("zones", LEFT, c.d + 100 + part, WIDE, part - 40, type="wind", fx=-105, fy=0, period=3.0, duty=0.5, phase=1.5)
    c.d += length
    c.waypoint(c.d - 10, spread=50)


@section("Windy islands", needs="ground", ends="gap")
def wind_islands(c, n=3):
    for i in range(n):
        c.d += GAP
        c.floor(160, c.d, 400, 220)
        c.rect_item("zones", LEFT, c.d + 30, WIDE, 160, type="wind", fx=110 if i % 2 == 0 else -110, fy=0,
                    period=2.6, duty=0.45, phase=i * 0.9)
        if i == 0:
            c.checkpoint(c.d + 40, spread=120)
        c.waypoint(c.d + 110, spread=100)
        c.d += 220
    c.d += GAP


@section("Turntables", needs="wide", ends="gap")
def disc_hops(c, n=3):
    c.checkpoint(c.d - 40)
    c.d += 24
    for i in range(n):
        r = 165 if i % 2 == 0 else 155
        x = 270 if i % 2 == 0 else 450
        c.point_item("discs", c.d + r, x=x, r=r, speed=(0.36 + 0.04 * i) * (1 if i % 2 == 0 else -1))
        c.waypoint(c.d + r, spread=30, x=x)
        c.d += 2 * r + 24


@section("Piston corridor", needs="wide")
def piston_corridor(c, pairs=4):
    length = 200 + pairs * 170
    c.checkpoint(c.d - 30)  # on the full-width floor just before
    c.floor(180, c.d, 360, length)
    c.waypoint(c.d + 30, spread=100)
    for i in range(pairs):
        left = i % 2 == 0
        c.point_item("pistons", c.d + 150 + i * 170, x0=120 if left else 600, w=160, h=60, dir=1 if left else -1,
                     reach=200, period=2.4 + 0.15 * (i % 3), phase=i * 0.8)
    c.d += length
    c.waypoint(c.d - 10, spread=100)


@section("Pop-up blocks")
def popup_field(c, rows=3):
    length = 180 + rows * 200
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for r in range(rows):
        for x in (110, 310, 510):
            c.rect_item("popups", x, c.d + 90 + r * 200, 100, 100, period=3.0, duty=0.5,
                        phase=0.0 if (r + x // 200) % 2 else 1.5)
    c.d += length
    c.waypoint(c.d - 20)


# ---- sections built on the newer obstacles

@section("Mystery doors", needs="wide")
def mystery_doors(c, rows=3):
    """Rows of doors: some are fakes you smash straight through, others are solid."""
    length = 200 + rows * 260
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for r in range(rows):
        d = c.d + 150 + r * 260
        c.rect_item("doors", LEFT, d, WIDE, 30, count=5, reals=2 if r == 0 else 3)
        c.waypoint(d - 60, spread=230)
        c.waypoint(d + 60, spread=230)
    c.d += length
    c.waypoint(c.d - 20)


def _tile_grid(c, kind, cols, rows, width=WIDE, size=120, gap=6, **extra):
    # Seams stay thin: crossing one must take less than the brief grace period
    # for running off an edge, even for slower players walking diagonally.
    x = MID - width / 2
    c.rect_item("ghosts", x, c.d, width, rows * size, kind=kind, cols=cols, rows=rows, gap=gap, **extra)
    for r in range(rows):
        c.waypoint(c.d + r * size + size / 2, spread=width / 2 - 40)
    c.d += rows * size


@section("Trust tiles", needs="wide")
def trust_tiles(c, cols=5, rows=7):
    """Only one hidden path of tiles holds you; fakes crack and drop. Watch where others fall!"""
    c.checkpoint(c.d - 40)
    _tile_grid(c, "trust", cols, rows)
    c.floor(LEFT, c.d, WIDE, 200)
    c.d += 200
    c.waypoint(c.d - 20)


@section("Crumble bridge", needs="wide")
def crumble_bridge(c, rows=9, width=240, wind=False):
    """Every tile drops a moment after you step on it (and grows back): keep moving!"""
    c.checkpoint(c.d - 40)
    d0 = c.d
    _tile_grid(c, "crumble", 2, rows, width=width, size=110, gap=8, crack=0.75, regrow=3.5)
    if wind:
        c.rect_item("zones", LEFT, d0 + 60, WIDE, rows * 110 - 120, type="wind", fx=95, fy=0, period=3.2, duty=0.45, phase=0.4)
    c.floor(LEFT, c.d, WIDE, 200)
    c.d += 200
    c.waypoint(c.d - 20)


@section("Tilting platforms", needs="ground", ends="gap")
def tilt_platforms(c, n=3, ice=False, wind=False):
    """Platforms rock toward wherever players stand and slide you downhill."""
    xs = [MID, 300, 420, MID]
    for i in range(n):
        c.d += GAP - 10
        w = 400 if i % 2 == 0 else 360
        x = xs[i % len(xs)] - w / 2
        c.rect_item("tilts", x, c.d, w, 300, slide=190 if ice else 160, drift=0.9 + 0.25 * i if i % 2 else 0,
                    phase=i * 1.3)
        if ice:
            c.rect_item("zones", x, c.d + 20, w, 260, type="ice")
        if wind:
            c.rect_item("zones", LEFT, c.d + 40, WIDE, 220, type="wind", fx=100 if i % 2 == 0 else -100, fy=0,
                        period=2.8, duty=0.45, phase=i * 0.8)
        c.waypoint(c.d + 150, spread=40, x=x + w / 2)
        c.d += 300
    c.d += GAP - 10


@section("Log hurdles")
def log_hurdles(c, length=900, every=1.7, speed=170, ice=False, belt=False):
    """Logs roll down the course at you: jump them as they arrive."""
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    c.point_item("logs", c.d + 40, x0=70, x1=650, len=length - 80, r=18, speed=speed, every=every)
    if ice:
        c.rect_item("zones", LEFT, c.d + 60, WIDE, length - 120, type="ice")
    if belt:
        c.rect_item("zones", LEFT, c.d + 60, WIDE, length - 120, type="conveyor", fx=0, fy=70)
    c.d += length
    c.waypoint(c.d - 20)


@section("Cannon alley", needs="wide")
def cannon_alley(c, length=880, width=320, every=1.6):
    """Cannons on both sides fire balls across a narrow path."""
    c.checkpoint(c.d - 30)
    c.floor(MID - width / 2, c.d, width, length)
    c.waypoint(c.d + 30, spread=width / 2 - 50)
    for i, d in enumerate(range(int(c.d) + 140, int(c.d + length) - 100, 150)):
        left = i % 2 == 0
        c.point_item("cannons", d, x=24 if left else W - 24, aim=0.0 if left else 3.14159, every=every + 0.3 * (i % 3),
                     speed=330, r=26, range=W, phase=0.35 * i, lane=True)
    c.d += length
    c.waypoint(c.d - 10, spread=width / 2 - 50)


@section("Shifting gates")
def shifting_gates(c, n=3):
    """Walls with one gap that slides from side to side: run through when it lines up."""
    length = 180 + n * 220
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for i in range(n):
        d, half, block = c.d + 140 + i * 220, 70, 520
        common = dict(h=30, w=block, amp=170, speed=0.9 + 0.2 * i, phase=i * 1.9)
        c.point_item("sliders", d, x=MID - half - block / 2, **common)
        c.point_item("sliders", d, x=MID + half + block / 2, **common)
        c.waypoint(d + 40, spread=120)
    c.d += length
    c.waypoint(c.d - 20)


@section("Hammer hops", needs="ground", ends="gap")
def hammer_islands(c, n=3):
    """Island hops, each island swept by a hammer."""
    for i in range(n):
        c.d += GAP
        c.floor(LEFT + 60, c.d, WIDE - 120, 240)
        if i == 0:
            c.checkpoint(c.d + 40, spread=180)
        c.point_item("pendulums", c.d + 120, x=MID, amp=200, speed=1.3 + 0.3 * i, phase=i * 1.7, r=36)
        c.waypoint(c.d + 120, spread=150)
        c.d += 240
    c.d += GAP


@section("Belt islands", needs="ground", ends="gap")
def belt_islands(c, n=3):
    """Island hops where each island is a sideways conveyor belt."""
    for i in range(n):
        c.d += GAP
        c.floor(LEFT, c.d, WIDE, 200)
        c.rect_item("zones", LEFT, c.d + 20, WIDE, 160, type="conveyor", fx=150 if i % 2 == 0 else -150, fy=0)
        if i == 0:
            c.checkpoint(c.d + 40)
        c.waypoint(c.d + 100, spread=150)
        c.d += 200
    c.d += GAP


@section("Twister discs", needs="wide", ends="gap")
def twister_discs(c, n=3):
    """Spinning discs with a spinning bar on top of each: double the spin."""
    c.checkpoint(c.d - 40)
    c.d += 24
    for i in range(n):
        r, x = 170, (290 if i % 2 == 0 else 430)
        sign = 1 if i % 2 == 0 else -1
        c.point_item("discs", c.d + r, x=x, r=r, speed=0.3 * sign)
        c.point_item("spinners", c.d + r, x=x, arm=125, arms=2, speed=-1.1 * sign, thick=14, hub=18)
        c.waypoint(c.d + r, spread=60, x=x)
        c.d += 2 * r + 24


@section("Belt sprint")
def belt_sprint(c, length=900):
    """A fast forward belt with sliding walls across it: ride it, but don't get swept."""
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    c.rect_item("zones", LEFT, c.d + 60, WIDE, length - 120, type="conveyor", fx=0, fy=-150)
    for i in range(3):
        c.point_item("sliders", c.d + 220 + i * 230, x=MID, w=220, h=26, amp=190, speed=1.6 + 0.3 * i, phase=i * 2.2)
    c.d += length
    c.waypoint(c.d - 20)


@section("Snow bridge", needs="wide")
def snow_bridge(c, length=900):
    """A narrow icy bridge with snowballs rolling down it."""
    c.checkpoint(c.d - 30)
    c.floor(220, c.d, 280, length)
    c.rect_item("zones", 220, c.d + 60, 280, length - 120, type="ice")
    c.point_item("rollers", c.d + 50, x0=250, x1=470, len=length - 120, r=26, speed=160, every=1.3)
    c.waypoint(c.d + 30, spread=70)
    c.d += length
    c.waypoint(c.d - 10, spread=70)


@section("Gust gauntlet")
def gust_gauntlet(c, length=760):
    """Sliding walls in a crosswind that keeps flipping direction."""
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    c.rect_item("zones", LEFT, c.d + 60, WIDE, (length - 120) / 2, type="wind", fx=110, fy=0, period=2.6, duty=0.5, phase=0)
    c.rect_item("zones", LEFT, c.d + length / 2, WIDE, (length - 120) / 2, type="wind", fx=-110, fy=0, period=2.6, duty=0.5, phase=1.3)
    for i in range(3):
        c.point_item("sliders", c.d + 160 + i * 200, x=MID, w=200, h=28, amp=170, speed=1.5 + 0.3 * i, phase=i * 1.8)
    c.d += length
    c.waypoint(c.d - 20)


@section("Piston plaza")
def piston_plaza(c, rows=3):
    """An open floor where pistons punch in from both edges and blocks pop up between them."""
    length = 200 + rows * 220
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for r in range(rows):
        d = c.d + 140 + r * 220
        c.point_item("pistons", d, x0=0, w=160, h=60, dir=1, reach=200, period=2.7, phase=r * 0.9)
        c.point_item("pistons", d, x0=720, w=160, h=60, dir=-1, reach=200, period=2.7, phase=r * 0.9 + 1.35)
        c.rect_item("popups", 310, d + 60, 100, 100, period=2.8, duty=0.5, phase=r * 1.1)
    c.d += length
    c.waypoint(c.d - 20)


@section("Pinball lane")
def pinball_lane(c, rows=5):
    """Extra-bouncy bumpers packed close together: get flung around, keep heading up."""
    length = 140 + rows * 120
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for r in range(rows):
        xs = (200, 360, 520) if r % 2 == 0 else (120, 280, 440, 600)
        for x in xs:
            c.point_item("bumpers", c.d + 100 + r * 120, x=x, r=26, power=640)
    c.d += length
    c.waypoint(c.d - 20)


@section("Spinner forest")
def spinner_forest(c, rows=3):
    """A grid of small spinners turning opposite ways: thread between them or hop the bars."""
    length = 160 + rows * 230
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for r in range(rows):
        xs = (200, 520) if r % 2 == 0 else (160, 360, 560)
        for k, x in enumerate(xs):
            c.point_item("spinners", c.d + 140 + r * 230, x=x, arm=95, arms=2, speed=(1.9 + 0.2 * r) * (1 if (k + r) % 2 else -1),
                         thick=14, hub=16)
    c.d += length
    c.waypoint(c.d - 20)


@section("Giant sweeper")
def giant_sweeper(c, length=760):
    """One enormous bar sweeps the whole width: jump it as it comes round."""
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    c.point_item("spinners", c.d + length / 2, x=MID, arm=330, arms=1, speed=1.25, thick=18, hub=26)
    c.d += length
    c.waypoint(c.d - 20)


@section("Belt bridges", needs="wide")
def belt_bridges(c, length=820):
    """Three narrow belt bridges over the sea: fast but blocked, backward (a trap!), or slow and safe."""
    c.checkpoint(c.d - 30)
    lanes = [(80, -170), (290, 120), (500, -70)]   # (left edge, belt push: negative = toward the finish)
    for x, fy in lanes:
        c.floor(x, c.d, 140, length)
        c.rect_item("zones", x, c.d + 40, 140, length - 80, type="conveyor", fx=0, fy=fy)
    for i in range(2):  # sliding blocks across the fast lane
        c.point_item("sliders", c.d + 260 + i * 300, x=150, w=90, h=26, amp=45, speed=2.2 + 0.4 * i, phase=i * 1.6)
    c.waypoint(c.d + 30, spread=30, x=150)
    c.d += length
    c.waypoint(c.d - 10, spread=30, x=150)
    c.floor(LEFT, c.d, WIDE, 180)   # all three lanes meet again
    c.d += 180
    c.waypoint(c.d - 20)


# ---- sections built on the newest obstacles: rotating hammers, disappearing
# platforms, bumper carousels, giant bouncing balls and balance beams.

@section("Hammer carousel")
def hammer_carousel(c, length=800, speed=1.1):
    """Hammer heads swung round on long arms: two small carousels, then a big three-headed one."""
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    c.point_item("hammers", c.d + 240, x=210, arm=130, heads=2, speed=speed, r=30, hub=18, phase=0.0)
    c.point_item("hammers", c.d + 240, x=510, arm=130, heads=2, speed=-speed, r=30, hub=18, phase=0.9)
    c.point_item("hammers", c.d + 560, x=MID, arm=190, heads=3, speed=speed * 0.75, r=32, hub=22, phase=0.4)
    c.waypoint(c.d + 400, spread=60)
    c.d += length
    c.waypoint(c.d - 20)


def _blink_rows(c, rows, cols=3, depth=140, period=3.0, duty=0.62, color="#40d9ff", width=WIDE):
    """Rows of touching platforms over the sea that keep vanishing; at least one per row is always there."""
    x0, w = MID - width / 2, width / cols
    for r in range(rows):
        for k in range(cols):
            c.rect_item("blinks", x0 + k * w + 3, c.d + 3, w - 6, depth - 6, period=period, duty=duty,
                        phase=((r + k) % 3) * period / 3, color=color)
        c.waypoint(c.d + depth / 2, spread=width / 2 - 50)
        c.d += depth


@section("Vanishing floor", needs="wide")
def blink_bridge(c, rows=6, color="#40d9ff"):
    """A floor of glassy panels that flicker and vanish in turn: step onto the solid ones."""
    c.checkpoint(c.d - 40)
    _blink_rows(c, rows, color=color)
    c.floor(LEFT, c.d, WIDE, 200)
    c.d += 200
    c.waypoint(c.d - 20)


@section("Blink hops", needs="wide", ends="gap")
def blink_hops(c, n=4, color="#ff4fd8"):
    """Jump between platforms that blink out for a moment: wait for the next one to light up."""
    c.checkpoint(c.d - 40)  # on the floor before: never respawn onto a platform that's about to vanish
    xs = [MID, 260, 460, MID]
    for i in range(n):
        c.d += GAP - 6
        w = 300
        x = xs[i % len(xs)] - w / 2
        c.rect_item("blinks", x, c.d, w, 220, period=4.0, duty=0.72, phase=i * 1.35, color=color)
        c.waypoint(c.d + 110, spread=50, x=x + w / 2)
        c.d += 220
    c.d += GAP - 6


@section("Bumper carousel")
def bumper_carousel(c, length=800, speed=0.9):
    """Rings of bumpers turning round a centre post: slip through between them."""
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for x, sg in ((215, 1), (505, -1)):
        c.point_item("bumpers", c.d + 230, x=x, r=24, power=520)   # the post in the middle
        for k in range(3):
            c.point_item("bumpers", c.d + 230, x=x, r=26, orbit=105, ospeed=speed * sg, ophase=k * 2.094, power=560)
    for k in range(5):
        c.point_item("bumpers", c.d + 560, x=MID, r=28, orbit=190, ospeed=-speed * 0.7, ophase=k * 1.2566, power=600)
    c.point_item("bumpers", c.d + 560, x=MID, r=30, power=560)
    c.waypoint(c.d + 400, spread=200)
    c.d += length
    c.waypoint(c.d - 20)


@section("Big bouncers")
def bouncer_field(c, n=4, length=None, color="#ff8c42", r=54):
    """Giant balls bounce along the course: run underneath while they're up, and watch their shadows."""
    length = length or 200 + n * 170
    c.checkpoint(c.d + 30)
    c.floor(LEFT, c.d, WIDE, length)
    for i in range(n):
        c.point_item("bouncers", c.d + 150 + i * 170, x=MID, amp=200 - (i % 2) * 40, speed=0.55 + 0.12 * i,
                     phase=i * 1.7, r=r, hop=1.35 + 0.1 * (i % 3), hphase=i * 0.45, height=230, color=color)
    c.d += length
    c.waypoint(c.d - 20)


@section("Balance beams")
def beam_walk(c, length=720, width=80, hammers=True):
    """Three narrow beams over the sea, with rotating hammers between them sweeping across."""
    xs = (150, MID, 570)
    # A short approach floor where everyone lines up with a beam before stepping on.
    c.floor(LEFT, c.d, WIDE, 140)
    c.checkpoint(c.d + 30)
    c.waypoint(c.d + 60, spread=0, lanes=xs)
    c.waypoint(c.d + 120, spread=0, lanes=xs)
    c.d += 140
    for x in xs:
        c.floor(x - width / 2, c.d, width, length)
    if hammers:
        for i, d in enumerate((230, 500)):
            for x in (255, 465):
                c.point_item("hammers", c.d + d, x=x, arm=105, heads=2, speed=(0.8 + 0.12 * i) * (1 if x < MID else -1),
                             r=24, hub=12, phase=i * 1.1 + (0 if x < MID else 0.6))
    # Computer players pick a beam each.
    c.waypoint(c.d + 20, spread=0, lanes=xs)
    c.waypoint(c.d + length - 20, spread=0, lanes=xs)
    c.d += length
    c.floor(LEFT, c.d, WIDE, 160)   # all three beams end on one floor
    c.d += 160
    c.waypoint(c.d - 20)


@section("Hammer bridge", needs="wide")
def hammer_bridge(c, length=820, width=220):
    """A bridge over the sea with hammers on posts either side, swinging their heads across it."""
    c.checkpoint(c.d - 30)
    c.floor(MID - width / 2, c.d, width, length)
    c.waypoint(c.d + 30, spread=width / 2 - 40)
    for i in range(3):
        left = i % 2 == 0
        c.point_item("hammers", c.d + 170 + i * 240, x=MID - 175 if left else MID + 175, arm=170, heads=2,
                     speed=0.95 * (1 if left else -1), r=28, hub=14, phase=i * 1.3)
    c.d += length
    c.waypoint(c.d - 10, spread=width / 2 - 40)


@section("Bumper islands", needs="ground", ends="gap")
def bumper_islands(c, n=3):
    """Island hops, each island with a ring of bumpers turning on it: don't get bounced into the sea!"""
    for i in range(n):
        c.d += GAP
        c.floor(LEFT + 40, c.d, WIDE - 80, 260)
        if i == 0:
            c.checkpoint(c.d + 40, spread=180)
        sg = 1 if i % 2 == 0 else -1
        c.point_item("bumpers", c.d + 130, x=MID, r=22, power=500)
        for k in range(3):
            c.point_item("bumpers", c.d + 130, x=MID, r=24, orbit=92, ospeed=0.95 * sg, ophase=k * 2.094 + i, power=520)
        c.waypoint(c.d + 130, spread=170)
        c.d += 260
    c.d += GAP


def _fix_movers(level):
    """Lifts are stored by their centre line and slide sideways by ``amp``."""
    out = []
    for m in level.get("movers", []):
        m = dict(m)
        m["x"] = m["x"] + m["w"] / 2
        out.append(m)
    level["movers"] = out
    return level


def make(level_id, name, description, theme_, parts, **extra):
    c = Course()
    for part in parts:
        fn, *args = part if isinstance(part, tuple) else (part,)
        kwargs = args[0] if args else {}
        fn(c, **kwargs)
    return _fix_movers(c.build(level_id, name, description, theme_, **extra))


# ----------------------------------------------------------------- the races

# Each race is set in its own world (theme env) and has its own signature
# sections; no section repeats within a race, and the shared basics (island
# hops, stepping stones...) only turn up in a few races each.

SPIN_SPRINT = make(
    "spin_sprint", "Spin Sprint",
    "Palm-tree islands over a turquoise sea: a spinner field, rotating hammers, a whole "
    "forest of spinners, a spinner bridge and rocking platforms, then a giant sweeper and logs.",
    theme(["#38b6ff", "#d9f6ff"], "#2fd4c8", "#fff0c2", "#ffe39a", "#e09a4a", "#ff5fa2", env="tropical"),
    [start, spinner_field, hammer_carousel, spinner_forest, spin_bridge, tilt_platforms, zigzag,
     giant_sweeper, mystery_doors, log_hurdles, finish],
    bot_pace=0.8, bot_hesitation=0.5, bot_stumble=0.2,
)

CONVEYOR_CANYON = make(
    "conveyor_canyon", "Conveyor Canyon",
    "A high-tech factory in the sky: pick the belt that carries you forward, hop sideways-belt "
    "islands, cross a vanishing glass floor and choose the right belt bridge.",
    theme(["#2f6fd6", "#cfe8ff"], "#2a4a7a", "#e6eef8", "#cbd9ea", "#4a5d7a", "#ff8c42", env="future"),
    [start, conveyor_lanes, belt_islands, conveyor_cross, (blink_bridge, {"rows": 5}), express_bridge,
     belt_bridges, pinball_lane, belt_sprint, hammer_bridge, split_path, finish],
    bot_pace=0.78,
)

BOUNCE_BAY = make(
    "bounce_bay", "Bounce Bay",
    "Out at sea among boats and buoys: fly across the bay on bounce pads, dodge giant bouncing "
    "beach balls, then cross stepping stones and a crumbling bridge under cannon fire.",
    theme(["#4fc3ff", "#eafcff"], "#1fc8e8", "#fff6d6", "#ffeab0", "#e0b066", "#ff5fa2", env="water"),
    [start, pad_jump, bounce_chain, stones, pinball_lane, bumper_islands, crumble_bridge, cannon_alley,
     (bounce_chain, {"hops": 2, "title": "Pad sprint"}), finish],
    bot_pace=0.76,
)

FROSTY_SLOPES = make(
    "frosty_slopes", "Frosty Slopes",
    "Snowy peaks and pine trees: snowballs roll down the slopes, giant snowballs bounce at "
    "you, icy platforms rock under your feet and the zig-zags are frozen solid.",
    theme(["#7cc8ff", "#f4fbff"], "#7fd6ff", "#f2fbff", "#dff2ff", "#7aa9cc", "#5b8cff", env="snow", snow=True),
    [start, ice_rollers, (tilt_platforms, {"ice": True}), (zigzag, {"ice": True, "n": 4}),
     (log_hurdles, {"ice": True, "speed": 150}), snow_bridge, islands, (sliders, {"ice": True}),
     (bouncer_field, {"n": 3, "title": "Snowball bounce", "color": "#e8f6ff", "r": 50}),
     (spinner_field, {"big": False, "title": "Icicle spinners"}), crumble_bridge, finish],
    bot_pace=0.8,
)

HAMMER_HALL = make(
    "hammer_hall", "Hammer Hall",
    "A candy castle of hammers: a narrow hammer walk, islands swept by hammers, a hall of "
    "giant ones, balance beams, mystery doors and the hammer gauntlet.",
    theme(["#7f6bff", "#ffe6fb"], "#b47cff", "#efe6ff", "#e0d2ff", "#8a6cc9", "#ffd23f", env="candy"),
    [start, hammer_walk, hammer_islands, big_hammers, mystery_doors, beam_walk, bumpers, islands,
     hammer_bridge, shifting_gates, (hammer_walk, {"n": 4, "amp": 215, "title": "Hammer gauntlet"}), finish],
    bot_pace=0.75,
)

DRIFT_LIFTS = make(
    "drift_lifts", "Drift Lifts",
    "Sunset over tropical islands: ride drifting lifts, balance on rocking platforms, slip "
    "through a bumper carousel, then find the hidden path through the trust tiles.",
    theme(["#ff9f6b", "#ffe9c2"], "#20c9c0", "#fff4cf", "#ffe9a8", "#d9a441", "#5b8cff", env="tropical"),
    [start, lift_chain, cannon_alley, bumper_carousel,
     (lift_chain, {"n": 3, "speed": 0.95, "w": 280, "title": "Speedy lifts"}), trust_tiles, bumper_islands,
     (spinner_field, {"speed": 1.9}), islands, stones, (sliders, {"n": 2}), finish],
    bot_pace=0.75,
)

GUSTY_GORGE = make(
    "gusty_gorge", "Gusty Gorge",
    "High above the clouds, gusts switch on and off across a narrow path, windy islands and "
    "rocking platforms; then a crumbling bridge in the wind and shifting gates.",
    theme(["#3d9bff", "#e6f4ff"], "#9fd8ff", "#ffffff", "#e8f1ff", "#7fa6d9", "#ff8c42", env="sky"),
    [start, wind_path, wind_islands, (tilt_platforms, {"wind": True}), gust_gauntlet,
     (crumble_bridge, {"wind": True}), zigzag, shifting_gates, (bumpers, {"wind": True}), spin_bridge, finish],
    bot_pace=0.78,
)

TURNTABLE_TRAIL = make(
    "turntable_trail", "Turntable Trail",
    "A candy land of lollipops and donuts: spinning discs carry you round, gumballs bounce "
    "across the path and a bumper carousel turns between mystery doors.",
    theme(["#ff9ad5", "#fff1f8"], "#ff8fd0", "#ffe0f0", "#ffcce6", "#c4588f", "#5b8cff", env="candy"),
    [start, disc_hops, mystery_doors, twister_discs,
     (bouncer_field, {"n": 3, "title": "Gumball bounce", "color": "#b47cff", "r": 46}), stones, popup_field,
     (disc_hops, {"n": 4, "title": "Big wheels"}), bumper_carousel, giant_sweeper, finish],
    bot_pace=0.85,
)

PISTON_PASS = make(
    "piston_pass", "Piston Pass",
    "A futuristic test track: pistons punch from the walls, blocks pop out of the floor, "
    "cannons fire across the path and the trust tiles hide one safe path.",
    theme(["#1fb5ff", "#e0f7ff"], "#1d3f6e", "#e3f6ff", "#cdeeff", "#4a90b8", "#ff5757", env="future"),
    [start, piston_corridor, popup_field, cannon_alley, shifting_gates, piston_plaza, trust_tiles, hammer_bridge,
     (piston_corridor, {"pairs": 5, "title": "Piston gauntlet"}), (sliders, {"n": 2}), split_path, finish],
    bot_pace=0.75,
)

NEON_NEXUS = make(
    "neon_nexus", "Neon Nexus",
    "A glowing night arena: bumper carousels, a flickering floor, pinball bumpers, blinking "
    "platforms, rotating hammers and a forest of spinners under a neon sunset.",
    theme(["#140b4a", "#ff6fd8"], "#2a0f5e", "#6a55e0", "#5843c4", "#2a1b6e", "#40d9ff", env="neon"),
    [start, bumper_carousel, (blink_bridge, {"title": "Flicker floor", "color": "#ff4fd8"}), pinball_lane,
     (hammer_carousel, {"speed": 1.25}), (conveyor_cross, {"title": "Laser belts"}), blink_hops, popup_field,
     bumper_islands, spinner_forest, (spin_bridge, {"title": "Laser bridge"}), finish],
    bot_pace=0.8,
)

SKY_SPIRES = make(
    "sky_spires", "Sky Spires",
    "Islands floating high above the clouds: balance beams with rotating hammers, blinking "
    "platforms, drifting lifts, bounce pads and giant bouncing balls.",
    theme(["#2f8fff", "#cfe9ff"], "#7cc8ff", "#fff3c4", "#ffe48a", "#d9a441", "#b47cff", env="sky"),
    [start, beam_walk, (blink_hops, {"color": "#ffd23f"}), pad_jump, (lift_chain, {"n": 3, "title": "Cloud lifts"}),
     wind_islands, hammer_islands, (bounce_chain, {"title": "Cloud bounce"}), (big_hammers, {"n": 2}),
     (blink_bridge, {"rows": 4, "title": "Cloud glass", "color": "#9fd8ff"}), finish],
    bot_pace=0.8,
)

LAGOON_LEAP = make(
    "lagoon_leap", "Lagoon Leap",
    "A sunny lagoon: beach balls bounce along the sand, currents sweep you sideways, "
    "hammers spin on the pier, buoys bounce you about and driftwood rolls down the jetty.",
    theme(["#57d0ff", "#f0fdff"], "#13b5c9", "#d4fff4", "#b5f5e6", "#3aa794", "#ff8c42", env="water"),
    [start, (bouncer_field, {"title": "Beach balls", "color": "#ffd23f"}), (belt_islands, {"title": "Currents"}),
     hammer_carousel, (bumpers, {"title": "Buoy maze"}), conveyor_lanes,
     (disc_hops, {"title": "Whirlpools"}), (log_hurdles, {"title": "Driftwood", "every": 1.9}),
     (belt_sprint, {"title": "Riptide"}), express_bridge, split_path, finish],
    bot_pace=0.78,
)

RACES = (SPIN_SPRINT, CONVEYOR_CANYON, BOUNCE_BAY, FROSTY_SLOPES, HAMMER_HALL, DRIFT_LIFTS,
         GUSTY_GORGE, TURNTABLE_TRAIL, PISTON_PASS, NEON_NEXUS, SKY_SPIRES, LAGOON_LEAP)
