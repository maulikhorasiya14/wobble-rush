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
   * @param opts    {qualify, countdown, tutorial}
   */
  constructor(level, physics, roster, opts = {}) {
    this.level = level;
    this.P = physics;
    this.R = physics.radius;
    this.type = level.type;
    this.tutorial = !!opts.tutorial;
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
    this.checkpoints = (level.checkpoints || []).slice().sort((a, b) => b.y - a.y);
    this.arenaR = level.arena ? level.arena.r : 0;
    this.tiles = level.tiles ? buildTiles(level.tiles) : null;
    this.autoCrackT = 0;

    const spawns = this._spawnPoints(roster.length);
    this.bodies = roster.map((p, i) => this._makeBody(p, spawns[i]));
    this.human = this.bodies.find((b) => b.isHuman) || null;
  }

  // ---------------------------------------------------------------- setup

  _makeBody(p, sp) {
    const skill = p.skill ?? Math.random();
    return {
      id: p.id, name: p.name, color: p.color, isHuman: !!p.isHuman,
      x: sp.x, y: sp.y, vx: 0, vy: 0, z: 0, vz: 0,
      fx: 0, fy: -1, stun: 0, diving: false,
      falling: false, fallT: 0, finished: false, finishTime: 0, hideAt: 0,
      eliminated: false, hidden: false, checkpoint: -1,
      sliding: false, squash: 0, walk: Math.random() * 10, hitT: 0, crown: false,
      speedMul: p.isHuman ? 1 : 0.84 + 0.16 * skill,
      brain: p.isHuman ? null : makeBrain(skill),
    };
  }

  _spawnPoints(n) {
    const L = this.level;
    const pts = [];
    if (this.type === "race") {
      const s = L.spawn;
      const cols = Math.min(n, 6);
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        pts.push({ x: s.x + (c + 0.5) * (s.w / cols), y: s.y + (r + 0.5) * (s.h / rows) });
      }
      shuffle(pts);
    } else if (this.tiles) {
      const cfg = this.tiles.cfg;
      const cx = cfg.x + (cfg.cols * cfg.pitch) / 2, cy = cfg.y + (cfg.rows * cfg.pitch) / 2;
      const rr = Math.min(cfg.cols, cfg.rows) * cfg.pitch * 0.3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const t = this.tileAt(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
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

  onFloor(x, y) {
    for (const f of this.level.floors || []) {
      if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) return true;
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
    return false;
  }

  /** Floor that will still be there `ahead` seconds from now (crumbling tiles may not be). */
  safeAt(x, y, ahead = 0) {
    if (!this.onFloor(x, y)) return false;
    if (!this.tiles || (this.level.floors || []).length) return true;
    const t = this.tileAt(x, y);
    return !!t && (t.state === "solid" || t.t > ahead + 0.15);
  }

  tileAt(x, y) {
    const cfg = this.tiles.cfg;
    const c = Math.floor((x - cfg.x) / cfg.pitch), r = Math.floor((y - cfg.y) / cfg.pitch);
    if (c < 0 || r < 0 || c >= cfg.cols || r >= cfg.rows) return null;
    return this.tiles.list[r * cfg.cols + c];
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
    return false;
  }

  aliveBodies() {
    return this.bodies.filter((b) => !b.eliminated);
  }

  // ---------------------------------------------------------------- update

  update(dt, humanIntent = NO_INTENT) {
    this.clock += dt;
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
      if (b.eliminated || b.hidden) continue;
      let it = NO_INTENT;
      if (this.status === "running" && !b.finished) {
        it = b.isHuman ? humanIntent : botIntent(b, this, dt);
      }
      this._control(b, it, dt);
      this._integrate(b, dt);
    }
    this._collideObstacles();
    this._collideBodies();
    for (const b of this.bodies) this._floorCheck(b);
    if (this.tiles) this._updateTiles(dt);
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
  }

  _control(b, it, dt) {
    if (b.falling) return;
    const P = this.P;
    const ground = b.z <= 0;
    b.stun = Math.max(0, b.stun - dt);
    b.hitT = Math.max(0, b.hitT - dt);

    if (b.stun <= 0) b.sliding = false;
    if (b.stun <= 0 && !b.diving) {
      let mx = it.mx || 0, my = it.my || 0;
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      const maxS = P.max_speed * b.speedMul;
      const tx = mx * maxS, ty = my * maxS;
      if (ground || m > 0.05) {
        const acc = (ground ? P.ground_accel : P.air_accel) * dt;
        const dx = tx - b.vx, dy = ty - b.vy, d = Math.hypot(dx, dy);
        if (d <= acc) { b.vx = tx; b.vy = ty; } else { b.vx += (dx / d) * acc; b.vy += (dy / d) * acc; }
      }
      if (m > 0.05) { b.fx = mx / Math.max(m, 1e-6); b.fy = my / Math.max(m, 1e-6); }

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
      const k = Math.exp(-(b.sliding ? P.slide_friction : P.ground_friction * 0.6) * dt);
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

  _floorCheck(b) {
    if (b.falling || b.eliminated || b.hidden || b.z > 0) return;
    if (!this.onFloor(b.x, b.y)) {
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
      b.stun = 0;
      b.fx = 0; b.fy = -1;
      this.events.push({ type: "respawn", id: b.id, x: b.x, y: b.y });
    } else {
      b.eliminated = true;
      b.z = 0;
      b.aliveAfter = this.aliveBodies().length;
      this.eliminatedOrder.push(b.id);
      this.events.push({ type: "eliminated", id: b.id, name: b.name, x: b.x, y: b.y });
    }
  }

  // ---------------------------------------------------------------- collisions

  _active() {
    return this.bodies.filter((b) => !b.eliminated && !b.hidden && !b.falling);
  }

  _collideObstacles() {
    const P = this.P, R = this.R;
    for (const b of this._active()) {
      for (const s of this.spinners) this._hitSpinner(b, s, P, R);
      for (const w of this.sliders) this._hitSlider(b, w, R);
      for (const bp of this.bumpers) {
        const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy), rr = bp.r + R;
        if (d < rr) {
          const nx = d > 1e-4 ? dx / d : 0, ny = d > 1e-4 ? dy / d : 1;
          b.x = bp.x + nx * rr;
          b.y = bp.y + ny * rr;
          b.vx = nx * 480;
          b.vy = ny * 480;
          b.diving = false;
          b.stun = Math.max(b.stun, 0.25);
          bp.pulse = 1;
          this.events.push({ type: "bump", id: b.id, x: b.x, y: b.y });
        }
      }
    }
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
        this.events.push({ type: "hit", id: b.id, x: b.x, y: b.y });
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
        const nx = dx / d, ny = dy / d, push = (minD - d) / 2;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
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

  // ---------------------------------------------------------------- tiles

  _updateTiles(dt) {
    const cfg = this.tiles.cfg;
    if (this.status === "running") {
      for (const b of this._active()) {
        if (b.z > 0) continue;
        const t = this.tileAt(b.x, b.y);
        if (t && t.state === "solid") { t.state = "crack"; t.t = cfg.crack_time; }
      }
      if (this.time > cfg.auto_crack_after) {
        this.autoCrackT -= dt;
        if (this.autoCrackT <= 0) {
          this.autoCrackT = cfg.auto_crack_every;
          const solid = this.tiles.list.filter((t) => t.state === "solid");
          if (solid.length) {
            const t = solid[Math.floor(Math.random() * solid.length)];
            t.state = "crack";
            t.t = cfg.crack_time * 1.5;
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
      } else if (L.time_limit && this.time >= L.time_limit) {
        this._end("time");
      }
      return;
    }
    const alive = this.aliveBodies();
    if (this.human && this.human.eliminated) this._end("eliminated");
    else if (alive.length <= this.qualify) this._end("survivors");
    else if (L.time_limit && this.time >= L.time_limit) this._end("time");
  }

  _end(reason) {
    this.status = "ended";
    let qualified;
    if (this.type === "race") qualified = this.finishers.slice(0, this.qualify);
    else qualified = this.aliveBodies().map((b) => b.id);

    const h = this.human;
    let place = null, time = this.time, playerQualified = false;
    if (h) {
      playerQualified = qualified.includes(h.id);
      if (this.type === "race") {
        const idx = this.finishers.indexOf(h.id);
        place = idx >= 0 ? idx + 1 : null;
        if (h.finished) time = h.finishTime;
      } else if (playerQualified) {
        place = this.qualify === 1 ? 1 : null;
      } else {
        place = (h.aliveAfter ?? 0) + 1;
      }
      if (playerQualified && this.qualify === 1) h.crown = true;
    }
    if (!h && this.qualify === 1 && qualified.length === 1) {
      this.bodies.find((b) => b.id === qualified[0]).crown = true;
    }
    this.result = { reason, qualified, playerQualified, place, time: Math.round(time * 100) / 100 };
    this.events.push({ type: "end", reason });
  }
}

function buildTiles(cfg) {
  const list = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      list.push({
        c, r, state: "solid", t: 0, goneT: 0,
        x: cfg.x + (c + 0.5) * cfg.pitch,
        y: cfg.y + (r + 0.5) * cfg.pitch,
      });
    }
  }
  return { cfg, list };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
