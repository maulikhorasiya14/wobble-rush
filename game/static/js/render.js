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

  draw(world, followId, dt, _alpha = 1) {
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
    if (th.snow) this._drawSnow(world);
    else for (const s of this.stars) {
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
    this._drawExtras(world, th);
    this._drawLines(world);
    for (const s of world.spinners) this._drawSpinner(s, th, world);

    // Tall things and characters sorted by depth.
    const items = [];
    for (const w of world.sliders) items.push({ y: w.y + w.h / 2, f: () => this._drawSlider(w) });
    for (const b of world.bumpers) items.push({ y: b.y, f: () => this._drawBumper(b) });
    for (const p of world.pendulums) items.push({ y: p.y, f: () => this._drawBall(p.bx, p.y, p.r, "#ff5fa2", p.x) });
    for (const r of world.rollers) items.push({ y: r.y, f: () => this._drawBall(r.x, r.y, r.r, "#f4fbff") });
    for (const d of world.doors) if (!d.broken) items.push({ y: d.y + d.h, f: () => this._drawDoor(d) });
    for (const lg of world.logs) items.push({ y: lg.y, f: () => this._drawLog(lg) });
    for (const b of world.bodies) {
      if (b.hidden || b.eliminated) continue;
      items.push({ y: b.y + (b.falling ? -1000 : 0), f: () => this._drawBody(b, world, b.id === followId) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();

    this._drawParticles(dt);

    // HUD-ish overlays in screen space
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (world.type === "race" && !world.tutorial) drawProgressBar(ctx, world, followId);
  }

  /** Snowflakes drifting down the screen, blown sideways by the gusts. */
  _drawSnow(world) {
    const ctx = this.ctx;
    const gust = world.zones.find((z) => z.type === "gust" && z.active);
    const wx = gust && Number.isFinite(gust.fx) ? gust.fx : 0;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(110,150,205,0.45)";
    ctx.lineWidth = 1;
    for (const s of this.stars) {
      const t = world.clock;
      const x = ((s.x + t * (20 + wx * 0.9) + Math.sin(t + s.tw) * 12) % VIEW_W + VIEW_W) % VIEW_W;
      const y = ((s.y + t * (45 + s.r * 20)) % VIEW_H + VIEW_H) % VIEW_H;
      ctx.beginPath();
      ctx.arc(x, y, s.r + 0.8, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }

  _updateCamera(world, followId, dt) {
    const L = world.level, cam = this.cam;
    let tx, ty, tz;
    if (L.camera !== "follow") {
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
    const ctx = this.ctx, cfg = world.tiles.cfg, s = cfg.size, hex = world.tiles.hex;
    const shapePath = (x, y, size) => {
      if (!hex) { roundRect(ctx, x - size / 2, y - size / 2, size, size, 8); return; }
      const R = size / Math.sqrt(3);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
      }
      ctx.closePath();
    };
    for (const t of world.tiles.list) {
      let x = t.x, y = t.y;
      if (t.state === "gone") {
        if (t.goneT > 0.5) continue;
        const k = 1 - t.goneT / 0.5;
        ctx.globalAlpha = k;
        ctx.fillStyle = th.side;
        shapePath(t.x, t.y + t.goneT * 120, s * k);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      let top = t.ring % 2 ? th.floorA : th.floorB;
      if (t.state === "crack") {
        const k = 1 - t.t / (t.max || cfg.crack_time);
        x += (Math.random() - 0.5) * 3 * k;
        y += (Math.random() - 0.5) * 3 * k;
        top = mix(top, th.crack, Math.min(1, 0.3 + k));
      }
      ctx.fillStyle = th.side;
      shapePath(x, y + 6, s);
      ctx.fill();
      ctx.fillStyle = top;
      shapePath(x, y, s);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      shapePath(x, y - 2, s * 0.6);
      ctx.fill();
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

  /** Belts, ice, wind, bounce pads and moving platforms (flat things on the floor). */
  _drawExtras(world, th) {
    const ctx = this.ctx;
    // Tilting platforms: shaded toward the low side, with an arrow showing the lean.
    for (const t of world.tilts) {
      if (!this._visible(t.x, t.y, t.w, t.h)) continue;
      ctx.fillStyle = th.side;
      roundRect(ctx, t.x, t.y + 10, t.w, t.h + 12, 12);
      ctx.fill();
      const g = ctx.createLinearGradient(t.x, 0, t.x + t.w, 0);
      const dark = "rgba(42,27,94,0.35)", none = "rgba(42,27,94,0)";
      g.addColorStop(0, t.angle < 0 ? dark : none);
      g.addColorStop(1, t.angle > 0 ? dark : none);
      ctx.fillStyle = th.floorA;
      roundRect(ctx, t.x, t.y, t.w, t.h, 12);
      ctx.fill();
      ctx.fillStyle = g;
      ctx.globalAlpha = Math.min(1, Math.abs(t.angle) * 1.5);
      roundRect(ctx, t.x, t.y, t.w, t.h, 12);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#b47cff";
      ctx.lineWidth = 4;
      roundRect(ctx, t.x, t.y, t.w, t.h, 12);
      ctx.stroke();
      ctx.fillStyle = "#b47cff";
      ctx.beginPath();
      ctx.moveTo(t.x + t.w / 2, t.y + t.h - 6);
      ctx.lineTo(t.x + t.w / 2 - 14, t.y + t.h + 10);
      ctx.lineTo(t.x + t.w / 2 + 14, t.y + t.h + 10);
      ctx.fill();
    }
    // Trust and crumble tiles: all look alike; cracking ones shake, gone ones vanish.
    for (const g of world.ghosts) {
      if (g.st === 2 || !this._visible(g.x, g.y, g.w, g.h)) continue;
      const shake = g.st === 1 ? Math.sin(world.clock * 70) * 3 : 0;
      ctx.fillStyle = th.side;
      roundRect(ctx, g.x + shake, g.y + 8, g.w, g.h + 8, 10);
      ctx.fill();
      ctx.fillStyle = g.st === 1 ? "#ffd6a6" : g.kind === "crumble" ? "#f1e4c6" : "#e8f2ff";
      roundRect(ctx, g.x + shake, g.y, g.w, g.h, 10);
      ctx.fill();
      ctx.strokeStyle = g.known ? "#3ddc97" : "rgba(42,27,94,0.25)";
      ctx.lineWidth = g.known ? 5 : 2;
      ctx.stroke();
      if (g.st === 1) {
        ctx.strokeStyle = "rgba(90,40,0,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(g.x + g.w * 0.2 + shake, g.y + g.h * 0.3);
        ctx.lineTo(g.x + g.w * 0.5 + shake, g.y + g.h * 0.55);
        ctx.lineTo(g.x + g.w * 0.8 + shake, g.y + g.h * 0.4);
        ctx.stroke();
      }
    }
    for (const d of world.discs) {
      ctx.fillStyle = th.side;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 10, d.r, d.r, 0, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = i % 2 ? th.floorA : th.floorB;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.arc(d.x, d.y, d.r, d.angle + (i / 12) * TAU, d.angle + ((i + 1) / 12) * TAU);
        ctx.fill();
      }
    }
    for (const p of world.popups) {
      ctx.fillStyle = p.rise > 0.5 ? "#ff8c42" : "rgba(42,27,94,0.3)";
      ctx.fillRect(p.x, p.y - p.rise * 20, p.w, p.h);
    }
    for (const p of world.pistons) {
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(p.cx - p.w / 2, p.y - p.h / 2 - 14, p.w, p.h);
      ctx.strokeStyle = "#2a1b5e";
      ctx.lineWidth = 3;
      ctx.strokeRect(p.cx - p.w / 2, p.y - p.h / 2 - 14, p.w, p.h);
    }
    for (const c of world.cannons) {
      ctx.fillStyle = "#2a1b5e";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 26, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#2a1b5e";
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x + Math.cos(c.aim) * 44, c.y + Math.sin(c.aim) * 44);
      ctx.stroke();
    }
    for (const m of world.meteors) {
      if (m.t <= 0) continue;
      ctx.strokeStyle = "rgba(255,51,85,0.85)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.stroke();
    }
    for (const m of world.movers) {
      const x = m.cx - m.w / 2;
      ctx.fillStyle = th.side;
      roundRect(ctx, x, m.y + 8, m.w, m.h + 14, 14);
      ctx.fill();
      ctx.fillStyle = th.floorA;
      roundRect(ctx, x, m.y, m.w, m.h, 14);
      ctx.fill();
      ctx.strokeStyle = "#ffb800";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    for (const z of world.zones) {
      if (!this._visible(z.x, z.y, z.w, z.h)) continue;
      if (z.type === "ice") ctx.fillStyle = "rgba(190,235,255,0.6)";
      else if (z.type === "conveyor") ctx.fillStyle = "rgba(90,74,122,0.55)";
      else if (z.type === "gust") continue;
      else ctx.fillStyle = z.active ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(z.x, z.y, z.w, z.h);
      if (z.type !== "ice") {
        const len = Math.hypot(z.fx, z.fy) || 1, ux = z.fx / len, uy = z.fy / len;
        const shift = ((world.clock * 60) % 60);
        ctx.strokeStyle = z.type === "conveyor" ? "#ffd23f" : "rgba(255,255,255,0.8)";
        ctx.lineWidth = 4;
        ctx.save();
        ctx.beginPath();
        ctx.rect(z.x, z.y, z.w, z.h);
        ctx.clip();
        for (let gx = z.x + 30; gx < z.x + z.w; gx += 60) {
          for (let gy = z.y + 30; gy < z.y + z.h; gy += 60) {
            const cx = gx + ux * shift, cy = gy + uy * shift;
            ctx.beginPath();
            ctx.moveTo(cx - ux * 10 - uy * 10, cy - uy * 10 + ux * 10);
            ctx.lineTo(cx + ux * 8, cy + uy * 8);
            ctx.lineTo(cx - ux * 10 + uy * 10, cy - uy * 10 - ux * 10);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    for (const p of world.pads) {
      ctx.fillStyle = `rgba(61,255,184,${0.7 + p.pulse * 0.3})`;
      roundRect(ctx, p.x, p.y, p.w, p.h, 10);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  /** A mystery door: purple with a "?"; a real one, once found, gets a red X. */
  _drawDoor(d) {
    const ctx = this.ctx, H = 34;
    ctx.fillStyle = "#3a1d8f";
    roundRect(ctx, d.x, d.y - H + d.h, d.w, H, 6);
    ctx.fill();
    ctx.fillStyle = d.known ? "#ff8fab" : "#b47cff";
    roundRect(ctx, d.x, d.y - H, d.w, H + 4, 8);
    ctx.fill();
    ctx.font = "bold 22px 'Fredoka', 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = d.known ? "#a3163a" : "#ffffff";
    ctx.fillText(d.known ? "\u2716" : "?", d.x + d.w / 2, d.y - H / 2 + 2);
  }

  /** A rolling log across the course. */
  _drawLog(lg) {
    const ctx = this.ctx;
    const y = lg.y - lg.r;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(lg.x0, lg.y + lg.r * 0.6, lg.x1 - lg.x0, 8);
    ctx.fillStyle = "#b5733f";
    roundRect(ctx, lg.x0, y - lg.r, lg.x1 - lg.x0, lg.r * 2, lg.r);
    ctx.fill();
    ctx.strokeStyle = "#7a4a22";
    ctx.lineWidth = 3;
    const off = (lg.rot * lg.r) % 24;
    for (let x = lg.x0 + 12 + off; x < lg.x1 - 6; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, y - lg.r + 4);
      ctx.lineTo(x - 6, y + lg.r - 4);
      ctx.stroke();
    }
  }

  _drawBall(x, y, r, color, pivotX) {
    const ctx = this.ctx;
    if (pivotX != null) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pivotX, y - 140);
      ctx.lineTo(x, y - r);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x, y + 4, r, r * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.6, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 2;
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

    // Name over your own character, and over every person in multiplayer.
    if (b.isHuman && !b.falling && (isFollowed || world.multiplayer)) {
      const ty = cy - r - (b.crown ? 34 : 14) + (isFollowed ? Math.sin(world.clock * 5) * 2 : 0);
      ctx.fillStyle = "#ffffff";
      if (isFollowed) {
        ctx.beginPath();
        ctx.moveTo(cx - 7, ty - 10);
        ctx.lineTo(cx + 7, ty - 10);
        ctx.lineTo(cx, ty);
        ctx.fill();
      }
      ctx.font = "bold 13px 'Trebuchet MS', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      const nameY = isFollowed ? ty - 14 : ty;
      ctx.strokeText(b.name, cx, nameY);
      ctx.fillText(b.name, cx, nameY);
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
}

/** Vertical race-progress bar on the right edge (screen space, 960x600 units). */
export function drawProgressBar(ctx, world, followId) {
  const L = world.level;
  if (!world.bodies.some((b) => b.isHuman)) return; // the menu's bot race doesn't need it
  const x = VIEW_W - 34, top = 90, bottom = VIEW_H - 40;
  const start = L.spawn.y + L.spawn.h / 2, end = L.finish_y;
  const toY = (y) => bottom - ((start - y) / (start - end)) * (bottom - top);
  ctx.fillStyle = "rgba(29,20,51,0.45)";
  roundRect(ctx, x - 9, top - 16, 18, bottom - top + 32, 9);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 9, top - 16, 18, 6);
  // Labels so it reads as "race progress": a finish flag on top, START at the bottom.
  ctx.font = "bold 10px 'Fredoka', 'Trebuchet MS', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(29,20,51,0.8)";
  ctx.strokeText("\u{1F3C1} FINISH", x - 4, top - 19);
  ctx.fillText("\u{1F3C1} FINISH", x - 4, top - 19);
  ctx.textBaseline = "top";
  ctx.strokeText("START", x, bottom + 18);
  ctx.fillText("START", x, bottom + 18);
  for (const cp of world.checkpoints) {
    ctx.fillStyle = "#3c9cff";
    ctx.fillRect(x - 9, toY(cp.y) - 1, 18, 2);
  }
  // Notches where each section of the course begins.
  for (const sp of L.section_spans || []) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(x - 13, toY(sp.y1) - 1, 4, 2);
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
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.font = "bold 10px 'Fredoka', 'Trebuchet MS', sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(29,20,51,0.8)";
      const label = b.isHuman && world.human && b.id === world.human.id ? "YOU" : b.name.toUpperCase();
      ctx.strokeText(label, x - 12, yy);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x - 12, yy);
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
