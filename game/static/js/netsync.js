// Multiplayer sync.
//
// The room host's browser runs each round in a background worker
// (hostworker.js) and sends ~30 snapshots a second of where everything is.
// Every browser (the host's too) keeps a copy of the round, plays those
// snapshots back a fraction of a second behind, smoothly blended (Mirror),
// and moves its own character itself so your own moves feel instant
// (World.stepLocal). Each browser reports its character back to the host
// (encodeBody), and the host's rules decide who qualifies.

const SNAP_HZ = 30;
export const SNAP_EVERY = 1 / SNAP_HZ;
// Players report their own character 20 times a second (the host smooths the
// gaps), which keeps the server light when the room is full.
export const STATE_EVERY = 1 / 20;

// Moving obstacles: the fields that change during a round.
const DYNAMIC = {
  spinners: ["angle", "arms", "arm", "omega"],
  sliders: ["cx", "vx"],
  bumpers: ["pulse", "x", "y"],
  hammers: ["angle"],
  bouncers: ["bx", "bz", "vx"],
  zones: ["active", "angle", "fx", "fy"],
  pads: ["pulse"],
  pendulums: ["bx", "vx"],
  movers: ["cx", "dx"],
  discs: ["angle"],
  pistons: ["cx", "vx"],
  popups: ["rise", "up"],
  cannons: ["aim", "flash"],
  doors: ["broken", "known"],
  ghosts: ["st", "t", "known"],
  tilts: ["angle"],
};
// Fields that are never blended (counts and on/off states).
const STEPPED = new Set(["arms", "active", "up", "broken", "known", "st"]);
const FLAGS = new Set(["active", "up", "broken", "known"]);
// Fields the renderers interpolate from ("previous" copies): we set them equal
// to the current value, because the Mirror already blends between snapshots.
const PREVIOUS = {
  spinners: [["angle", "pangle"]], sliders: [["cx", "pcx"]], pendulums: [["bx", "pbx"]],
  movers: [["cx", "pcx"]], discs: [["angle", "pangle"]], pistons: [["cx", "pcx"]],
  hammers: [["angle", "pangle"]], bouncers: [["bx", "pbx"], ["bz", "pbz"]],
};

const BODY_NUM = ["x", "y", "z", "vx", "vy", "vz", "fx", "fy", "stun", "walk", "squash", "hitT", "fallT", "lives", "finishTime"];
const BODY_FLAG = ["diving", "falling", "finished", "eliminated", "hidden", "sliding", "crown", "onGround", "onIce", "ballistic"];
const BLEND = new Set(["x", "y", "z", "walk", "fx", "fy", "fallT"]);
const TILE_STATE = { solid: 0, crack: 1, gone: 2 };
const TILE_NAME = ["solid", "crack", "gone"];

/** Effects your own browser makes for your own character (so the host's copy is skipped). */
export const LOCAL_EVENTS = new Set(["jump", "dive", "land", "hit", "pad", "fall", "respawn", "lifelost", "checkpoint", "bump", "eliminated"]);
/** Effects a browser reports for its character, for everyone else to see. */
export const SHARED_EVENTS = new Set(["jump", "dive", "land", "hit", "pad", "fall", "respawn", "bump"]);
/** Body fields a browser is in charge of for its own character. */
export const OWN_FIELDS = ["x", "y", "z", "vx", "vy", "vz", "fx", "fy", "stun", "walk", "squash", "hitT", "fallT", "lives",
  "diving", "falling", "sliding", "onGround", "onIce", "ballistic"];

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const pack = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? r3(v) : v ?? null);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

/** One character as a compact array. */
export function encodeBody(b) {
  let flags = 0;
  BODY_FLAG.forEach((f, k) => { if (b[f]) flags |= 1 << k; });
  return [...BODY_NUM.map((f) => (f === "fx" || f === "fy" ? r3(b[f] || 0) : r1(b[f] || 0))), flags];
}

/** The array from encodeBody back into an object. */
export function decodeBody(row) {
  const out = {};
  BODY_NUM.forEach((f, k) => { out[f] = typeof row[k] === "number" ? row[k] : 0; });
  const flags = row[BODY_NUM.length] | 0;
  BODY_FLAG.forEach((f, k) => { out[f] = !!(flags & (1 << k)); });
  return out;
}

/** Everything a watching browser needs to draw this moment of the round. */
export function makeSnapshot(world, index, events) {
  const o = {};
  for (const [key, fields] of Object.entries(DYNAMIC)) {
    if (world[key].length) o[key] = world[key].map((it) => fields.map((f) => pack(it[f])));
  }
  const tiles = [];
  if (world.tiles) {
    world.tiles.list.forEach((t, i) => {
      if (t.state !== "solid") tiles.push([i, TILE_STATE[t.state], r3(t.t), r3(t.max || 0), r3(t.goneT)]);
    });
  }
  return {
    t: "snap", i: index, wt: r3(performance.now() / 1000), s: world.status, cd: r3(world.countdown), tm: r3(world.time), ck: r3(world.clock),
    ar: r1(world.arenaR), q: world.qualify,
    b: world.bodies.map(encodeBody),
    o,
    r: world.rollers.map((r) => [r.id, r1(r.x), r1(r.y), r1(r.vx), r1(r.vy), r.r, r3(r.rot)]),
    m: world.meteors.map((m) => [r1(m.x), r1(m.y), m.r, r3(m.t), m.T]),
    lg: world.logs.map((l) => [l.id, r1(l.y), l.x0, l.x1, l.r, r3(l.rot), l.speed]),
    tl: tiles,
    f: world.finishers,
    res: world.result,
    ev: events,
  };
}

/**
 * Keeps a steady "playback time" for a stream of timestamped updates from
 * another computer. It learns the offset between that computer's clock and
 * ours from when updates arrive, and stays a little behind the newest update
 * so there is always one either side to blend between. The buffer grows when
 * updates arrive unevenly and shrinks again when the connection is steady.
 * Playback advances at exactly real-time speed, nudged very gently, so
 * movement never speeds up or slows down in visible jerks.
 */
export class Timeline {
  constructor(interval = SNAP_EVERY) {
    this.interval = interval;  // expected time between updates
    this.offset = null;        // their clock minus ours, for the fastest arrivals
    this.late = 0;             // recent worst lateness (seconds), decays slowly
    this.t = null;             // playback time on their clock
    this.last = null;          // our clock at the previous step
  }

  /** An update stamped `remoteT` (seconds, their clock) arrived at `localT` (ours). */
  arrive(remoteT, localT) {
    const s = remoteT - localT;
    if (this.offset === null) { this.offset = s; return; }
    if (s > this.offset) this.offset = s;                 // quickest arrival yet
    else this.offset += (s - this.offset) * 0.002;        // follow clock drift slowly
    this.late = Math.max(this.offset - s, this.late * 0.995);
  }

  /** How far behind their newest time we play: one update gap plus room for jitter. */
  get delay() {
    return Math.min(0.35, Math.max(0.05, this.interval + this.late * 1.25 + 0.012));
  }

  /** Playback time for our clock `localT` (call once per frame). */
  step(localT) {
    const target = localT + this.offset - this.delay;
    if (this.t === null || Math.abs(target - this.t) > 0.5) this.t = target;
    else {
      this.t += localT - this.last;              // real-time speed...
      this.t += (target - this.t) * 0.03;        // ...with a very gentle correction
    }
    this.last = localT;
    return this.t;
  }
}

/** Find the two updates around time t in a time-sorted buffer, and how far between them t is. */
function bracket(buf, t) {
  let i = 0;
  while (i < buf.length - 2 && buf[i + 1].wt <= t) i++;
  const a = buf[i], b = buf[Math.min(i + 1, buf.length - 1)];
  const span = b.wt - a.wt;
  const u = span > 0 ? Math.max(0, Math.min(1, (t - a.wt) / span)) : 1;
  return [i, a, b, u];
}

/**
 * Plays the host's snapshots back into this browser's World (see Timeline).
 * Everyone, the host included, sees the round this way.
 */
export class Mirror {
  constructor(world, ownId) {
    this.world = world;
    this.ownId = ownId;
    this.buf = [];
    this.time = new Timeline();
    this.emitted = -Infinity;  // newest snapshot whose events were played
    this.started = false;
  }

  push(snap, now = performance.now() / 1000) {
    const last = this.buf[this.buf.length - 1];
    if (last && snap.wt <= last.wt) return; // out of order / duplicate
    snap.bd = snap.b.map(decodeBody);       // decode once, not every frame
    this.buf.push(snap);
    this.time.arrive(snap.wt, now);
  }

  /** Write the blended state for this moment into the World. Returns false before the first snapshot. */
  frame(now = performance.now() / 1000) {
    const buf = this.buf;
    if (!buf.length) return false;
    const t = this.time.step(now);
    const [i, s0, s1, u] = bracket(buf, t);
    this._apply(s0, s1, u);
    // Play the effects (jumps, hits, finishes...) of every snapshot we've
    // reached; after a long pause (hidden tab) skip stale ones instead of
    // replaying a pile of them at once.
    for (const s of buf) {
      if (s.wt > t) break;
      if (s.wt <= this.emitted) continue;
      this.emitted = s.wt;
      const stale = t - s.wt > 1;
      for (const e of s.ev || []) {
        if (e.id === this.ownId && LOCAL_EVENTS.has(e.type)) continue;
        if (stale && e.type !== "end" && e.type !== "go" && e.type !== "finish" && e.type !== "eliminated") continue;
        this.world.events.push(e);
      }
    }
    if (i > 0) buf.splice(0, i); // keep s0 onwards
    this.started = true;
    return true;
  }

  get delay() { return this.time.delay; }

  _apply(s0, s1, u) {
    const w = this.world;
    const near = u < 0.5 ? s0 : s1;
    w.status = near.s;
    w.countdown = lerp(s0.cd, s1.cd, u);
    w.time = lerp(s0.tm, s1.tm, u);
    w.clock = lerp(s0.ck, s1.ck, u);
    w.arenaR = lerp(s0.ar, s1.ar, u);
    w.qualify = s1.q;
    w.finishers = near.f || [];
    if (!w.result && (s1.res || s0.res) && w.status === "ended") {
      const res = s1.res || s0.res;
      const mine = w.human && res.players ? res.players[w.human.id] : null;
      w.result = { ...res, playerQualified: !!mine?.qualified, place: mine?.place ?? null, time: mine?.time ?? res.time ?? w.time };
    }

    const own = w.bodies.find((b) => b.id === this.ownId);
    w.bodies.forEach((b, k) => {
      const A = s0.bd[k], C = s1.bd[k];
      if (!A || !C) return;
      if (b === own) {
        // Our own character moves here; take only the host's verdicts.
        const host = C;
        if (host.crown) b.crown = true;
        if (host.finished && !b.finished) { b.finished = true; b.finishTime = host.finishTime; }
        if (host.eliminated && host.hidden && !b.eliminated) { b.eliminated = true; b.hidden = true; }
        return;
      }
      // Teleports (respawning at a checkpoint) jump straight there instead of sliding.
      const jump = Math.abs(A.x - C.x) + Math.abs(A.y - C.y) > 160;
      for (const f of Object.keys(C)) {
        b[f] = BLEND.has(f) && !jump ? lerp(A[f], C[f], u) : (u < 0.5 ? A[f] : C[f]);
      }
      b.px = b.x; b.py = b.y; b.pz = b.z;
    });

    for (const [key, fields] of Object.entries(DYNAMIC)) {
      const r0 = s0.o[key], r1_ = s1.o[key];
      if (!r0 || !r1_) continue;
      const prev = PREVIOUS[key];
      w[key].forEach((it, n) => {
        const a = r0[n], c = r1_[n];
        if (!a || !c) return;
        const old = key === "movers" ? it.cx : key === "discs" ? it.angle : null;
        fields.forEach((f, k) => {
          if (c[k] === null) return; // not used by this obstacle
          if (key === "doors") it[f] = it[f] || !!c[k]; // a door never closes again (and we may have opened it first)
          else if (STEPPED.has(f)) it[f] = FLAGS.has(f) ? !!(u < 0.5 ? a[k] : c[k]) : (u < 0.5 ? a[k] : c[k]);
          else if (f === "aim") it[f] = lerpAngle(a[k], c[k], u);
          else it[f] = lerp(a[k], c[k], u);
        });
        if (prev) for (const [cur, old_] of prev) it[old_] = it[cur];
        // Moving platforms and spinning discs carry our own character along.
        if (own && old !== null && own.z <= 0 && !own.falling && !own.eliminated) this._carry(key, it, old, own);
      });
    }

    const was = new Map(s0.r.map((r) => [r[0], r]));
    w.rollers = s1.r.map(([id, x, y, vx, vy, r, rot]) => {
      const p = was.get(id);
      const bx = p ? lerp(p[1], x, u) : x, by = p ? lerp(p[2], y, u) : y;
      return { id, x: bx, y: by, px: bx, py: by, vx, vy, r, rot: p ? lerp(p[6], rot, u) : rot, life: 1 };
    });
    w.meteors = near.m.map(([x, y, r, t, T]) => ({ x, y, r, t, T }));
    const oldLogs = new Map((s0.lg || []).map((l) => [l[0], l]));
    w.logs = (s1.lg || []).map(([id, y, x0, x1, r, rot, speed]) => {
      const p = oldLogs.get(id);
      const ly = p ? lerp(p[1], y, u) : y;
      return { id, y: ly, py: ly, x0, x1, r, rot: p ? lerp(p[5], rot, u) : rot, speed };
    });

    if (w.tiles) {
      // Use the older snapshot: a tile never vanishes under you before you see it go.
      const list = w.tiles.list;
      const seen = new Set();
      for (const [n, st, t, max, goneT] of s0.tl) {
        const tile = list[n];
        if (!tile) continue;
        seen.add(n);
        tile.state = TILE_NAME[st];
        tile.t = t;
        tile.max = max;
        tile.goneT = goneT;
      }
      list.forEach((tile, n) => { if (!seen.has(n)) tile.state = "solid"; });
    }
  }

  _carry(key, it, old, b) {
    if (key === "movers") {
      const dx = it.cx - old;
      if (dx && Math.abs(b.x - old) <= it.w / 2 && b.y >= it.y && b.y <= it.y + it.h) { b.x += dx; b.px += dx; }
    } else {
      const da = it.angle - old;
      const rx = b.x - it.x, ry = b.y - it.y;
      if (da && rx * rx + ry * ry <= it.r * it.r) {
        const c = Math.cos(da), s = Math.sin(da);
        const nx = it.x + rx * c - ry * s, ny = it.y + rx * s + ry * c;
        b.px += nx - b.x; b.py += ny - b.y;
        b.x = nx; b.y = ny;
      }
    }
  }
}

/**
 * Host side: one player's reports, played back smoothly (see Timeline) so the
 * host's snapshots show them moving evenly however unevenly reports arrive.
 */
export class RemoteTrack {
  constructor() {
    this.buf = [];
    this.time = new Timeline(STATE_EVERY);
    this.emitted = -Infinity;
  }

  push(t, row, ev, now) {
    const last = this.buf[this.buf.length - 1];
    if (typeof t !== "number" || (last && t <= last.wt)) return;
    this.buf.push({ wt: t, body: decodeBody(row), ev: Array.isArray(ev) ? ev : [] });
    if (this.buf.length > 90) this.buf.shift();
    this.time.arrive(t, now);
  }

  /** The player's blended state for this moment, and any effects reached. */
  sample(now) {
    if (!this.buf.length) return null;
    const t = this.time.step(now);
    const [i, a, b, u] = bracket(this.buf, t);
    const A = a.body, B = b.body;
    const out = { ...(u < 0.5 ? A : B) };
    const jump = Math.abs(A.x - B.x) + Math.abs(A.y - B.y) > 160;
    if (!jump) for (const f of BLEND) out[f] = lerp(A[f], B[f], u);
    // Being knocked out must never be missed, even between samples.
    out.eliminated = A.eliminated || B.eliminated;
    const events = [];
    for (const r of this.buf) {
      if (r.wt > t) break;
      if (r.wt <= this.emitted) continue;
      this.emitted = r.wt;
      events.push(...r.ev);
    }
    if (i > 0) this.buf.splice(0, i);
    return { body: out, events };
  }
}
