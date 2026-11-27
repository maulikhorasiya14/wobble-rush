# Wobble Rush: Player Guide

Welcome! This guide teaches you everything you need to win your first crown.
If you just want to jump in, read **Quick start** and **Controls**, then play the
in-game **Tutorial**. It takes about a minute.

---

## 1. Quick start

1. Start the game (see the README for one-time setup):
   ```bash
   source .venv/bin/activate
   python run.py
   ```
2. Your browser opens **http://127.0.0.1:5000**. If it doesn't, open that address yourself.
3. On the main menu, type your **name** and pick a **colour** for your character.
4. Click **PLAY**. The first time you do this, the game offers the **tutorial**.
   We strongly recommend taking it.

Everything runs on your own computer. No internet connection or account is needed.
To play with friends, press **Multiplayer** instead (see section 3b).

---

## 2. Controls

| Key                          | Action                                                   |
|------------------------------|----------------------------------------------------------|
| `W` `A` `S` `D` or arrow keys | Move (you can move diagonally)                         |
| `Space`                      | Jump                                                     |
| `Shift` or `E`               | Dive: a fast forward lunge. Works on the ground or in mid-air |
| `Esc` or `P`                 | Pause (Resume / Quit to menu). On a round card: quit the show |
| `Space` or `Enter`           | Confirm on round intro and result screens               |

**Camera (3D view)**

The camera orbits freely around your character, all the way round (360°):

| Input | What it does |
|-------|--------------|
| Move the mouse left / right | Swing the camera around your character |
| Move the mouse up / down | Tilt the camera higher or lower |
| Mouse wheel | Zoom in / out |
| Click the game | Capture the mouse for camera control (happens automatically when a round starts) |
| `Esc` | Release the mouse and pause |

Movement is relative to the camera: `W` always runs away from the camera (into the
screen), `S` toward it, `A` / `D` to the camera's left and right. If you'd rather not
capture the mouse, hold a mouse button and drag to turn the camera instead. In the
classic 2D view the camera is fixed.

**Movement tips**

- You keep a bit of momentum in the air, and you can steer gently while airborne.
- A **dive** launches you forward but leaves you lying on the ground for a moment
  afterwards. Use it to gain distance, not all the time.
- **Jump + Dive** is your longest move. Jump, then press `Shift` near the top of the
  jump to fly much further than a jump alone.
- Pressing `Space` a split second before you land still counts, so you can chain hops.
- Ran off an edge by accident? You still have a split second to jump after leaving the
  floor.

---

## 3. How a show works

On the main menu, pick how many rounds you want: **3, 4 or 5**. Each show then picks
its rounds at random, like a TV game show running order. Every round has slots it
can appear in:

| Slot | Rounds |
|------|--------|
| **Round 1** (opener) | Spin Sprint, Conveyor Canyon, Bounce Bay, Hammer Hall, Piston Pass |
| **Middle rounds** | Any opener race, plus Turntable Trail, Frosty Slopes, Drift Lifts, Gusty Gorge, and the survival rounds Tile Panic, Meteor Meadow and Blizzard Bluff (at most one survival round, two in a 5-round show) |
| **Final** | Spin Arena, Cannon Clash or Pinball Pit, picked at random |

No round repeats within a show.

You start with 11 computer players (12 in total). After each round, the players who
didn't qualify are knocked out:

| Show length | Players left after each round |
|-------------|-------------------------------|
| 3 rounds    | 8 → 4 → 1 winner              |
| 4 rounds    | 9 → 6 → 3 → 1 winner          |
| 5 rounds    | 10 → 8 → 6 → 3 → 1 winner     |

During a round, the counter at the top shows how many spots are filled (races) or how
many players are left (survival), the row of icons under it shows every contestant,
and a feed on the left announces who qualifies or gets knocked out.

If you're eliminated, the show ends and your score is saved. Win the final to earn a
**crown**. Before each round, an intro card explains the goal and shows your personal
best on that round. A **3-2-1-GO!** countdown starts the action.

---

## 3b. Multiplayer: play with friends

Up to **20 people** can play the same show.

1. One person runs the game (`python run.py`); everyone opens the game in their browser.
2. Press **Multiplayer**, type your name and press **Create room**. You get a
   **4-letter room code** and become the host.
3. Friends press **Multiplayer**, type the code and press **Join**.
4. The host picks the number of rounds (1–5) and whether to fill empty spots with
   **bots** ("Fill to 12" — the default — "Fill to 20" or "Off"), then presses **Start show**.

A show needs at least one more player than it has rounds (2 players: 1 round,
3 players: 2 rounds, and so on), so someone is knocked out every round. How many
qualify scales with the number of players, for example with 20 players:

| Show length | Players left after each round |
|-------------|-------------------------------|
| 3 rounds    | 20 → 13 → 7 → 1 winner        |
| 5 rounds    | 20 → 17 → 13 → 10 → 5 → 1 winner |

Good to know:

- Rounds start by themselves after a short intro, and the game **never pauses** in
  multiplayer. `Esc` opens a menu (to leave the room) while the round keeps going.
- Finished the race or knocked out? You can **keep watching**. Press `←` / `→` to
  switch who the camera follows.
- Your own character always responds instantly; other players are shown a split
  second behind so they move smoothly. The host's browser runs the bots and
  obstacles in the background, so the host can even switch tabs. If the host
  leaves, the next player becomes host and the current round restarts.
- People who join while a show is running watch it and play in the next one.
- Everyone's score, crowns and personal bests are saved to their **own** profile.

---

## 4. The rounds

### Races: how they work

Run from the start to the **FINISH** arch, far off in the distance: every race is a
long course (around 9,000–10,500 px, two to three minutes for the field) made of
**10–14 sections** in a row, so you can't see the finish from the start. As you reach
each part, a label under the counter tells you where you are, e.g.
"Section 7 of 14 · Zig-zag platforms". The bar on the right edge shows everyone's
progress (your dot has a white ring and the label YOU); the small notches on its left
mark where each section begins.

**Checkpoints** are the blue dashed lines with flags, one at (almost) every section.
If you fall off, you drop back in at the last checkpoint you crossed, so a fall only
costs you that section. Once you qualify, the game fast-forwards until the other spots
are filled.

Before each race, the intro card shows the whole course as a strip of sections. Every
race has its own signature sections and no section repeats within a race. Browse them
all on the main menu under **Rounds**.

Sections you'll meet:

| Section | What to do |
|---|---|
| Spinner field | Jump a spinning bar just before it reaches you, or slip between them. |
| Island hops | Running jumps across gaps; some islands are narrow. |
| Sliding walls | Walls sweep side to side; too tall to jump, so wait for an opening. |
| Bumper maze | Pink bumpers bounce you away hard; weave between them. |
| Spinner bridge | A narrow bridge with two fast spinners. Stay central and time your jumps. |
| Zig-zag platforms | Platforms step left and right; jump where they overlap. |
| Stepping stones | Rows of small stones; hop straight up the line where they overlap. |
| Split path | Choose: a narrow shortcut plank swept by hammers on the left (quick if you time it), or a safer road with sliding blocks and bumpers on the right. |
| Bounce pads / Bounce chain | Gaps too wide to jump: step on a glowing pad and fly across, sometimes pad after pad. |
| Conveyor lanes / Cross belts / Express bridge | Belts carry you forward, back or sideways. |
| Belt bridges | Three narrow belt bridges: fast but blocked, backward (a trap), or slow and safe. |
| Snowball slope | Slippery ice with snowballs rolling down at you. |
| Hammer walk / Giant hammers | Swinging hammers over a walkway or a wide hall. |
| Drifting lifts | Moving platforms over the sea: wait until the next one lines up, then jump. |
| Wind path / Windy islands | Gusts switch on and off; lean into them or wait. |
| Turntables | Spinning discs carry you round; aim ahead of where you want to go. |
| Piston corridor / Pop-up blocks / Piston plaza | Pistons punch from the walls and blocks rise from the floor; read the rhythm. |
| Mystery doors | Rows of "?" doors: fakes burst open when you run into them, real ones stop you. A door someone has bumped shows a red X. The layout changes every round. |
| Trust tiles | Only one hidden path of tiles holds you; fakes crack and drop. Safe tiles glow green once someone has stood on them, so watch where others go! |
| Crumble bridge | Every tile drops a moment after you step on it (and grows back later): keep moving. |
| Tilting platforms | They rock toward wherever players stand and slide you downhill. Stay near the middle. |
| Log hurdles | Logs roll down the course at you: jump each one as it arrives. |
| Cannon alley | Cannons on both sides fire balls across a narrow path. |
| Shifting gates | Walls with one gap that slides side to side: run through when it lines up. |
| Spinner forest / Giant sweeper | A grid of small spinners, or one huge bar sweeping the whole width. |
| Hammer hops / Belt islands / Twister discs | Island hops with a hammer, a sideways belt, or a spinner riding a turntable. |

### The nine races

Each race has its own theme and signature sections:

- **Spin Sprint**: the classic mix: spinners, islands, sliding walls, bumpers, a
  spinner bridge, zig-zags, stepping stones and a split path.
- **Conveyor Canyon**: conveyor belts. Pick the lane whose arrows point toward the
  finish, push against the sideways belts, then ride the express belt along the bridge.
- **Bounce Bay**: gaps far too wide to jump. Run onto a glowing **bounce pad** and it
  throws you across. You can't steer mid-flight, so line up first.
- **Frosty Slopes**: **ice** makes you slide (it's hard to stop or turn), and giant
  **snowballs** roll down toward you. Dodge them or get bowled over.
- **Hammer Hall**: big **hammers** swing across a narrow walkway. Wait for a hammer
  to pass, then run.
- **Drift Lifts**: **moving platforms** over the sea. Wait at the edge until the next
  platform slides in front of you, then jump. You ride along while standing on one.
- **Gusty Gorge**: **gusts of wind** switch on and off (the fans spin fast and white
  streaks blow past). Lean into the wind or wait for it to stop.
- **Turntable Trail**: a chain of **spinning discs**. Standing on one carries you
  round, so aim ahead of where you want to go and jump when the next disc is close.
- **Piston Pass**: **pistons** punch out of the corridor walls, and orange blocks pop
  up out of the floor. Watch the rhythm and slip through the gaps.

### More survival rounds

- **Meteor Meadow**: red target circles light up on the meadow, and a glowing meteor
  smashes those tiles away about 2 seconds later. Step off any red tiles. Strikes
  get more frequent over time. You have **1 extra life**.
- **Blizzard Bluff**: gusts that change direction every few seconds (watch the
  arrows on the snow) and snowballs rolling across the bluff. Lean into the wind,
  stay away from the edge. You have **1 extra life**.

### More finals

- **Cannon Clash**: six cannons around the arena fire giant balls across it, faster
  and faster, while the arena shrinks. Dodge or jump them.
- **Pinball Pit**: super-bouncy bumpers fling you hard, and two spinning bars speed
  up over time. The arena shrinks. Last one standing wins.

### Tile Panic (survival)

A round arena of large hexagonal tiles. **Every tile you touch starts to crumble**: it
turns orange, shakes and drops away. Tiles you step on last about **1.4 seconds**;
the computer players' tiles drop after 0.75 seconds.

**You have 2 extra lives** in this round (the hearts next to the counter). Fall
through and you drop back in on a safe tile; fall a third time and you're out.

- Keep hopping from tile to tile: the one under you is always crumbling.
- Each tile is wide, so start moving as soon as you land.
- Holes can be **jumped**. Make sure the tile you land on isn't already orange.
- Head for areas with lots of untouched tiles, away from other players.
- After 35 seconds, random tiles begin to crumble on their own.

### Spin Arena (final)

A round platform with one huge beam sweeping around it.

- **Jump the beam** each time it comes round. Watch its shadow and jump just before it
  reaches you.
- The beam **speeds up** over time, and after a minute it grows two extra arms.
- After 30 seconds the **arena shrinks**. Its edge turns red at its smallest size.
- Getting hit knocks you a long way. If you're near the edge, that usually means a fall.
- Be the **last one standing** to win the crown!

---

## 5. Obstacles at a glance

| Obstacle            | Looks like                                   | What to do                                  |
|---------------------|----------------------------------------------|---------------------------------------------|
| Spinning bar        | Striped bar turning around a purple hub     | Jump over it as it arrives. The hub is solid |
| Sliding wall        | Tall blue block moving side to side          | Wait for the gap, then go. Can't be jumped |
| Bumper              | Pink round pillar                            | Avoid it, or use the bounce on purpose      |
| Gap / void          | Empty space between platforms               | Jump (or jump + dive for big gaps)          |
| Crumbling tile      | Orange, shaking tile                        | Step off now                                |
| Checkpoint          | Blue dashed line with flags                 | Cross it to save your respawn point        |
| Conveyor belt       | Purple strip with moving yellow arrows       | Go with it, or push hard against it        |
| Ice                 | Shiny pale-blue floor                        | Make small, early turns; you'll slide      |
| Bounce pad          | Glowing green pad with an arrow              | Step on it to be launched across a gap     |
| Hammer              | Striped ball swinging on a rope              | Wait for it to swing past                  |
| Snowball            | Big white ball rolling toward you            | Sidestep it                                |
| Moving platform     | Yellow-edged slab sliding side to side       | Jump when it lines up                      |
| Wind                | Fans, white streaks, faint arrows            | Lean into it or wait for it to stop        |
| Spinning disc       | Striped turntable with a yellow centre       | It carries you round; aim ahead            |
| Piston              | Yellow-and-navy striped block from a wall    | Pass while it's pulled back                |
| Pop-up block        | Orange striped block rising from a dark slot | Go through a lane while it's down          |
| Meteor target       | Red pulsing ring, red tiles                  | Get off the red tiles, fast                |
| Cannon              | Navy cannon on the arena's edge              | Watch where it aims; dodge the ball        |
| Finish line         | Checkered strip under a yellow FINISH arch  | Cross it!                                    |

When you're stunned (little stars spin around your head), you can't move for a moment.

---

## 6. The tutorial

**Main menu → Tutorial** (also offered automatically the first time you click
**PLAY**).

It's a short practice course with no rivals. Tip boxes at the top of the screen teach
each move as you reach it:

1. Moving
2. Jumping a gap
3. Checkpoints and respawning
4. Jumping a spinning bar
5. Jump + Dive across a huge gap
6. Sliding walls
7. Bumpers
8. Crossing the finish

You can restart it any time from the pause menu, and your best tutorial time is saved
too.

---

## 7. Score and personal bests

Your progress is saved **on your computer** in `data/save.json`.

**Score per show**

| Result                                  | Points                                        |
|-----------------------------------------|-----------------------------------------------|
| Qualify from the race                   | 100 + placement bonus + speed bonus           |
| Placement bonus (race)                  | 15 × (8 − your place + 1); 1st place = 120     |
| Speed bonus (race)                      | 3 for every second under 60s                   |
| Survive Tile Panic                      | 150 + 1 per second survived                    |
| Win the final                           | 650 + 1 per second survived                    |
| Eliminated in the race                  | 20                                            |
| Eliminated in a survival round          | 1 per second survived                          |

**Personal bests tracked**

- Best show score
- Furthest round reached (or "Won the final")
- Crowns won, shows played, rounds qualified
- Fastest time on Spin Sprint (only when you qualify) and on the tutorial
- Longest survival time on Tile Panic and Spin Arena

New records are highlighted on the result screen. See them all under
**Main menu → Personal bests**. The **Reset progress** button there clears stats and
records but keeps your name, colour and tutorial status.

---

## 8. Strategy tips

- **Race**: the middle lane between the first two spinners is often the fastest line.
- **Race**: on the bridge, a missed jump costs more time than waiting half a second.
- **Tiles**: count your steps. Each tile buys you about a second.
- **Final**: stand about halfway out. Near the hub the beam is slow but hard to jump
  cleanly. Near the edge one hit means a fall.
- **Dives** can knock rivals over. Use them carefully, because you're stuck on the
  ground afterwards.

---

## 9. Troubleshooting

| Problem                                   | Fix                                                                 |
|-------------------------------------------|---------------------------------------------------------------------|
| "Could not reach the game server"         | Make sure `python run.py` is still running in your terminal.        |
| Browser didn't open                        | Open http://127.0.0.1:5000 yourself.                               |
| Port 5000 already in use                   | Stop the other program, or start with `WOBBLE_PORT=5001 python run.py`. |
| "No room with code ..."                    | Check the 4 letters. Rooms close when everyone has left. |
| Multiplayer feels laggy                     | The host's computer runs the round: a host on a fast computer and a good connection works best. |
| Keys don't respond                          | Click on the game once so the browser window has focus.            |
| Game paused by itself                      | It pauses when the window loses focus. Press `Esc` to resume. (Multiplayer never pauses.) |
| A screen seems stuck                        | The game recovers from errors by itself and returns to the menu if needed. If it still looks stuck, make sure you're running the latest version (`git pull`), restart `python run.py`, then reload the page. |
| Want a clean start                          | Delete `data/save.json` (or use **Reset progress**).                |
| Game runs slowly or looks blurry           | It lowers its resolution automatically to stay smooth. On older computers, click **Graphics** on the main menu to switch to the classic 2D view. |
| Screen is blank / 3D won't start            | Your browser may have WebGL turned off. The game switches to 2D automatically; updating the browser or graphics drivers enables 3D. |
