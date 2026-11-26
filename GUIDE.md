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
4. Click **Play show**. The first time you do this, the game offers the **tutorial**.
   We strongly recommend taking it.

Everything runs on your own computer. No internet connection or account is needed.

---

## 2. Controls

| Key                          | Action                                                   |
|------------------------------|----------------------------------------------------------|
| `W` `A` `S` `D` or arrow keys | Move (you can move diagonally)                         |
| `Space`                      | Jump                                                     |
| `Shift` or `E`               | Dive: a fast forward lunge. Works on the ground or in mid-air |
| `Esc` or `P`                 | Pause (Resume / Quit to menu)                            |
| `Space` or `Enter`           | Confirm on round intro and result screens               |

**Movement tips**

- You keep a bit of momentum in the air, and you can steer gently while airborne.
- A **dive** launches you forward but leaves you lying on the ground for a moment
  afterwards. Use it to gain distance, not all the time.
- **Jump + Dive** is your longest move. Jump, then press `Shift` near the top of the
  jump to fly much further than a jump alone.
- Pressing `Space` a split second before you land still counts, so you can chain hops.

---

## 3. How a show works

A **show** is three rounds against 11 computer-controlled players (12 in total).
After each round, the players who didn't qualify are knocked out:

| Round | Name        | Type     | Players | Who moves on                    |
|-------|-------------|----------|---------|---------------------------------|
| 1     | Spin Sprint | Race     | 12      | First **8** across the finish   |
| 2     | Tile Panic  | Survival | 8       | Last **4** still standing       |
| 3     | Spin Arena  | Final    | 4       | Last **1** standing wins the crown |

If you're eliminated, the show ends and your score is saved. Win the final to earn a
**crown**.

Before each round, an intro card explains the goal and shows your personal best on
that level. A **3-2-1-GO!** countdown starts the action.

---

## 4. The rounds

### Round 1: Spin Sprint (race)

Run from the bottom of the course to the **FINISH** arch at the top.
The bar on the right edge of the screen shows everyone's progress (your dot is the
big one with a white ring).

Sections, in order:

1. **Spinner field**: three spinning bars. Jump over a bar just before it reaches
   you, or slip through the lane between the two front spinners.
2. **Gaps**: three jumps over empty space. Run at full speed and jump at the edge.
3. **Sliding walls**: blue walls sweep left and right. They're too tall to jump, so
   wait for an opening. Getting caught pushes you around.
4. **Bumper field**: pink bumpers bounce you away hard. Weave between them.
5. **Wobbly bridge**: a narrow bridge with two fast spinners. Stay in the middle and
   time your jumps. This is where most falls happen.
6. **Final stretch**: one giant spinner guards the finish.

**Checkpoints** are the blue dashed lines with flags. If you fall off, you drop back in
at the last checkpoint you crossed.

Once you qualify, the game fast-forwards until the other spots are filled.

### Round 2: Tile Panic (survival)

The floor is a grid of tiles. **Every tile you touch starts to crumble.** It turns
orange, shakes, and disappears about a second later. Fall through a hole and you're out.

- Don't stand still: your own tile is crumbling under you.
- Don't sprint everywhere either: every tile you run over is one fewer for later.
  Short hops from tile to tile last longest.
- Holes can be **jumped**. Make sure the tile you land on isn't already orange.
- Stay near the middle where there are more tiles around you.
- After 30 seconds, random tiles begin to crumble on their own, so keep watching.

### Round 3: Spin Arena (final)

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
| Finish line         | Checkered strip under a yellow FINISH arch  | Cross it!                                    |

When you're stunned (little stars spin around your head), you can't move for a moment.

---

## 6. The tutorial

**Main menu → Tutorial** (also offered automatically the first time you click
*Play show*).

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
| Speed bonus (race)                      | 3 for every second under 45s                   |
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
| Port 5000 already in use                   | Stop the other program, or change the port at the bottom of `run.py`. |
| Keys don't respond                          | Click on the game once so the browser window has focus.            |
| Game paused by itself                      | It pauses when the window loses focus. Press `Esc` to resume.      |
| Want a clean start                          | Delete `data/save.json` (or use **Reset progress**).                |
