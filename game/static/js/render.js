// Draws a World onto the canvas: a tilted top-down view with simple 3D sides.
export const VIEW_W = 960;
export const VIEW_H = 600;

const TAU = Math.PI * 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = { x: 0, y: 0, zoom: 1, shake: 0 };
    this.lastWorld = null;
    this.particles = [];
    this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * VIEW_W, y: Math.random() * VIEW_H * 2,
      r: 0.6 + Math.random() * 1.8, tw: Math.random() * TAU,
    }));
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = VIEW_W * this.dpr;
    this.canvas.height = VIEW_H * this.dpr;
  }

  /** Turn simulation events into particles and camera shake. */
  consume(events, followId) {
    for (const e of events) {
      switch (e.type) {
        case "land": this._burst(e.x, e.y, 6, "#ffffff", 60, 0.35, 3); break;
        case "hit":
          this._burst(e.x, e.y - 16, 10, "#ffe066", 160, 0.4, 3);
          if (e.id === followId) this.cam.shake = 8;
          break;
        case "bump": this._burst(e.x, e.y - 10, 8, "#ffffff", 120, 0.3, 2.5); break;
        case "finish": this._confetti(e.x, e.y, 40); break;
        case "tile": this._burst(e.x, e.y, 5, "#6b4f2a", 50, 0.5, 4); break;
        case "eliminated": this._burst(e.x, e.y, 14, "#ffffff", 120, 0.6, 3); break;
        case "checkpoint": this._confetti(e.x, e.y, 16); break;
        case "respawn": this._burst(e.x, e.y, 10, "#9ad8ff", 90, 0.5, 3); break;
      }
    }
  }

  _burst(x, y, n, color, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, life, max: life, color, size, g: 0 });
    }
  }

  _confetti(x, y, n) {
    const colors = ["#ff5fa2", "#ffd23f", "#5b8cff", "#3ddc97", "#ff8c42", "#b47cff"];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = 120 + Math.random() * 200;
      this.particles.push({
        x, y: y - 20, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.4, max: 1.4,
        color: colors[i % colors.length], size: 3 + Math.random() * 2, g: 260, rot: Math.random() * TAU,
      });
    }
  }

  // ------------------------------------------------------------------ frame

  draw(world, followId, dt) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!world) {
      ctx.fillStyle = "#1b1240";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      return;
    }
    const L = world.level, th = L.theme;
    this._updateCamera(world, followId, dt);
    const cam = this.cam;

    // Background (screen space)
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, th.void[0]);
    g.addColorStop(1, th.void[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const s of this.stars) {
      const y = (((s.y - cam.y * 0.25) % (VIEW_H * 2)) + VIEW_H * 2) % (VIEW_H * 2) - VIEW_H / 2;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(world.clock * 2 + s.tw);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // World space
    const sx = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake : 0;
    const sy = cam.shake > 0 ? (Math.random() - 0.5) * cam.shake : 0;
    cam.shake = Math.max(0, cam.shake - dt * 30);
    const z = cam.zoom;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z,
      this.dpr * (VIEW_W / 2 - cam.x * z + sx), this.dpr * (VIEW_H / 2 - cam.y * z + sy));
    this.view = {
      x0: cam.x - VIEW_W / 2 / z - 50, x1: cam.x + VIEW_W / 2 / z + 50,
      y0: cam.y - VIEW_H / 2 / z - 80, y1: cam.y + VIEW_H / 2 / z + 80,
    };

    this._drawFloors(world, th);
    if (world.tiles) this._drawTiles(world, th);
    if (L.arena) this._drawArena(world, th);
    this._drawLines(world);
    for (const s of world.spinners) this._drawSpinner(s, th, world);

    // Tall things and characters sorted by depth.
    const items = [];
    for (const w of world.sliders) items.push({ y: w.y + w.h / 2, f: () => this._drawSlider(w) });
    for (const b of world.bumpers) items.push({ y: b.y, f: () => this._drawBumper(b) });
    for (const b of world.bodies) {
      if (b.hidden || b.eliminated) continue;
      items.push({ y: b.y + (b.falling ? -1000 : 0), f: () => this._drawBody(b, world, b.id === followId) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();

    this._drawParticles(dt);

    // HUD-ish overlays in screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (world.type === "race" && !world.tutorial) this._drawProgress(world, followId);
  }

  _updateCamera(world, followId, dt) {
    const L = world.level, cam = this.cam;
    let tx, ty, tz;
    if (L.camera === "fit") {
      tz = Math.min(VIEW_W / (L.bounds.w + 120), VIEW_H / (L.bounds.h + 140));
      tx = L.bounds.w / 2;
      ty = L.bounds.h / 2 + 10;
    } else {
      let f = world.bodies.find((b) => b.id === followId);
      if (!f) {
        // Spectate the leader when there's no one to follow.
        f = world.bodies.filter((b) => !b.hidden).sort((a, b) => a.y - b.y)[0];
      }
      tz = 1;
      tx = L.bounds.w / 2;
      ty = f ? f.y - 90 : L.bounds.h - 300;
    }
    if (this.lastWorld !== world) {
      this.lastWorld = world;
      cam.x = tx; cam.y = ty; cam.zoom = tz;
      this.particles = [];
    }
    const k = 1 - Math.exp(-dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.zoom += (tz - cam.zoom) * k;
  }

  // ------------------------------------------------------------------ level

  _visible(x, y, w, h) {
    const v = this.view;
    return x + w > v.x0 && x < v.x1 && y + h > v.y0 && y < v.y1;
  }

  _drawFloors(world, th) {
    const ctx = this.ctx;
    for (const f of world.level.floors || []) {
      if (!this._visible(f.x, f.y, f.w, f.h + 30)) continue;
      ctx.fillStyle = th.side;
      roundRect(ctx, f.x, f.y + 8, f.w, f.h + 18, 16);
      ctx.fill();
      ctx.save();
      roundRect(ctx, f.x, f.y, f.w, f.h, 16);
      ctx.clip();
      ctx.fillStyle = th.floorA;
      ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = th.floorB;
      const y0 = Math.max(f.y, this.view.y0), y1 = Math.min(f.y + f.h, this.view.y1);
      for (let y = Math.floor(y0 / 120) * 120; y < y1; y += 120) ctx.fillRect(f.x, y, f.w, 60);
      // Little polka dots for texture
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      for (let y = Math.floor(y0 / 60) * 60 + 30; y < y1; y += 60) {
        for (let x = f.x + 30; x < f.x + f.w; x += 60) {
          ctx.beginPath();
          ctx.arc(x + ((y / 60) % 2) * 30, y, 4, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 3;
      roundRect(ctx, f.x + 1.5, f.y + 1.5, f.w - 3, f.h - 3, 15);
      ctx.stroke();
    }
  }

  _drawTiles(world, th) {
    const ctx = this.ctx, cfg = world.tiles.cfg, s = cfg.size;
    for (const t of world.tiles.list) {
      let x = t.x - s / 2, y = t.y - s / 2;
      if (t.state === "gone") {
        if (t.goneT > 0.5) continue;
        const k = 1 - t.goneT / 0.5;
        ctx.globalAlpha = k;
        ctx.fillStyle = th.side;
        const ss = s * k;
        roundRect(ctx, t.x - ss / 2, t.y - ss / 2 + t.goneT * 120, ss, ss, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      let top = (t.c + t.r) % 2 ? th.floorA : th.floorB;
      if (t.state === "crack") {
        const k = 1 - t.t / cfg.crack_time;
        x += (Math.random() - 0.5) * 3 * k;
        y += (Math.random() - 0.5) * 3 * k;
        top = mix(top, th.crack, Math.min(1, 0.3 + k));
      }
      ctx.fillStyle = th.side;
      roundRect(ctx, x, y + 6, s, s, 8);
      ctx.fill();
      ctx.fillStyle = top;
      roundRect(ctx, x, y, s, s, 8);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(ctx, x + 5, y + 4, s - 10, 6, 3);
      ctx.fill();
      if (t.state === "crack") {
        ctx.strokeStyle = "rgba(90,50,20,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + s * 0.2, y + s * 0.3);
        ctx.lineTo(x + s * 0.5, y + s * 0.55);
        ctx.lineTo(x + s * 0.8, y + s * 0.4);
        ctx.moveTo(x + s * 0.5, y + s * 0.55);
        ctx.lineTo(x + s * 0.45, y + s * 0.85);
        ctx.stroke();
      }
    }
  }

  _drawArena(world, th) {
    const ctx = this.ctx, A = world.level.arena, r = world.arenaR;
    ctx.fillStyle = th.side;
    ctx.beginPath();
    ctx.ellipse(A.x, A.y + 14, r, r, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(A.x, A.y, r, 0, TAU);
    ctx.clip();
    for (let rr = A.r; rr > 0; rr -= 45) {
      ctx.fillStyle = Math.round(rr / 45) % 2 ? th.floorA : th.floorB;
      ctx.beginPath();
      ctx.arc(A.x, A.y, rr, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = r <= A.min_r + 0.5 ? "#ff5757" : "rgba(255,255,255,0.8)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(A.x, A.y, r - 2, 0, TAU);
    ctx.stroke();
  }

  _drawLines(world) {
    const ctx = this.ctx, L = world.level;
    const span = (y) => {
      const f = (L.floors || []).find((f) => y >= f.y && y <= f.y + f.h && L.bounds.w / 2 >= f.x && L.bounds.w / 2 <= f.x + f.w);
      return f ? [f.x, f.x + f.w] : [0, L.bounds.w];
    };
    for (const cp of world.checkpoints) {
      if (!this._visible(0, cp.y - 20, L.bounds.w, 40)) continue;
      const [x0, x1] = span(cp.y);
      ctx.strokeStyle = "rgba(60,160,255,0.8)";
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      ctx.moveTo(x0 + 6, cp.y);
      ctx.lineTo(x1 - 6, cp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const x of [x0 + 10, x1 - 10]) flag(ctx, x, cp.y, "#3c9cff");
    }
    if (L.finish_y != null && this._visible(0, L.finish_y - 60, L.bounds.w, 80)) {
      const [x0, x1] = span(L.finish_y + 10);
      const sq = 20;
      for (let row = 0; row < 2; row++) {
        for (let x = x0, i = 0; x < x1; x += sq, i++) {
          ctx.fillStyle = (i + row) % 2 ? "#222" : "#fff";
          ctx.fillRect(x, L.finish_y - sq * 2 + row * sq, Math.min(sq, x1 - x), sq);
        }
      }
      // Arch posts and banner
      ctx.fillStyle = "#ff5fa2";
      ctx.fillRect(x0 - 4, L.finish_y - 110, 14, 110);
      ctx.fillRect(x1 - 10, L.finish_y - 110, 14, 110);
      ctx.fillStyle = "#ffd23f";
      roundRect(ctx, x0 - 4, L.finish_y - 130, x1 - x0 + 8, 34, 10);
      ctx.fill();
      ctx.fillStyle = "#5a2a00";
      ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("FINISH", (x0 + x1) / 2, L.finish_y - 112);
    }
  }

  _drawSpinner(s, th, world) {
    const ctx = this.ctx;
    if (!this._visible(s.x - s.arm, s.y - s.arm, s.arm * 2, s.arm * 2 + 20)) return;
    const lift = 10;
    for (let k = 0; k < s.arms; k++) {
      const a = s.angle + (k * TAU) / s.arms;
      const ex = s.x + Math.cos(a) * s.arm, ey = s.y + Math.sin(a) * s.arm;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = s.thick;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + 4);
      ctx.lineTo(ex, ey + 4);
      ctx.stroke();
      ctx.strokeStyle = th.bar;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - lift);
      ctx.lineTo(ex, ey - lift);
      ctx.stroke();
      ctx.strokeStyle = th.bar2;
      ctx.lineWidth = s.thick * 0.45;
      ctx.setLineDash([12, 14]);
      ctx.lineDashOffset = -world.clock * 30;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - lift);
      ctx.lineTo(ex, ey - lift);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const hub = s.hub || 14;
    ctx.fillStyle = "#3b3355";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 4, hub, hub * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#6c5fa0";
    ctx.beginPath();
    ctx.arc(s.x, s.y - lift - 6, hub, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.arc(s.x, s.y - lift - 6, hub * 0.4, 0, TAU);
    ctx.fill();
  }

  _drawSlider(w) {
    const ctx = this.ctx, H = 34;
    const x = w.cx - w.w / 2, y = w.y - w.h / 2;
    if (!this._visible(x, y - H, w.w, w.h + H + 10)) return;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    roundRect(ctx, x + 4, y + 6, w.w, w.h, 6);
    ctx.fill();
    ctx.fillStyle = "#3d7bd9";
    roundRect(ctx, x, y - H + w.h * 0.5, w.w, H + w.h * 0.5, 6);
    ctx.fill();
    ctx.fillStyle = "#7fb2ff";
    roundRect(ctx, x, y - H, w.w, w.h, 6);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    for (let i = 0; i < w.w - 20; i += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 10 + i, y - H + w.h + 6);
      ctx.lineTo(x + 30 + i, y - H + w.h + 6);
      ctx.lineTo(x + 20 + i, y - H + w.h + 22);
      ctx.fill();
    }
  }

  _drawBumper(b) {
    const ctx = this.ctx, s = 1 + b.pulse * 0.25;
    if (!this._visible(b.x - b.r, b.y - b.r - 30, b.r * 2, b.r * 2 + 40)) return;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(b.x + 3, b.y + 6, b.r, b.r * 0.7, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#c2185b";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y - 4, b.r * s, b.r * 0.8 * s, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff5fa2";
    ctx.beginPath();
    ctx.arc(b.x, b.y - 20, b.r * s, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(b.x, b.y - 20, b.r * 0.6 * s, 0, TAU);
    ctx.stroke();
  }

  // ------------------------------------------------------------------ characters

  _drawBody(b, world, isFollowed) {
    const ctx = this.ctx, r = world.R, P = world.P;
    if (!this._visible(b.x - 40, b.y - 90, 80, 120)) return;
    let scale = 1;
    if (b.falling) scale = Math.max(0.05, 1 - b.fallT / P.fall_time);

    if (!b.falling) {
      const h = Math.min(b.z, 140) / 140;
      ctx.fillStyle = `rgba(0,0,0,${0.3 * (1 - h * 0.6)})`;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + 2, r * (1 - h * 0.4), r * 0.45 * (1 - h * 0.4), 0, 0, TAU);
      ctx.fill();
    }

    let sx = 1, sy = 1;
    if (b.squash > 0) { sx = 1 + b.squash * 0.35; sy = 1 - b.squash * 0.3; }
    else if (b.z > 2 && !b.diving) { sx = 0.9; sy = 1.12; }
    const cx = b.x, cy = b.y - r - b.z;

    ctx.save();
    ctx.translate(cx, cy);
    if (b.diving || b.sliding) {
      ctx.translate(0, r * 0.5);
      ctx.rotate(Math.atan2(b.fy, b.fx) + Math.PI / 2);
      sx *= 1.05; sy *= 0.85;
    }
    ctx.scale(sx * scale, sy * scale);
    drawBlob(ctx, b, r, world.clock);
    ctx.restore();

    if (b.stun > 0.05 && !b.sliding && !b.falling) {
      for (let i = 0; i < 3; i++) {
        const a = world.clock * 6 + (i * TAU) / 3;
        star(ctx, cx + Math.cos(a) * 14, cy - r - 8 + Math.sin(a) * 4, 4, "#ffe066");
      }
    }
    if (b.crown) crown(ctx, cx, cy - r - 10 + Math.sin(world.clock * 3) * 2);

    if (isFollowed && b.isHuman && !b.falling) {
      const ty = cy - r - (b.crown ? 34 : 14) + Math.sin(world.clock * 5) * 2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(cx - 7, ty - 10);
      ctx.lineTo(cx + 7, ty - 10);
      ctx.lineTo(cx, ty);
      ctx.fill();
      ctx.font = "bold 13px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText(b.name, cx, ty - 12);
      ctx.fillText(b.name, cx, ty - 12);
    }
  }

  _drawParticles(dt) {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      if (p.rot != null) {
        p.rot += dt * 8;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  _drawProgress(world, followId) {
    const ctx = this.ctx, L = world.level;
    const x = VIEW_W - 34, top = 90, bottom = VIEW_H - 40;
    const start = L.spawn.y + L.spawn.h / 2, end = L.finish_y;
    const toY = (y) => bottom - ((start - y) / (start - end)) * (bottom - top);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x - 8, top - 14, 16, bottom - top + 28, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 8, top - 14, 16, 6);
    for (const cp of world.checkpoints) {
      ctx.fillStyle = "#3c9cff";
      ctx.fillRect(x - 8, toY(cp.y) - 1, 16, 2);
    }
    const bodies = world.bodies.slice().sort((a, b) => (a.id === followId) - (b.id === followId));
    for (const b of bodies) {
      const yy = Math.max(top - 10, Math.min(bottom, toY(b.finished ? end : b.y)));
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x, yy, b.id === followId ? 7 : 4, 0, TAU);
      ctx.fill();
      if (b.id === followId) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

// ---------------------------------------------------------------- shapes

/** The game's original character: a round gumdrop creature with an antenna. */
export function drawBlob(ctx, b, r, clock) {
  const fx = b.fx || 0, fy = b.fy || 0;
  const step = Math.sin(b.walk * 2);
  const dark = shade(b.color, -0.35), light = shade(b.color, 0.45);

  // feet
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-6, r - 2 + step * 2, 5, 3.5, 0, 0, TAU);
  ctx.ellipse(6, r - 2 - step * 2, 5, 3.5, 0, 0, TAU);
  ctx.fill();

  // antenna
  const tipX = -fx * 4 + Math.sin(clock * 4 + b.walk) * 2, tipY = -r - 11;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, -r + 3);
  ctx.quadraticCurveTo(tipX * 0.3, -r - 6, tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3.8, 0, TAU);
  ctx.fill();

  // body
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.2, 0, 0, r * 1.1);
  g.addColorStop(0, light);
  g.addColorStop(0.55, b.color);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(r * 0.9, -r, r * 1.05, r * 0.2, r * 0.95, r * 0.55);
  ctx.quadraticCurveTo(0, r * 1.1, -r * 0.95, r * 0.55);
  ctx.bezierCurveTo(-r * 1.05, r * 0.2, -r * 0.9, -r, 0, -r);
  ctx.fill();
  if (b.hitT > 0) {
    ctx.fillStyle = `rgba(255,255,255,${b.hitT * 2})`;
    ctx.fill();
  }

  // belly patch
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(0, r * 0.35, r * 0.5, r * 0.32, 0, 0, TAU);
  ctx.fill();

  // eyes look where the character is heading
  const ex = fx * 4, ey = fy * 3 - 3;
  const blink = Math.sin(clock * 1.7 + b.walk * 0.1) > 0.985 ? 0.2 : 1;
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(side * 5.5 + ex, ey, 4, 5 * blink, 0, 0, TAU);
    ctx.fill();
    if (blink > 0.5) {
      ctx.fillStyle = "#1d1433";
      ctx.beginPath();
      ctx.arc(side * 5.5 + ex + fx * 1.6, ey + fy * 1.6 + 0.5, 2.2, 0, TAU);
      ctx.fill();
    }
  }
  // cheeks
  ctx.fillStyle = "rgba(255,120,150,0.45)";
  ctx.beginPath();
  ctx.ellipse(-10 + ex * 0.5, ey + 6, 3, 2, 0, 0, TAU);
  ctx.ellipse(10 + ex * 0.5, ey + 6, 3, 2, 0, 0, TAU);
  ctx.fill();
}

function star(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}

function crown(ctx, x, y) {
  ctx.fillStyle = "#ffd23f";
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 12, y);
  ctx.lineTo(x - 12, y - 12);
  ctx.lineTo(x - 6, y - 6);
  ctx.lineTo(x, y - 16);
  ctx.lineTo(x + 6, y - 6);
  ctx.lineTo(x + 12, y - 12);
  ctx.lineTo(x + 12, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function flag(ctx, x, y, color) {
  ctx.fillStyle = "#555";
  ctx.fillRect(x - 1.5, y - 34, 3, 34);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y - 34);
  ctx.lineTo(x + 18, y - 28);
  ctx.lineTo(x + 1.5, y - 22);
  ctx.fill();
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${A.map((c, i) => Math.round(c + (B[i] - c) * t)).join(",")})`;
}
