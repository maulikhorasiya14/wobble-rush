// One round of play: physics, obstacles and the round's rules.
// All tuning numbers and layouts come from the Python server (/api/levels).
import { botIntent, makeBrain } from "./bots.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const NO_INTENT = Object.freeze({ mx: 0, my: 0, jump: false, dive: false });

export class World {
  /**
   * @param level   level data from the server
   * @param physics physics constants from the server
   * @param roster  [{id, name, color, isHuman, skill}]
   * @param opts    {qualify, countdown, tutorial, localId, multiplayer}
   *   localId:     which body this browser controls (defaults to the human)
   *   multiplayer: several people play; set their moves in `intents`
   */
  constructor(level, physics, roster, opts = {}) {
    this.level = level;
    this.P = physics;
    this.R = physics.radius;
    this.type = level.type;
    this.tutorial = !!opts.tutorial;
    this.multiplayer = !!opts.multiplayer;
    this.intents = new Map(); // body id -> intent, for people playing from other browsers
    // Multiplayer host: people's characters move in their own browsers, which
    // report where they are; this World only runs the rules around them.
    this.external = new Set(opts.external || []);
    this.rollerId = 0;
    this.qualify = opts.qualify ?? roster.length;
    this.countdown = opts.countdown ?? 3;
    this.status = this.countdown > 0 ? "countdown" : "running";
    this.time = 0;   // seconds since GO
    this.clock = 0;  // seconds since creation (animations)
    this.events = [];
    this.result = null;
    this.finishers = [];
    this.eliminatedOrder = [];

    this.spinners = (level.spinners || []).map((s) => ({
      ...s, angle: s.angle || 0, omega: s.speed, arms: s.arms || 2,
    }));
    this.sliders = (level.sliders || []).map((s) => ({
      ...s, cx: s.x + s.amp * Math.sin(s.phase || 0), vx: 0,
    }));
    this.bumpers = (level.bumpers || []).map((b) => ({ ...b, pulse: 0 }));
    // Newer obstacle types (see levels.py): belts/ice/wind zones, bounce pads,
    // swinging hammers, rolling balls and moving platforms.
    this.zones = (level.zones || []).map((z) => ({
      ...z, active: z.type !== "wind" && z.type !== "gust",
      ...(z.type === "gust" ? { fx: 0, fy: 0, angle: 0 } : {}),  // calm until the round starts
    }));
    this.pads = (level.pads || []).map((p) => ({ ...p, pulse: 0 }));
    this.pendulums = (level.pendulums || []).map((p) => {
      const bx = p.x + p.amp * Math.sin(p.phase || 0);
      return { ...p, bx, pbx: bx, vx: 0 };
    });
    this.movers = (level.movers || []).map((m) => {
      const cx = m.x + m.amp * Math.sin(m.phase || 0);
      return { ...m, cx, pcx: cx, dx: 0 };
    });
    this.rollerCfg = level.rollers || [];
    this.rollerT = this.rollerCfg.map((_, i) => i * 0.3);
    this.rollers = []; // every rolling/flying ball: {x, y, vx, vy, r, life}
    this.discs = (level.discs || []).map((d) => ({ ...d, angle: 0, pangle: 0 }));
    this.pistons = (level.pistons || []).map((p) => ({ ...p, cx: p.x0, pcx: p.x0, vx: 0, out: 0 }));
    this.popups = (level.popups || []).map((p) => ({ ...p, rise: 0, up: false }));
    this.cannons = (level.cannons || []).map((c) => {
      // Race cannons ("lane" cannons) sit at the course edge and fire straight across.
      if (c.lane) return { ...c, t: c.phase || 0, flash: 0 };
      const A = level.arena;
      const x = A.x + Math.cos((c.angle * Math.PI) / 180) * c.dist, y = A.y + Math.sin((c.angle * Math.PI) / 180) * c.dist;
      return { ...c, x, y, t: c.phase, aim: Math.atan2(A.y - y, A.x - x), flash: 0 };
    });
    // Each round shuffles which doors are real and where the hidden tile path runs.
    // Everyone in a multiplayer round gets the same seed, so the same layout.
    const rng = seeded(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    this.doors = buildDoors(level.doors || [], rng);
    this.ghosts = buildGhosts(level.ghosts || [], rng);
    this.tilts = (level.tilts || []).map((t) => ({ ...t, angle: 0, vel: 0 }));
    this.logCfg = level.logs || [];
    this.logT = this.logCfg.map((c, i) => c.phase ?? i * 0.7);
    this.logs = []; // rolling logs: {id, y, x0, x1, r, speed, rot}
    this.meteors = []; // incoming strikes on Meteor Meadow: {x, y, r, t, T}
    this.meteorT = level.tiles?.meteors?.start ?? 0;
    this.checkpoints = (level.checkpoints || []).slice().sort((a, b) => b.y - a.y);
    this.arenaR = level.arena ? level.arena.r : 0;
    this.tiles = level.tiles ? buildTiles(level.tiles) : null;
    this.autoCrackT = 0;

    const spawns = this._spawnPoints(roster.length);
    this.bodies = roster.map((p, i) => this._makeBody(p, spawns[i]));
    this.human = opts.localId !== undefined
      ? this.bodies.find((b) => b.id === opts.localId) || null
      : this.bodies.find((b) => b.isHuman) || null;
  }

  // ---------------------------------------------------------------- setup

  _makeBody(p, sp) {
    const skill = Math.min(p.skill ?? Math.random(), this.level.bot_skill_max ?? 1);
    return {
      id: p.id, name: p.name, color: p.color, isHuman: !!p.isHuman,
      x: sp.x, y: sp.y, vx: 0, vy: 0, z: 0, vz: 0,
      fx: 0, fy: -1, stun: 0, diving: false,
      falling: false, fallT: 0, finished: false, finishTime: 0, hideAt: 0,
      eliminated: false, hidden: false, checkpoint: -1, offFloorT: 0, onGround: true,
      px: sp.x, py: sp.y, pz: 0,
      sliding: false, squash: 0, walk: Math.random() * 10, hitT: 0, crown: false,
      lives: p.isHuman ? (this.level.human_lives ?? 0) : 0,
      speedMul: p.isHuman ? 1 : (0.84 + 0.16 * skill) * (this.level.bot_pace ?? 1),
      brain: p.isHuman ? null : makeBrain(skill),
    };
  }

  _spawnPoints(n) {
    const L = this.level;
    const pts = [];
    if (this.type === "race") {
      const s = L.spawn;
      const cols = Math.min(n, n > 12 ? 7 : 6);
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        pts.push({ x: s.x + (c + 0.5) * (s.w / cols), y: s.y + (r + 0.5) * (s.h / rows) });
      }
      shuffle(pts);
    } else if (this.tiles) {
      const T = this.tiles, cfg = T.cfg;
      const rr = (cfg.radius || Math.min(cfg.cols, cfg.rows) * cfg.pitch / 2) * 0.55;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const px = T.cx + Math.cos(a) * rr, py = T.cy + Math.sin(a) * rr;
        let t = this.tileAt(px, py);
        if (!t) t = T.list.reduce((m, q) => (Math.hypot(q.x - px, q.y - py) < Math.hypot(m.x - px, m.y - py) ? q : m));
        pts.push({ x: t.x, y: t.y });
      }
    } else if (L.arena) {
      const A = L.arena;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + TAU / (2 * n) + Math.PI / 2;
        pts.push({ x: A.x + Math.cos(a) * A.r * 0.5, y: A.y + Math.sin(a) * A.r * 0.5 });
      }
    }
    return pts;
  }

  // ---------------------------------------------------------------- queries

  onFloor(x, y, ahead = 0) {
    for (const f of this.level.floors || []) {
      if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return true;
    }
    if (this.moverAt(x, y, ahead)) return true;
    for (const d of this.discs) {
      const dx = x - d.x, dy = y - d.y;
      if (dx * dx + dy * dy <= d.r * d.r) return true;
    }
    const A = this.level.arena;
    if (A) {
      const dx = x - A.x, dy = y - A.y;
      if (dx * dx + dy * dy <= this.arenaR * this.arenaR) return true;
    }
    if (this.tiles) {
      const t = this.tileAt(x, y);
      if (t && t.state !== "gone") return true;
    }
    for (const g of this.ghosts) {
      if (g.st !== 2 && x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return true;
    }
    for (const t of this.tilts) {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return true;
    }
    return false;
  }

  ghostAt(x, y) {
    for (const g of this.ghosts) if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return g;
    return null;
  }

  tiltAt(x, y) {
    for (const t of this.tilts) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t;
    return null;
  }

  /** The moving platform under (x, y), `ahead` seconds from now. */
  moverAt(x, y, ahead = 0) {
    for (const m of this.movers) {
      const cx = ahead ? m.x + m.amp * Math.sin((this.time + ahead) * m.speed + (m.phase || 0)) : m.cx;
      if (Math.abs(x - cx) <= m.w / 2 && y >= m.y && y <= m.y + m.h) return m;
    }
    return null;
  }

  padAt(x, y) {
    for (const p of this.pads) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
    return null;
  }

  /** Floor that will still be there `ahead` seconds from now (crumbling tiles may not be). */
  safeAt(x, y, ahead = 0) {
    if (!this.onFloor(x, y, ahead)) return false;
    const g = this.ghosts.length ? this.ghostAt(x, y) : null;
    if (g && g.st === 1 && g.t <= ahead + 0.15) return false;
    if (!this.tiles || (this.level.floors || []).length) return true;
    const t = this.tileAt(x, y);
    return !!t && (t.state === "solid" || t.t > ahead + 0.15);
  }

  tileAt(x, y) {
    const T = this.tiles, cfg = T.cfg;
    const at = (c, r) => (c < 0 || r < 0 || c >= cfg.cols || r >= cfg.rows ? null : T.grid[r * cfg.cols + c]);
    if (!T.hex) {
      return at(Math.floor((x - cfg.x) / cfg.pitch), Math.floor((y - cfg.y) / cfg.pitch));
    }
    // Hex grid: find the nearest centre, then check the point is inside that hexagon.
    const r0 = Math.floor((y - cfg.y) / T.rowH);
    let best = null, bestD = Infinity, bc = 0, br = 0;
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const shift = r % 2 ? 0.5 : 0;
      const c0 = Math.round((x - cfg.x) / cfg.pitch - 0.5 - shift);
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        const p = T.centre(c, r);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) { bestD = d; bc = c; br = r; best = p; }
      }
    }
    const R = cfg.pitch / Math.sqrt(3); // circumradius
    const dx = Math.abs(x - best.x), dy = Math.abs(y - best.y);
    if (dx > cfg.pitch / 2 || dy > R - dx / Math.sqrt(3)) return null;
    return at(bc, br);
  }

  /** Is (x, y) inside a tall obstacle, now or `ahead` seconds from now? */
  solidAt(x, y, ahead = 0) {
    const R = this.R;
    for (const w of this.sliders) {
      const cx = w.x + w.amp * Math.sin((this.time + ahead) * w.speed + (w.phase || 0));
      if (Math.abs(x - cx) < w.w / 2 + R && Math.abs(y - w.y) < w.h / 2 + R) return true;
    }
    for (const b of this.bumpers) {
      const dx = x - b.x, dy = y - b.y, rr = b.r + R;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    for (const p of this.pendulums) {
      const bx = p.x + p.amp * Math.sin((this.time + ahead) * p.speed + (p.phase || 0));
      const dx = x - bx, dy = y - p.y, rr = p.r + R + 10;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    for (const r of this.rollers) {
      const dx = x - (r.x + r.vx * ahead), dy = y - (r.y + r.vy * ahead), rr = r.r + R + 10;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    for (const p of this.pistons) {
      const cx = this._pistonX(p, this.time + ahead);
      if (Math.abs(x - cx) < p.w / 2 + R && Math.abs(y - p.y) < p.h / 2 + R) return true;
    }
    for (const p of this.popups) {
      if (this._popupUp(p, this.time + ahead) && x > p.x - R && x < p.x + p.w + R && y > p.y - R && y < p.y + p.h + R) return true;
    }
    // Doors everyone has seen are real (marked with an X). Untried doors might be fakes.
    for (const d of this.doors) {
      if (!d.broken && d.known && x > d.x - R && x < d.x + d.w + R && y > d.y - R && y < d.y + d.h + R) return true;
    }
    return false;
  }

  /** Piston block centre at time t: punch out fast, hold, pull back slowly, rest. */
  _pistonX(p, t) {
    const u = ((((t + p.phase) % p.period) + p.period) % p.period) / p.period;
    let e;
    if (u < 0.12) e = Math.sin((u / 0.12) * Math.PI / 2);
    else if (u < 0.4) e = 1;
    else if (u < 0.8) e = 1 - (u - 0.4) / 0.4;
    else e = 0;
    return p.x0 + p.dir * p.reach * e;
  }

  _popupUp(p, t) {
    return ((((t + p.phase) % p.period) + p.period) % p.period) < p.period * p.duty;
  }

  aliveBodies() {
    return this.bodies.filter((b) => !b.eliminated);
  }

  // ---------------------------------------------------------------- update

  update(dt, humanIntent = NO_INTENT) {
    this.clock += dt;
    // Remember where everything was so the renderer can interpolate between steps.
    for (const b of this.bodies) { b.px = b.x; b.py = b.y; b.pz = b.z; }
    for (const s of this.spinners) s.pangle = s.angle;
    for (const w of this.sliders) w.pcx = w.cx;
    for (const b of this.bodies) b.squash = Math.max(0, b.squash - dt * 4);

    if (this.status === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.status = "running";
        this.events.push({ type: "go" });
      }
      return;
    }
    if (this.status === "running") this.time += dt;

    this._updateObstacles(dt);
    for (const b of this.bodies) {
      if (b.eliminated || b.hidden || this.external.has(b.id)) continue;
      let it = NO_INTENT;
      if (this.status === "running" && !b.finished) {
        if (!b.isHuman) it = botIntent(b, this, dt);
        else if (b === this.human) it = humanIntent;
        else it = this.intents.get(b.id) || NO_INTENT;
      }
      this._applyZones(b, dt);
      this._control(b, it, dt);
      this._integrate(b, dt);
      this._checkPad(b);
    }
    this._collideObstacles();
    this._collideBodies();
    for (const b of this.bodies) if (!this.external.has(b.id)) this._floorCheck(b, dt);
    if (this.tiles) this._updateTiles(dt);
    if (this.ghosts.length) this._updateGhosts(dt);
    // People moved by other browsers still break doors and get spotted on real ones.
    if (this.external.size && this.doors.length) {
      for (const b of this._active()) if (this.external.has(b.id)) this._touchDoors(b, false);
    }
    if (this.status === "running") this._rules();
  }

  _updateObstacles(dt) {
    const A = this.level.arena;
    if (A && this.time > A.shrink_after) {
      this.arenaR = Math.max(A.min_r, this.arenaR - A.shrink_rate * dt);
    }
    for (const s of this.spinners) {
      if (s.ramp) {
        s.omega = Math.sign(s.speed) * Math.min(s.max_speed, Math.abs(s.speed) + s.ramp * this.time);
      }
      if (s.extra_arms_after && this.time > s.extra_arms_after && s.arms < 4) s.arms = 4;
      if (s.follow_arena) s.arm = this.arenaR + 6;
      s.angle += s.omega * dt;
    }
    for (const w of this.sliders) {
      const nx = w.x + w.amp * Math.sin(this.time * w.speed + (w.phase || 0));
      w.vx = (nx - w.cx) / dt;
      w.cx = nx;
    }
    for (const b of this.bumpers) b.pulse = Math.max(0, b.pulse - dt * 3);
    for (const p of this.pads) p.pulse = Math.max(0, p.pulse - dt * 3);

    // Moving platforms carry whoever is standing on them.
    if (this.movers.length) {
      const riders = [];
      for (const b of this._active()) {
        if (b.z <= 0 && !this.external.has(b.id)) { const m = this.moverAt(b.x, b.y); if (m) riders.push([b, m]); }
      }
      for (const m of this.movers) {
        m.pcx = m.cx;
        m.cx = m.x + m.amp * Math.sin(this.time * m.speed + (m.phase || 0));
        m.dx = m.cx - m.pcx;
      }
      for (const [b, m] of riders) { b.x += m.dx; b.px += m.dx; }
    }
    for (const p of this.pendulums) {
      p.pbx = p.bx;
      p.bx = p.x + p.amp * Math.sin(this.time * p.speed + (p.phase || 0));
      p.vx = (p.bx - p.pbx) / dt;
    }
    // Rolling balls: spawn at the top of their lane and roll down toward the start.
    this.rollerCfg.forEach((c, i) => {
      this.rollerT[i] -= dt;
      if (this.rollerT[i] <= 0) {
        this.rollerT[i] = c.every * (0.7 + Math.random() * 0.6);
        const x = rand(c.x0, c.x1);
        this.rollers.push({ x, y: c.y0, px: x, py: c.y0, vx: 0, vy: c.speed, r: c.r, rot: 0,
          life: (c.y1 - c.y0) / c.speed, id: ++this.rollerId });
      }
    });
    for (const r of this.rollers) {
      r.px = r.x; r.py = r.y;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.rot += (Math.hypot(r.vx, r.vy) * dt) / r.r;
      r.life -= dt;
    }
    this.rollers = this.rollers.filter((r) => r.life > 0);
    // Cannons fire across the arena, faster as the round goes on.
    this._updateTilts(dt);
    this._updateLogs(dt);
    for (const c of this.cannons) {
      c.flash = Math.max(0, c.flash - dt * 3);
      c.t -= dt;
      if (c.t <= 0 && c.lane) {
        // Race cannon: a ball straight across the course.
        c.t = c.every * (0.85 + Math.random() * 0.3);
        const ux = Math.cos(c.aim), uy = Math.sin(c.aim);
        this.rollers.push({ x: c.x + ux * 40, y: c.y + uy * 40, px: c.x, py: c.y, vx: ux * c.speed, vy: uy * c.speed,
          r: c.r, rot: 0, life: c.range / c.speed, push: c.push ?? 1, id: ++this.rollerId });
        c.flash = 1;
        this.events.push({ type: "cannon", x: c.x, y: c.y });
      } else if (c.t <= 0) {
        c.t = c.every * Math.max(0.4, 1 - (this.level.cannon_ramp || 0) * this.time) * (0.8 + Math.random() * 0.4);
        const A = this.level.arena;
        const tx = A.x + (Math.random() - 0.5) * 2 * c.spread, ty = A.y + (Math.random() - 0.5) * 2 * c.spread;
        c.aim = Math.atan2(ty - c.y, tx - c.x);
        const ux = Math.cos(c.aim), uy = Math.sin(c.aim);
        this.rollers.push({ x: c.x + ux * 40, y: c.y + uy * 40, px: c.x, py: c.y, vx: ux * c.speed, vy: uy * c.speed,
          r: c.r, rot: 0, life: (c.dist * 2 + 100) / c.speed, push: c.push ?? 1, id: ++this.rollerId });
        c.flash = 1;
        this.events.push({ type: "cannon", x: c.x, y: c.y });
      }
    }
    // Spinning discs carry whoever stands on them round with them.
    for (const d of this.discs) {
      d.pangle = d.angle;
      const da = d.speed * dt;
      d.angle += da;
      const c = Math.cos(da), sn = Math.sin(da);
      for (const b of this._active()) {
        if (b.z > 0 || this.external.has(b.id)) continue;
        const rx = b.x - d.x, ry = b.y - d.y;
        if (rx * rx + ry * ry > d.r * d.r) continue;
        const nx = d.x + rx * c - ry * sn, ny = d.y + rx * sn + ry * c;
        b.px += nx - b.x; b.py += ny - b.y;
        b.x = nx; b.y = ny;
      }
    }
    for (const p of this.pistons) {
      p.pcx = p.cx;
      p.cx = this._pistonX(p, this.time);
      p.vx = (p.cx - p.pcx) / dt;
    }
    for (const p of this.popups) {
      p.up = this._popupUp(p, this.time);
      p.rise = Math.max(0, Math.min(1, p.rise + (p.up ? dt : -dt) * 5));
    }
    for (const z of this.zones) {
      if (z.type === "wind") z.active = ((this.time + (z.phase || 0)) % z.period) < z.period * z.duty;
      if (z.type === "gust") {
        const cycle = Math.floor((this.time + z.phase) / z.period);
        const into = (this.time + z.phase) - cycle * z.period;
        const ang = cycle * 2.39996 + 0.7; // a new direction every cycle
        const str = Math.min(z.max, z.base + z.ramp * this.time);
        z.angle = ang;
        z.active = into >= z.calm && this.status === "running";
        z.fx = Math.cos(ang) * str;
        z.fy = Math.sin(ang) * str;
      }
    }
  }

  /** Belts and wind push you along; ice makes you slide. */
  _applyZones(b, dt) {
    b.onIce = false;
    if (this.tilts.length && !b.falling && b.z <= 0) {
      const t = this.tiltAt(b.x, b.y);
      if (t) b.x += t.angle * (t.slide ?? 170) * dt; // slide downhill
    }
    if (!this.zones.length || b.falling) return;
    for (const z of this.zones) {
      if (b.x < z.x || b.x > z.x + z.w || b.y < z.y || b.y > z.y + z.h) continue;
      if (z.type === "ice") { if (b.z <= 0) b.onIce = true; }
      else if ((z.type === "conveyor" && b.z <= 0) || ((z.type === "wind" || z.type === "gust") && z.active)) {
        b.x += z.fx * dt;
        b.y += z.fy * dt;
      }
    }
  }

  /** Bounce pads launch you up and across. */
  _checkPad(b) {
    if (!this.pads.length || b.falling || b.z > 0 || b.eliminated || b.hidden) return;
    const p = this.padAt(b.x, b.y);
    if (!p) return;
    b.vx = p.dx * p.speed;
    b.vy = p.dy * p.speed;
    b.vz = p.vz;
    b.z = 0.01;
    b.ballistic = true; // no steering mid-flight, so every launch lands
    b.diving = false;
    b.stun = 0;
    p.pulse = 1;
    this.events.push({ type: "pad", id: b.id, x: b.x, y: b.y });
  }

  _control(b, it, dt) {
    if (b.falling) return;
    const P = this.P;
    const ground = b.z <= 0;
    b.stun = Math.max(0, b.stun - dt);
    b.hitT = Math.max(0, b.hitT - dt);

    if (b.stun <= 0) b.sliding = false;
    if (b.ballistic && b.z > 0) return; // riding a bounce-pad launch
    if (b.stun <= 0 && !b.diving) {
      let mx = it.mx || 0, my = it.my || 0;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      const maxS = P.max_speed * b.speedMul;
      const tx = mx * maxS, ty = my * maxS;
      if (ground || m > 0.05) {
        const acc = (ground ? P.ground_accel * (b.onIce ? 0.2 : 1) : P.air_accel) * dt;
        const dx = tx - b.vx, dy = ty - b.vy, d = Math.hypot(dx, dy);
        if (d <= acc) { b.vx = tx; b.vy = ty; } else { b.vx += (dx / d) * acc; b.vy += (dy / d) * acc; }
      }
      if (m > 0.05) { b.fx = mx / Math.max(m, 1e-6); b.fy = my / Math.max(m, 1e-6); }

      // A jump press in mid-air is dropped unless it comes right before landing
      // (low and falling). Otherwise the buffered press would fire a surprise
      // second jump the moment you touch down.
      if (it.jump && !ground && (b.vz > 0 || b.z > 18)) it.usedJump = true;
      if (it.jump && ground) {
        b.vz = P.jump_speed;
        b.z = 0.01;
        it.usedJump = true;
        this.events.push({ type: "jump", id: b.id, x: b.x, y: b.y });
      } else if (it.dive) {
        b.diving = true;
        b.vx = b.fx * P.dive_speed * b.speedMul;
        b.vy = b.fy * P.dive_speed * b.speedMul;
        b.vz = Math.max(b.vz, P.dive_hop);
        b.z = Math.max(b.z, 0.01);
        it.usedDive = true;
        this.events.push({ type: "dive", id: b.id, x: b.x, y: b.y });
      }
    } else if (ground) {
      const k = Math.exp(-(b.sliding ? P.slide_friction : P.ground_friction * 0.6) * (b.onIce ? 0.25 : 1) * dt);
      b.vx *= k;
      b.vy *= k;
    }
  }

  _integrate(b, dt) {
    const P = this.P;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.falling) {
      b.vz -= P.gravity * dt;
      b.z += b.vz * dt;
      b.vx *= 0.99;
      b.vy *= 0.99;
      b.fallT += dt;
      if (b.fallT >= P.fall_time) this._fellOut(b);
      return;
    }
    if (b.z > 0 || b.vz > 0) {
      b.vz -= P.gravity * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) {
        const impact = -b.vz;
        b.z = 0;
        b.vz = 0;
        b.squash = Math.min(1, impact / 420);
        b.ballistic = false;
        if (b.diving) {
          b.diving = false;
          b.sliding = true;
          b.stun = Math.max(b.stun, P.dive_recover);
        }
        if (impact > 250) this.events.push({ type: "land", id: b.id, x: b.x, y: b.y });
      }
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (b.z <= 0 && sp > 20) b.walk += dt * sp * 0.06;
  }

  _floorCheck(b, dt) {
    if (b.falling || b.eliminated || b.hidden) return;
    if (b.z > 0) { b.offFloorT = 0; b.onGround = false; return; }
    if (this.onFloor(b.x, b.y)) { b.offFloorT = 0; b.onGround = true; return; }
    // Coyote time: a moment of grace after running off an edge (not after
    // landing on thin air, which would allow a second jump over a pit).
    b.offFloorT += dt;
    if (!b.onGround || b.offFloorT > (this.P.coyote_time || 0)) {
      b.offFloorT = 0;
      b.falling = true;
      b.fallT = 0;
      b.diving = false;
      b.vz = Math.min(b.vz, -40);
      this.events.push({ type: "fall", id: b.id, x: b.x, y: b.y });
    }
  }

  _fellOut(b) {
    b.falling = false;
    b.vx = b.vy = b.vz = 0;
    if (this.type === "race") {
      const cp = b.checkpoint >= 0 ? this.checkpoints[b.checkpoint] : null;
      if (cp) {
        b.x = cp.x + rand(-cp.spread, cp.spread);
        b.y = cp.spawn_y;
      } else {
        const s = this.level.spawn;
        b.x = rand(s.x, s.x + s.w);
        b.y = rand(s.y, s.y + s.h);
      }
      b.z = 90; // drop back in from above
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.stun = 0;
      b.fx = 0; b.fy = -1;
      this.events.push({ type: "respawn", id: b.id, x: b.x, y: b.y });
    } else if (b.lives > 0) {
      // Player assist: drop back in on a safe tile instead of being knocked out.
      b.lives--;
      const spot = this._safeSpot();
      b.x = spot.x;
      b.y = spot.y;
      b.z = 90;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.stun = 0;
      this.events.push({ type: "respawn", id: b.id, x: b.x, y: b.y });
      this.events.push({ type: "lifelost", id: b.id, lives: b.lives });
    } else {
      this.eliminate(b);
    }
  }

  /** Knock a player out of this round. */
  eliminate(b) {
    if (b.eliminated) return;
    b.eliminated = true;
    b.falling = false;
    b.z = 0;
    b.aliveAfter = this.aliveBodies().length;
    this.eliminatedOrder.push(b.id);
    this.events.push({ type: "eliminated", id: b.id, name: b.name, x: b.x, y: b.y });
  }

  /** The safest place to drop a player back in: a solid tile with solid neighbours, near the middle. */
  _safeSpot() {
    if (this.tiles) {
      const T = this.tiles, p = T.cfg.pitch;
      let best = null, bestScore = -Infinity;
      for (const t of T.list) {
        if (t.state !== "solid") continue;
        let n = 0;
        for (let k = 0; k < 6; k++) {
          const o = this.tileAt(t.x + Math.cos((k * Math.PI) / 3) * p, t.y + Math.sin((k * Math.PI) / 3) * p);
          if (o && o.state === "solid") n++;
        }
        const score = n - Math.hypot(t.x - T.cx, t.y - T.cy) / (p * 4);
        if (score > bestScore) { bestScore = score; best = t; }
      }
      if (best) return { x: best.x, y: best.y };
    }
    const A = this.level.arena;
    if (A) return { x: A.x, y: A.y + this.arenaR * 0.4 };
    return { x: this.level.bounds.w / 2, y: this.level.bounds.h / 2 };
  }

  // ---------------------------------------------------------------- collisions

  _active() {
    return this.bodies.filter((b) => !b.eliminated && !b.hidden && !b.falling);
  }

  _collideObstacles() {
    for (const b of this._active()) if (!this.external.has(b.id)) this._collideOne(b);
  }

  _collideOne(b) {
    const P = this.P, R = this.R;
    if (this.doors.length) this._touchDoors(b, true);
    for (const lg of this.logs) this._hitLog(b, lg);
    {
      for (const s of this.spinners) this._hitSpinner(b, s, P, R);
      for (const w of this.sliders) this._hitSlider(b, w, R);
      for (const p of this.pendulums) this._hitBall(b, p.bx, p.y, p.r, p.vx, 0);
      for (const r of this.rollers) this._hitBall(b, r.x, r.y, r.r, r.vx, r.vy, r.push ?? 1);
      for (const p of this.pistons) this._hitSlider(b, p, R);
      for (const p of this.popups) {
        if (p.rise > 0.5) this._hitSlider(b, { cx: p.x + p.w / 2, y: p.y + p.h / 2, w: p.w, h: p.h, vx: 0 }, R);
      }
      for (const bp of this.bumpers) {
        const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy), rr = bp.r + R;
        if (d < rr) {
          const nx = d > 1e-4 ? dx / d : 0, ny = d > 1e-4 ? dy / d : 1;
          b.x = bp.x + nx * rr;
          b.y = bp.y + ny * rr;
          b.vx = nx * (bp.power || 480);
          b.vy = ny * (bp.power || 480);
          b.diving = false;
          b.stun = Math.max(b.stun, 0.25);
          bp.pulse = 1;
          this.events.push({ type: "bump", id: b.id, x: b.x, y: b.y, dx: nx, dy: ny });
        }
      }
    }
  }

  /** Swinging hammers and rolling balls: round, tall, and they knock you flying. */
  _hitBall(b, bx, by, r, vx, vy, push = 1) {
    const R = this.R;
    const dx = b.x - bx, dy = b.y - by, d = Math.hypot(dx, dy), rr = r + R;
    if (d >= rr) return;
    const nx = d > 1e-4 ? dx / d : 0, ny = d > 1e-4 ? dy / d : 1;
    b.x = bx + nx * rr;
    b.y = by + ny * rr;
    const kx = (nx * 280 + vx * 1.3) * push, ky = (ny * 280 + vy * 1.3) * push;
    b.vx = kx;
    b.vy = ky;
    b.vz = 160;
    b.z = Math.max(b.z, 0.01);
    b.diving = false;
    b.ballistic = false;
    b.stun = 0.55;
    b.hitT = 0.3;
    const k = Math.hypot(kx, ky) || 1;
    this.events.push({ type: "hit", id: b.id, x: b.x, y: b.y, dx: kx / k, dy: ky / k });
  }

  _hitSpinner(b, s, P, R) {
    const dxc = b.x - s.x, dyc = b.y - s.y, dc = Math.hypot(dxc, dyc);
    if (dc > s.arm + R + s.thick) return;
    // Tall hub in the middle: always solid.
    const hub = (s.hub || 0) + R;
    if (dc < hub) {
      const nx = dc > 1e-4 ? dxc / dc : 1, ny = dc > 1e-4 ? dyc / dc : 0;
      b.x = s.x + nx * hub;
      b.y = s.y + ny * hub;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
    }
    if (b.z >= P.bar_height) return;
    const minD = R + s.thick / 2;
    const sg = Math.sign(s.omega) || 1;
    for (let k = 0; k < s.arms; k++) {
      const a = s.angle + (k * TAU) / s.arms;
      const ux = Math.cos(a), uy = Math.sin(a);
      const along = clamp(dxc * ux + dyc * uy, 0, s.arm);
      const px = s.x + ux * along, py = s.y + uy * along;
      const ddx = b.x - px, ddy = b.y - py, dist = Math.hypot(ddx, ddy);
      if (dist >= minD) continue;
      const tx = -uy * sg, ty = ux * sg; // direction the bar sweeps
      let nx, ny;
      if (dist > 1e-4) { nx = ddx / dist; ny = ddy / dist; } else { nx = tx; ny = ty; }
      b.x = px + nx * minD;
      b.y = py + ny * minD;
      if (nx * tx + ny * ty > 0) {
        const sp = 260 + Math.abs(s.omega) * along * 1.1;
        b.vx = tx * sp + ux * 90;
        b.vy = ty * sp + uy * 90;
        b.vz = 140;
        b.z = Math.max(b.z, 0.01);
        b.diving = false;
        b.stun = 0.5;
        b.hitT = 0.3;
        this.events.push({ type: "hit", id: b.id, x: b.x, y: b.y, dx: tx, dy: ty });
      } else {
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
      }
    }
  }

  _hitSlider(b, w, R) {
    const l = w.cx - w.w / 2, r = w.cx + w.w / 2, t = w.y - w.h / 2, bt = w.y + w.h / 2;
    const qx = clamp(b.x, l, r), qy = clamp(b.y, t, bt);
    let dx = b.x - qx, dy = b.y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R * R) return;
    let nx, ny, pen;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      nx = dx / d; ny = dy / d; pen = R - d;
    } else {
      // Centre inside the wall: push out through the nearest side.
      const opts = [[b.x - l, -1, 0], [r - b.x, 1, 0], [b.y - t, 0, -1], [bt - b.y, 0, 1]];
      opts.sort((p, q) => p[0] - q[0]);
      [pen, nx, ny] = opts[0];
      pen += R;
    }
    b.x += nx * pen;
    b.y += ny * pen;
    const wv = w.vx * nx;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < wv) {
      const add = wv - vn + (wv > 0 ? wv * 0.5 : 0);
      b.vx += nx * add;
      b.vy += ny * add;
      if (wv > 150) b.stun = Math.max(b.stun, 0.15);
    }
  }

  _collideBodies() {
    const act = this._active();
    const minD = this.R * 2;
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i], b = act[j];
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || Math.abs(a.z - b.z) > 28) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = dx / d, ny = dy / d;
        // Characters moved by another browser don't get pushed here; they push others.
        const ea = this.external.has(a.id), eb = this.external.has(b.id);
        if (ea && eb) continue;
        const pa = ea ? 0 : eb ? 1 : 0.5, pb = 1 - pa;
        a.x -= nx * (minD - d) * pa; a.y -= ny * (minD - d) * pa;
        b.x += nx * (minD - d) * pb; b.y += ny * (minD - d) * pb;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = -rel * 0.5;
          a.vx -= nx * imp; a.vy -= ny * imp;
          b.vx += nx * imp; b.vy += ny * imp;
        }
        // A diving body bowls over whoever it hits.
        if (a.diving && !b.diving) { b.stun = Math.max(b.stun, 0.3); b.hitT = 0.2; }
        if (b.diving && !a.diving) { a.stun = Math.max(a.stun, 0.3); a.hitT = 0.2; }
      }
    }
  }

  // ---------------------------------------------------------------- new obstacles

  /**
   * Mystery doors: a fake door bursts open when you run into it; a real one
   * stops you, and gets an X so everyone knows. `push`: also shove the body
   * back out of a real door (false for characters moved by another browser).
   */
  _touchDoors(b, push) {
    const R = this.R;
    for (const d of this.doors) {
      if (d.broken) continue;
      const qx = clamp(b.x, d.x, d.x + d.w), qy = clamp(b.y, d.y, d.y + d.h);
      const dx = b.x - qx, dy = b.y - qy;
      if (dx * dx + dy * dy >= R * R || b.z > 60) continue;
      if (!d.real) {
        d.broken = true;
        this.events.push({ type: "door", x: d.x + d.w / 2, y: d.y + d.h / 2, id: b.id });
        continue;
      }
      if (!d.known) {
        d.known = true;
        this.events.push({ type: "bonk", x: qx, y: qy, id: b.id });
      }
      if (push) this._hitSlider(b, { cx: d.x + d.w / 2, y: d.y + d.h / 2, w: d.w, h: d.h, vx: 0 }, R);
    }
  }

  /** Trust tiles: fakes crack under you and drop; crumble tiles drop and grow back. */
  _updateGhosts(dt) {
    const running = this.status === "running";
    for (const g of this.ghosts) {
      if (g.st === 0 && running) {
        for (const b of this._active()) {
          if (b.z > 0 || b.x < g.x || b.x > g.x + g.w || b.y < g.y || b.y > g.y + g.h) continue;
          if (g.real) { g.known = true; break; }
          g.st = 1;
          g.t = g.crack ?? 0.35;
          this.events.push({ type: "crack", x: g.x + g.w / 2, y: g.y + g.h / 2 });
          break;
        }
      } else if (g.st === 1) {
        g.t -= dt;
        if (g.t <= 0) {
          g.st = 2;
          g.t = g.regrow ?? 0;
          this.events.push({ type: "tile", x: g.x + g.w / 2, y: g.y + g.h / 2 });
        }
      } else if (g.st === 2 && g.regrow) {
        g.t -= dt;
        if (g.t <= 0) g.st = 0;
      }
    }
  }

  /** Tilting platforms lean toward wherever players stand, and spring back level. */
  _updateTilts(dt) {
    for (const t of this.tilts) {
      let torque = 0;
      for (const b of this._active()) {
        if (b.z <= 0 && b.x >= t.x && b.x <= t.x + t.w && b.y >= t.y && b.y <= t.y + t.h) {
          torque += (b.x - (t.x + t.w / 2)) / (t.w / 2);
        }
      }
      const drift = t.drift ? Math.sin(this.time * t.drift + (t.phase || 0)) * 0.9 : 0;
      t.vel += ((torque + drift) * 1.6 - t.angle * 2.4 - t.vel * 2.2) * dt;
      t.angle = clamp(t.angle + t.vel * dt, -1, 1);
      if (Math.abs(t.angle) === 1) t.vel = 0;
    }
  }

  /** Logs roll down the course toward the start: jump them! */
  _updateLogs(dt) {
    this.logCfg.forEach((c, i) => {
      this.logT[i] -= dt;
      if (this.logT[i] <= 0) {
        this.logT[i] = c.every * (0.8 + Math.random() * 0.4);
        this.logs.push({ id: ++this.rollerId, y: c.y0, py: c.y0, x0: c.x0, x1: c.x1, r: c.r ?? 18,
          speed: c.speed, rot: 0, end: c.y1 });
      }
    });
    for (const lg of this.logs) {
      lg.py = lg.y;
      lg.y += lg.speed * dt;
      lg.rot += (lg.speed * dt) / lg.r;
    }
    this.logs = this.logs.filter((lg) => lg.y < lg.end);
  }

  _hitLog(b, lg) {
    const R = this.R;
    if (b.x < lg.x0 - R || b.x > lg.x1 + R) return;
    const dy = b.y - lg.y;
    if (Math.abs(dy) >= lg.r + R || b.z >= lg.r * 1.6) return; // jumped clear over it
    b.y = lg.y + lg.r + R;
    b.vy = lg.speed * 1.5 + 140;
    b.vx *= 0.3;
    b.vz = 150;
    b.z = Math.max(b.z, 0.01);
    b.diving = false;
    b.ballistic = false;
    b.stun = 0.45;
    b.hitT = 0.3;
    this.events.push({ type: "hit", id: b.id, x: b.x, y: b.y, dx: 0, dy: 1 });
  }

  // ---------------------------------------------------------------- multiplayer

  /**
   * Move this browser's own character one step (multiplayer). Everything
   * else in this World is copied from the host; only this body is simulated
   * here, so your own moves respond instantly.
   */
  stepLocal(b, it, dt) {
    b.px = b.x; b.py = b.y; b.pz = b.z;
    b.squash = Math.max(0, b.squash - dt * 4);
    if (b.eliminated || b.hidden || this.status === "countdown") return;
    const intent = this.status === "running" && !b.finished && it ? it : NO_INTENT;
    this._applyZones(b, dt);
    this._control(b, intent, dt);
    this._integrate(b, dt);
    this._checkPad(b);
    if (!b.eliminated && !b.falling) {
      this._collideOne(b);
      this._pushAway(b);
    }
    this._floorCheck(b, dt);
    if (this.type === "race" && this.status === "running" && !b.finished && !b.falling && !b.eliminated) {
      for (let i = b.checkpoint + 1; i < this.checkpoints.length; i++) {
        if (b.y < this.checkpoints[i].y) {
          b.checkpoint = i;
          this.events.push({ type: "checkpoint", id: b.id, x: b.x, y: b.y });
        }
      }
      if (b.y < this.level.finish_y) {
        b.finished = true; // the host confirms the place
        b.finishTime = this.time;
      }
    }
  }

  /** Bump this body away from everyone else (they move in other browsers). */
  _pushAway(b) {
    const minD = this.R * 2;
    for (const o of this.bodies) {
      if (o === b || o.eliminated || o.hidden || o.falling) continue;
      const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || Math.abs(o.z - b.z) > 28) continue;
      const d = Math.sqrt(d2) || 0.01;
      const nx = dx / d, ny = dy / d;
      // Other people are shown a moment in the past, so ease apart from them
      // instead of being shoved by where they were; bots push as usual.
      const k = o.isHuman ? 0.25 : 1;
      b.x += nx * (minD - d) * k;
      b.y += ny * (minD - d) * k;
      const rel = (b.vx - o.vx) * nx + (b.vy - o.vy) * ny;
      if (rel < 0 && !o.isHuman) { b.vx -= nx * rel * 0.5; b.vy -= ny * rel * 0.5; }
      if (o.diving && !b.diving) { b.stun = Math.max(b.stun, 0.3); b.hitT = 0.2; }
    }
  }

  // ---------------------------------------------------------------- tiles

  /** Meteor Meadow: mark target circles on the floor, then those tiles drop. */
  _updateMeteors(dt, cfg) {
    const M = cfg.meteors;
    this.meteorT -= dt;
    if (this.meteorT > 0) return;
    this.meteorT = Math.max(M.every_min, M.every - M.ramp * this.time);
    const count = Math.min(M.max_count, 1 + Math.floor(this.time / 25));
    const solid = this.tiles.list.filter((t) => t.state === "solid");
    const alive = this.aliveBodies();
    for (let i = 0; i < count && solid.length; i++) {
      // Half the strikes aim near a random player so nobody can just stand still.
      let cx, cy;
      if (alive.length && Math.random() < 0.5) {
        const b = alive[Math.floor(Math.random() * alive.length)];
        cx = b.x + rand(-60, 60); cy = b.y + rand(-60, 60);
      } else {
        const t = solid[Math.floor(Math.random() * solid.length)];
        cx = t.x; cy = t.y;
      }
      for (const t of this.tiles.list) {
        if (t.state === "solid" && Math.hypot(t.x - cx, t.y - cy) <= M.radius) {
          t.state = "crack";
          t.t = t.max = M.warn;
        }
      }
      this.meteors.push({ x: cx, y: cy, r: M.radius, t: M.warn, T: M.warn });
    }
  }

  _updateTiles(dt) {
    const cfg = this.tiles.cfg;
    if (this.status === "running" && cfg.meteors) this._updateMeteors(dt, cfg);
    for (const m of this.meteors) m.t -= dt;
    this.meteors = this.meteors.filter((m) => m.t > -0.6);
    if (this.status === "running" && cfg.touch_crumble !== false) {
      for (const b of this._active()) {
        if (b.z > 0) continue;
        const t = this.tileAt(b.x, b.y);
        if (t && t.state === "solid") {
          t.state = "crack";
          t.t = t.max = b.isHuman ? (cfg.human_crack_time ?? cfg.crack_time) : cfg.crack_time;
        }
      }
    }
    if (this.status === "running") {
      if (this.time > cfg.auto_crack_after) {
        this.autoCrackT -= dt;
        if (this.autoCrackT <= 0) {
          this.autoCrackT = cfg.auto_crack_every;
          const solid = this.tiles.list.filter((t) => t.state === "solid");
          if (solid.length) {
            const t = solid[Math.floor(Math.random() * solid.length)];
            t.state = "crack";
            t.t = t.max = cfg.crack_time * 1.5;
          }
        }
      }
    }
    for (const t of this.tiles.list) {
      if (t.state === "crack") {
        t.t -= dt;
        if (t.t <= 0) {
          t.state = "gone";
          t.goneT = 0;
          this.events.push({ type: "tile", x: t.x, y: t.y });
        }
      } else if (t.state === "gone") {
        t.goneT += dt;
      }
    }
  }

  // ---------------------------------------------------------------- rules

  _rules() {
    const L = this.level;
    if (this.type === "race") {
      for (const b of this.bodies) {
        if (b.finished && !b.isHuman && !b.hidden && this.time >= b.hideAt) b.hidden = true;
        if (b.finished || b.falling) continue;
        for (let i = b.checkpoint + 1; i < this.checkpoints.length; i++) {
          if (b.y < this.checkpoints[i].y) {
            b.checkpoint = i;
            if (b.isHuman) this.events.push({ type: "checkpoint", id: b.id, x: b.x, y: b.y });
          }
        }
        if (b.y < L.finish_y) {
          b.finished = true;
          b.finishTime = this.time;
          b.hideAt = this.time + 1.2;
          this.finishers.push(b.id);
          this.events.push({ type: "finish", id: b.id, place: this.finishers.length, x: b.x, y: b.y });
        }
      }
      if (this.tutorial) {
        if (this.human && this.human.finished) this._end("finished");
      } else if (this.finishers.length >= this.qualify) {
        this._end("full");
      } else if (this.multiplayer && !this.bodies.some((b) => b.isHuman && !b.eliminated)) {
        this._end("eliminated"); // every person has left the race
      } else if (L.time_limit && this.time >= L.time_limit) {
        this._end("time");
      }
      return;
    }
    const alive = this.aliveBodies();
    if (this.multiplayer) {
      // Keep going while any person is still in; end once nobody is left to watch for.
      if (!alive.some((b) => b.isHuman)) this._end("eliminated");
      else if (alive.length <= this.qualify) this._end("survivors");
      else if (L.time_limit && this.time >= L.time_limit) this._end("time");
      return;
    }
    if (this.human && this.human.eliminated) this._end("eliminated");
    else if (alive.length <= this.qualify) this._end("survivors");
    else if (L.time_limit && this.time >= L.time_limit) this._end("time");
  }

  _end(reason) {
    this.status = "ended";
    let qualified;
    if (this.type === "race") qualified = this.finishers.slice(0, this.qualify);
    else qualified = this.aliveBodies().map((b) => b.id);

    if (this.qualify === 1 && qualified.length === 1) {
      this.bodies.find((b) => b.id === qualified[0]).crown = true;
    }
    // Result for every person in the round (multiplayer needs them all).
    const players = {};
    for (const b of this.bodies) if (b.isHuman) players[b.id] = this._resultFor(b, qualified);
    const mine = this.human ? players[this.human.id] : { qualified: false, place: null, time: this.time };
    this.result = {
      reason, qualified, players,
      playerQualified: mine.qualified, place: mine.place, time: mine.time,
    };
    this.events.push({ type: "end", reason });
  }

  _resultFor(b, qualified) {
    let place = null, time = this.time;
    const ok = qualified.includes(b.id);
    if (this.type === "race") {
      const idx = this.finishers.indexOf(b.id);
      place = idx >= 0 ? idx + 1 : null;
      if (b.finished) time = b.finishTime;
    } else if (ok) {
      place = this.qualify === 1 ? 1 : null;
    } else {
      place = (b.aliveAfter ?? 0) + 1;
    }
    return { qualified: ok, place, time: Math.round(time * 100) / 100 };
  }

  /** A person left a multiplayer round: take them out of it. */
  dropPlayer(id) {
    const b = this.bodies.find((q) => q.id === id);
    if (!b || b.eliminated || b.finished) return;
    b.eliminated = true;
    b.hidden = true;
    b.falling = false;
    b.aliveAfter = this.aliveBodies().length;
    this.eliminatedOrder.push(b.id);
    this.events.push({ type: "left", id: b.id, name: b.name, x: b.x, y: b.y });
  }
}

const HEX_ROW = Math.sqrt(3) / 2; // row spacing of pointy-top hexes, as a fraction of pitch

function buildTiles(cfg) {
  const hex = cfg.shape === "hex";
  const rowH = hex ? cfg.pitch * HEX_ROW : cfg.pitch;
  const centre = (c, r) => ({
    x: cfg.x + cfg.pitch * (c + 0.5 + (hex && r % 2 ? 0.5 : 0)),
    y: cfg.y + rowH * (r + 0.5),
  });
  const cx = cfg.x + (cfg.cols * cfg.pitch) / 2 + (hex ? cfg.pitch / 4 : 0);
  const cy = cfg.y + (cfg.rows * rowH) / 2;
  const grid = new Array(cfg.cols * cfg.rows).fill(null);
  const list = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const p = centre(c, r);
      const dist = Math.hypot(p.x - cx, p.y - cy);
      if (cfg.radius && dist > cfg.radius) continue;
      const t = { c, r, x: p.x, y: p.y, state: "solid", t: 0, goneT: 0, ring: Math.round(dist / cfg.pitch) };
      grid[r * cfg.cols + c] = t;
      list.push(t);
    }
  }
  return { cfg, list, grid, hex, rowH, cx, cy, centre };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Small seeded random generator (so every browser builds the same layout from a seed). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rows of doors: in each row a few (``reals``) are solid, the rest burst open. */
function buildDoors(rows, rng) {
  const out = [];
  for (const row of rows) {
    const idx = Array.from({ length: row.count }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const real = new Set(idx.slice(0, row.reals));
    const w = row.w / row.count;
    for (let i = 0; i < row.count; i++) {
      out.push({ x: row.x + i * w + 3, y: row.y, w: w - 6, h: row.h, real: real.has(i), broken: false, known: false });
    }
  }
  return out;
}

/**
 * Tile grids. "trust": one hidden path of real tiles from the first row to the
 * last (each step moves at most one column); every other tile is a fake.
 * "crumble": every tile drops a moment after you step on it, then grows back.
 */
function buildGhosts(grids, rng) {
  const out = [];
  for (const g of grids) {
    const cw = g.w / g.cols, rh = g.h / g.rows;
    let col = Math.floor(rng() * g.cols);
    for (let r = 0; r < g.rows; r++) {   // r = 0 is the row nearest the start
      if (r > 0) col = clamp(col + Math.floor(rng() * 3) - 1, 0, g.cols - 1);
      for (let c = 0; c < g.cols; c++) {
        const real = g.kind === "trust" && c === col;
        out.push({ x: g.x + c * cw + g.gap / 2, y: g.y + g.h - (r + 1) * rh + g.gap / 2, w: cw - g.gap, h: rh - g.gap,
          real, crack: g.kind === "crumble" ? (g.crack ?? 0.7) : 0.35, regrow: g.kind === "crumble" ? (g.regrow ?? 3.5) : 0,
          st: 0, t: 0, known: false, kind: g.kind });
      }
    }
  }
  return out;
}
