// Computer-controlled players. Each bot has a skill (0..1) that affects speed,
// reaction time and how cleanly it times its jumps.
const TAU = Math.PI * 2;
const OFFSETS = [0, -0.3, 0.3, -0.6, 0.6, -1.0, 1.0, -1.5, 1.5];
const PROBES = [24, 48, 80];

export function makeBrain(skill) {
  return {
    skill,
    think: 0,
    dx: 0,
    dy: -1,
    offset: Math.random() * 2 - 1,
    lead: 0.25,
    target: null,
    angPref: Math.random() * TAU,
    best: Infinity,
    stuckT: 0,
    panicT: 0,
  };
}

export function botIntent(b, w, dt) {
  const br = b.brain;
  const it = { mx: 0, my: 0, jump: false, dive: false };
  if (b.stun > 0 || b.falling) return it;

  trackStuck(b, w, br, dt);
  br.think -= dt;
  if (br.think <= 0) {
    br.think = (w.tiles ? 0.05 : 0.1) + (1 - br.skill) * 0.15 + Math.random() * 0.06;
    // Timing noise: worse bots jump too early or too late more often.
    br.lead = 0.24 + (Math.random() - 0.5) * (0.08 + (1 - br.skill) * 0.3);
    steer(b, w, br);
  }
  it.mx = br.dx;
  it.my = br.dy;

  // On tiles, aim straight at the chosen neighbour and brake on top of it.
  const t = br.target;
  if (w.tiles && t && t.state !== "gone" && br.panicT <= 0) {
    const dx = t.x - b.x, dy = t.y - b.y, d = Math.hypot(dx, dy);
    if (d < 10) { it.mx = 0; it.my = 0; } else if (d < 90) {
      const k = Math.min(1, d / 45); // slow down on arrival
      it.mx = (dx / d) * k;
      it.my = (dy / d) * k;
    }
  }

  if (b.z <= 0 && !b.diving) {
    if (gapAhead(b, w, br) || spinnerThreat(b, w, br)) it.jump = true;
  } else if (b.z > 0 && !b.diving && b.vz < 60 && shouldDive(b, w)) {
    it.dive = true;
  }
  return it;
}

function trackStuck(b, w, br, dt) {
  if (w.type !== "race") return;
  if (b.y < br.best - 20) {
    br.best = b.y;
    br.stuckT = 0;
  } else {
    br.stuckT += dt;
  }
  if (br.stuckT > 2.5) {
    br.stuckT = 0;
    br.best = b.y;
    br.offset = Math.random() * 2 - 1;
    br.panicT = 0.5;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    br.dx = Math.cos(a);
    br.dy = Math.sin(a);
  }
}

function goalPoint(b, w, br) {
  const L = w.level;
  if (w.type === "race") {
    for (const wp of L.waypoints || []) {
      if (wp.y < b.y - 30) return { x: wp.x + br.offset * wp.spread, y: wp.y };
    }
    return { x: L.bounds.w / 2, y: L.finish_y - 200 };
  }
  if (w.tiles) {
    // Stand on a tile while it crumbles, then hop to a fresh neighbour.
    const t = br.target;
    const onIt = t && w.tileAt(b.x, b.y) === t;
    const leaveAt = 0.3 + (1 - br.skill) * 0.25 * Math.random();
    const doomed = !t || t.state === "gone" || (t.state === "crack" && t.t < (onIt ? leaveAt : 0.55));
    if (doomed) br.target = pickTile(b, w);
    if (br.target) {
      const here = w.tileAt(b.x, b.y) === br.target;
      return { x: br.target.x, y: br.target.y, hold: here };
    }
    const cfg = w.tiles.cfg;
    return { x: cfg.x + (cfg.cols * cfg.pitch) / 2, y: cfg.y + (cfg.rows * cfg.pitch) / 2 };
  }
  const A = L.arena;
  const rr = w.arenaR * 0.5;
  let gx = A.x + Math.cos(br.angPref) * rr, gy = A.y + Math.sin(br.angPref) * rr;
  if (Math.hypot(gx - b.x, gy - b.y) < 30) br.angPref += 0.8 + Math.random();
  br.angPref += (Math.random() - 0.5) * 0.3;
  return { x: gx, y: gy };
}

function pickTile(b, w) {
  const cfg = w.tiles.cfg;
  const cx = cfg.x + (cfg.cols * cfg.pitch) / 2, cy = cfg.y + (cfg.rows * cfg.pitch) / 2;
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const others = w.bodies.filter((o) => o !== b && !o.eliminated && !o.falling);
  let best = null, bestScore = -Infinity;
  for (const t of w.tiles.list) {
    if (t.state !== "solid") continue;
    const d = Math.hypot(t.x - b.x, t.y - b.y);
    if (d < 20 || d > 260) continue;
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const o = w.tileAt(t.x + dc * cfg.pitch, t.y + dr * cfg.pitch);
        if (o && o.state === "solid") n++;
      }
    }
    let blocked = 0;
    for (let f = 20; f < d; f += 20) {
      if (!w.safeAt(b.x + ((t.x - b.x) * f) / d, b.y + ((t.y - b.y) * f) / d, f / 200)) blocked = 1;
    }
    let crowd = 0;
    for (const o of others) if (Math.hypot(o.x - t.x, o.y - t.y) < 100) crowd++;
    const forward = ((t.x - b.x) * b.vx + (t.y - b.y) * b.vy) / (d * sp);
    const score = n * 0.5 + forward * 0.3 - d / 60 - Math.hypot(t.x - cx, t.y - cy) / 220
      - crowd * 0.9 - blocked * 2 + Math.random() * 0.4;
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

function steer(b, w, br) {
  if (br.panicT > 0) { br.panicT -= br.think; return; }
  const goal = goalPoint(b, w, br);
  const distGoal = Math.hypot(goal.x - b.x, goal.y - b.y);
  if (goal.hold && distGoal < 10) { br.dx = 0; br.dy = 0; return; }
  const base = Math.atan2(goal.y - b.y, goal.x - b.x);
  const maxProbe = w.tiles ? Math.max(24, distGoal + 8) : Infinity;
  const A = w.level.arena;
  let best = -Infinity, bestA = base;
  for (const off of OFFSETS) {
    const a = base + off, ca = Math.cos(a), sa = Math.sin(a);
    let s = Math.cos(off) * 1.2;
    for (const d of PROBES) {
      if (d > maxProbe) break;
      const px = b.x + ca * d, py = b.y + sa * d;
      const weight = 24 / d;
      const ahead = d / (w.P.max_speed * b.speedMul);
      if (!w.safeAt(px, py, ahead)) {
        s -= !A && jumpLands(w, b, ca, sa) ? 0.35 : 4 * weight;
        break;
      }
      if (w.solidAt(px, py, d / 200)) s -= 1.6 * weight;
      if (A) {
        const rr = Math.hypot(px - A.x, py - A.y) / w.arenaR;
        if (rr > 0.78) s -= (rr - 0.78) * 8;
      }
    }
    s += Math.random() * 0.15 * (1.2 - br.skill);
    if (s > best) { best = s; bestA = a; }
  }
  br.dx = Math.cos(bestA);
  br.dy = Math.sin(bestA);
}

function airTime(P) {
  return (2 * P.jump_speed) / P.gravity;
}

function jumpLands(w, b, ux, uy, speed = w.P.max_speed * b.speedMul) {
  const air = airTime(w.P);
  const reach = speed * air;
  return w.safeAt(b.x + ux * reach * 0.9, b.y + uy * reach * 0.9, air)
    && w.safeAt(b.x + ux * reach * 1.08, b.y + uy * reach * 1.08, air + 0.1);
}

function gapAhead(b, w, br) {
  if (w.level.arena) return false;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp < 100) return false;
  const ux = b.vx / sp, uy = b.vy / sp;
  const look = w.R * 0.5 + sp * (0.04 + (1 - br.skill) * 0.05 * Math.random());
  if (w.safeAt(b.x + ux * look, b.y + uy * look, look / sp)) return false;
  return jumpLands(w, b, ux, uy, sp);
}

function landingPoint(b, P, vx, vy, vz) {
  const t = (vz + Math.sqrt(vz * vz + 2 * P.gravity * Math.max(0, b.z))) / P.gravity;
  return { x: b.x + vx * t, y: b.y + vy * t };
}

function shouldDive(b, w) {
  const P = w.P;
  const land = landingPoint(b, P, b.vx, b.vy, b.vz);
  if (w.onFloor(land.x, land.y)) return false;
  const sp = P.dive_speed * b.speedMul;
  const dive = landingPoint(b, P, b.fx * sp, b.fy * sp, Math.max(b.vz, P.dive_hop));
  const slide = sp / P.slide_friction;
  return w.safeAt(dive.x, dive.y, 0.5) && w.safeAt(dive.x + b.fx * slide, dive.y + b.fy * slide, 0.8);
}

function spinnerThreat(b, w, br) {
  const R = w.R;
  for (const s of w.spinners) {
    const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy);
    if (d > s.arm + R + 4 || d < (s.hub || 0)) continue;
    const om = s.omega, aw = Math.abs(om);
    if (aw < 0.01) continue;
    const ang = Math.atan2(dy, dx);
    const half = Math.asin(Math.min(1, (R + s.thick / 2) / Math.max(d, 1)));
    for (let k = 0; k < s.arms; k++) {
      const a = s.angle + (k * TAU) / s.arms;
      let diff = ((ang - a) * Math.sign(om)) % TAU;
      if (diff < 0) diff += TAU;
      const t = (diff - half) / aw;
      if (t < br.lead && t > -0.05) return true;
    }
  }
  return false;
}
