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

// Moving obstacles: the fields that change during a round.
const DYNAMIC = {
  spinners: ["angle", "arms", "arm", "omega"],
  sliders: ["cx", "vx"],
  bumpers: ["pulse"],
  zones: ["active", "angle", "fx", "fy"],
  pads: ["pulse"],
  pendulums: ["bx", "vx"],
  movers: ["cx", "dx"],
  discs: ["angle"],
  pistons: ["cx", "vx"],
  popups: ["rise", "up"],
  cannons: ["aim", "flash"],
};
// Fields that are never blended (counts and on/off states).
const STEPPED = new Set(["arms", "active", "up"]);
// Fields the renderers interpolate from ("previous" copies): we set them equal
// to the current value, because the Mirror already blends between snapshots.
const PREVIOUS = {
  spinners: ["angle", "pangle"], sliders: ["cx", "pcx"], pendulums: ["bx", "pbx"],
  movers: ["cx", "pcx"], discs: ["angle", "pangle"], pistons: ["cx", "pcx"],
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
    t: "snap", i: index, s: world.status, cd: r3(world.countdown), tm: r3(world.time), ck: r3(world.clock),
    ar: r1(world.arenaR), q: world.qualify,
    b: world.bodies.map(encodeBody),
    o,
    r: world.rollers.map((r) => [r.id, r1(r.x), r1(r.y), r1(r.vx), r1(r.vy), r.r, r3(r.rot)]),
    m: world.meteors.map((m) => [r1(m.x), r1(m.y), m.r, r3(m.t), m.T]),
    tl: tiles,
    f: world.finishers,
    res: world.result,
    ev: events,
  };
}

/**
 * Plays the host's snapshots back into this browser's World, a little behind
 * real time so there is always a snapshot either side to blend between. This
 * hides network hiccups: everything moves smoothly even if snapshots arrive
 * unevenly.
 */
export class Mirror {
  /** @param delay seconds to stay behind the newest snapshot */
  constructor(world, ownId, delay = 0.1) {
    this.world = world;
    this.ownId = ownId;
    this.delay = delay;
    this.buf = [];
    this.clock = null;     // the host-clock moment being shown
    this.emitted = -1;     // newest snapshot whose events were played
    this.started = false;
  }

  push(snap) {
    const last = this.buf[this.buf.length - 1];
    if (last && snap.ck <= last.ck) return; // out of order / duplicate
    this.buf.push(snap);
    if (this.clock === null) this.clock = snap.ck - this.delay;
  }

  /** Advance by dt and write the blended state into the World. Returns false before the first snapshot. */
  frame(dt) {
    const buf = this.buf;
    if (!buf.length) return false;
    const newest = buf[buf.length - 1];
    // Follow the host's clock: run a bit faster when behind, slower when ahead
    // (also copes with the host fast-forwarding the end of a race).
    const err = newest.ck - this.delay - this.clock;
    if (Math.abs(err) > 1.5) this.clock = newest.ck - this.delay;
    else this.clock += dt * Math.max(0.3, Math.min(5, 1 + err * 4));

    let i = 0;
    while (i < buf.length - 2 && buf[i + 1].ck <= this.clock) i++;
    const s0 = buf[i], s1 = buf[Math.min(i + 1, buf.length - 1)];
    const span = s1.ck - s0.ck;
    const u = span > 0 ? Math.max(0, Math.min(1, (this.clock - s0.ck) / span)) : 1;
    this._apply(s0, s1, u);
    // Play the effects (jumps, hits, finishes...) of every snapshot we've reached.
    for (const s of buf) {
      if (s.ck > this.clock) break;
      if (s.ck <= this.emitted) continue;
      this.emitted = s.ck;
      for (const e of s.ev || []) {
        if (e.id === this.ownId && LOCAL_EVENTS.has(e.type)) continue;
        this.world.events.push(e);
      }
    }
    if (i > 0) buf.splice(0, i); // keep s0 onwards
    this.started = true;
    return true;
  }

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
      const a = s0.b[k], c = s1.b[k];
      if (!a || !c) return;
      if (b === own) {
        // Our own character moves here; take only the host's verdicts.
        const host = decodeBody(c);
        if (host.crown) b.crown = true;
        if (host.finished && !b.finished) { b.finished = true; b.finishTime = host.finishTime; }
        if (host.eliminated && host.hidden && !b.eliminated) { b.eliminated = true; b.hidden = true; }
        return;
      }
      const A = decodeBody(a), C = decodeBody(c);
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
          if (STEPPED.has(f)) it[f] = f === "arms" ? (u < 0.5 ? a[k] : c[k]) : !!(u < 0.5 ? a[k] : c[k]);
          else if (f === "aim") it[f] = lerpAngle(a[k], c[k], u);
          else it[f] = lerp(a[k], c[k], u);
        });
        if (prev) it[prev[1]] = it[prev[0]];
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
