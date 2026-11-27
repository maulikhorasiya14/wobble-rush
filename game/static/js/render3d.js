// 3D renderer (three.js). Draws the same World simulation as the 2D renderer,
// with original 3D characters, lit courses, shadows, particles and a chase camera.
//
// World coordinates are pixels on a ground plane (x, y) plus a height z.
// Three.js space: X = x * S, Y = z * S (up), Z = y * S.  The course runs toward -Z.
import * as THREE from "../vendor/three/three.module.min.js";
import { drawProgressBar } from "./render.js";

const S = 1 / 20;          // world pixels -> scene units
const TAU = Math.PI * 2;
const SEA_Y = -14;         // height of the candy sea below the courses
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const ease = (t) => t * t * (3 - 2 * t);

/** True when this browser can run the 3D renderer. */
export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- textures

function canvasTexture(w, h, paint, { repeat = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function floorTexture(a, b) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    g.fillRect(0, h / 2, w, h / 2);
    g.fillStyle = "rgba(255,255,255,0.45)";
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        g.beginPath();
        g.arc((col + 0.5 + (row % 2) * 0.5) * (w / 4), (row + 0.5) * (h / 4), 7, 0, TAU);
        g.fill();
      }
    }
    // soft edge between bands
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.fillRect(0, h / 2 - 3, w, 6);
  });
}

function stripeTexture(c1, c2) {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = c1;
    g.fillRect(0, 0, w, h);
    g.fillStyle = c2;
    g.fillRect(0, h / 2, w, h / 2);
  });
}

function checkerTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        g.fillStyle = (x + y) % 2 ? "#1d1433" : "#ffffff";
        g.fillRect((x * w) / 2, (y * h) / 2, w / 2, h / 2);
      }
    }
  });
}

function chevronTexture() {
  return canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = "#2f6fe0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffd23f";
    for (let i = 0; i < 2; i++) {
      const x = i * 64;
      g.beginPath();
      g.moveTo(x + 12, 14);
      g.lineTo(x + 32, 14);
      g.lineTo(x + 52, 32);
      g.lineTo(x + 32, 50);
      g.lineTo(x + 12, 50);
      g.lineTo(x + 32, 32);
      g.closePath();
      g.fill();
    }
  });
}

function ringTexture(a, b) {
  return canvasTexture(512, 512, (g, w, h) => {
    const rings = 8;
    for (let i = rings; i > 0; i--) {
      g.fillStyle = i % 2 ? a : b;
      g.beginPath();
      g.arc(w / 2, h / 2, (i / rings) * (w / 2), 0, TAU);
      g.fill();
    }
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * TAU, r = w * 0.36;
      g.beginPath();
      g.arc(w / 2 + Math.cos(ang) * r, h / 2 + Math.sin(ang) * r, 5, 0, TAU);
      g.fill();
    }
  }, { repeat: false });
}

function bannerTexture(text, bg, fg) {
  return canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.font = "bold 84px Fredoka, 'Trebuchet MS', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 10;
    g.strokeStyle = "rgba(0,0,0,0.25)";
    g.strokeText(text, w / 2, h / 2 + 4);
    g.fillStyle = fg;
    g.fillText(text, w / 2, h / 2 + 4);
  }, { repeat: false });
}

function arrowTexture(fx, fy, bg, fg) {
  // Chevrons pointing in the push direction (canvas x = world x, canvas y = world y).
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    g.rotate(Math.atan2(fy, fx));
    g.fillStyle = fg;
    for (const off of [-32, 32]) {
      g.beginPath();
      g.moveTo(off - 16, -24);
      g.lineTo(off + 12, 0);
      g.lineTo(off - 16, 24);
      g.lineTo(off - 6, 0);
      g.closePath();
      g.fill();
    }
  });
}

function sparkleTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "rgba(255,255,255,0)";
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, l = 10 + Math.random() * 30;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + l, y + l * 0.4);
      g.stroke();
    }
  });
}

function seaTexture(color) {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,0.22)";
    g.lineWidth = 6;
    g.lineCap = "round";
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w, y = Math.random() * h, l = 20 + Math.random() * 40;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + l / 2, y - 8, x + l, y);
      g.stroke();
    }
  });
}

function nameTexture(name) {
  return canvasTexture(256, 96, (g, w, h) => {
    g.font = "600 40px Fredoka, 'Trebuchet MS', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const tw = Math.min(w - 8, g.measureText(name).width + 34);
    g.fillStyle = "rgba(29,20,51,0.75)";
    roundRect(g, (w - tw) / 2, 4, tw, 54, 27);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillText(name, w / 2, 32);
    g.beginPath();
    g.moveTo(w / 2 - 14, 66);
    g.lineTo(w / 2 + 14, 66);
    g.lineTo(w / 2, 88);
    g.closePath();
    g.fill();
  }, { repeat: false });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------- geometry

/** A rounded slab whose top face is at y = 0, covering world rect (x, y, w, h). */
function slabGeometry(x, y, w, h, depth, radius = 0.7, bevel = 0.22) {
  const X = x * S + bevel, Y = y * S + bevel, W = w * S - bevel * 2, H = h * S - bevel * 2;
  const r = Math.min(radius, W / 2, H / 2);
  // Shape coordinates are (X, -Z) so that after rotating onto the ground the
  // cap UVs line up with world space.
  const shape = new THREE.Shape();
  const x0 = X, x1 = X + W, y0 = -(Y + H), y1 = -Y;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.max.y, 0);
  return g;
}

function starShape(r = 0.16) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
}

// ---------------------------------------------------------------- characters

const BODY_H = 1.75;

function makeCharacterAssets() {
  const profile = new THREE.SplineCurve([
    new THREE.Vector2(0.001, 0), new THREE.Vector2(0.5, 0.02), new THREE.Vector2(0.74, 0.12),
    new THREE.Vector2(0.86, 0.36), new THREE.Vector2(0.88, 0.65), new THREE.Vector2(0.83, 0.98),
    new THREE.Vector2(0.72, 1.28), new THREE.Vector2(0.53, 1.52), new THREE.Vector2(0.29, 1.69),
    new THREE.Vector2(0.001, BODY_H),
  ]).getPoints(28);
  const mouth = new THREE.TorusGeometry(0.1, 0.028, 8, 16, Math.PI);
  mouth.rotateZ(Math.PI);
  const foot = new THREE.CapsuleGeometry(0.17, 0.2, 4, 10);
  foot.rotateX(Math.PI / 2);
  foot.scale(1, 0.7, 1);
  const arm = new THREE.CapsuleGeometry(0.13, 0.32, 4, 10);
  arm.translate(0, -0.3, 0);
  const crownGeo = new THREE.CylinderGeometry(0.45, 0.4, 0.32, 10, 1, true);
  const spike = new THREE.ConeGeometry(0.1, 0.24, 6);
  return {
    body: new THREE.LatheGeometry(profile, 40),
    belly: new THREE.SphereGeometry(0.5, 24, 16),
    eye: new THREE.SphereGeometry(0.2, 20, 14),
    pupil: new THREE.SphereGeometry(0.1, 14, 10),
    glint: new THREE.SphereGeometry(0.035, 8, 6),
    cheek: new THREE.CircleGeometry(0.1, 16),
    mouth, foot, arm,
    stalk: new THREE.CylinderGeometry(0.035, 0.045, 0.45, 8),
    tip: new THREE.SphereGeometry(0.13, 16, 12),
    star: new THREE.ExtrudeGeometry(starShape(), { depth: 0.05, bevelEnabled: false }),
    crown: crownGeo, spike,
    shadow: new THREE.CircleGeometry(0.85, 24),
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1d1433, roughness: 0.2 }),
    cheekMat: new THREE.MeshBasicMaterial({ color: 0xff7aa0, transparent: true, opacity: 0.55, depthWrite: false }),
    starMat: new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffb000, emissiveIntensity: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffcc33, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }),
    shadowMat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    colorMats: new Map(),
  };
}

function colorMaterials(A, hex) {
  if (A.colorMats.has(hex)) return A.colorMats.get(hex);
  const base = new THREE.Color(hex);
  const mats = {
    body: new THREE.MeshPhysicalMaterial({
      color: base, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25,
    }),
    light: new THREE.MeshPhysicalMaterial({ color: base.clone().lerp(new THREE.Color(0xffffff), 0.45), roughness: 0.4, clearcoat: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.5 }),
    tip: new THREE.MeshStandardMaterial({
      color: base.clone().lerp(new THREE.Color(0xffffff), 0.55), emissive: base, emissiveIntensity: 0.35, roughness: 0.3,
    }),
  };
  A.colorMats.set(hex, mats);
  return mats;
}

/** Build one original "gumdrop" character. */
function buildCharacter(A, color, name, withTag) {
  const m = colorMaterials(A, color);
  const root = new THREE.Group();
  const tumble = new THREE.Group();
  tumble.position.y = BODY_H / 2;
  root.add(tumble);
  const inner = new THREE.Group();
  inner.position.y = -BODY_H / 2;
  tumble.add(inner);
  const pivot = new THREE.Group();
  inner.add(pivot);

  const mesh = (geo, mat, cast = true) => {
    const o = new THREE.Mesh(geo, mat);
    o.castShadow = cast;
    return o;
  };

  const body = mesh(A.body, m.body);
  pivot.add(body);
  const belly = mesh(A.belly, m.light, false);
  belly.scale.set(1, 0.72, 0.42);
  belly.position.set(0, 0.55, -0.62);
  pivot.add(belly);

  const face = new THREE.Group();
  pivot.add(face);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = mesh(A.eye, A.white, false);
    eye.scale.set(1, 1.2, 0.55);
    eye.position.set(side * 0.27, 1.18, -0.72);
    const pupil = mesh(A.pupil, A.black, false);
    pupil.position.set(0, -0.02, -0.14);
    pupil.scale.set(1, 1, 0.7);
    eye.add(pupil);
    const glint = mesh(A.glint, A.white, false);
    glint.position.set(-0.04, 0.05, -0.2);
    eye.add(glint);
    face.add(eye);
    eyes.push(eye);
    const cheek = new THREE.Mesh(A.cheek, A.cheekMat);
    cheek.position.set(side * 0.5, 0.94, -0.7);
    cheek.rotation.y = Math.PI + side * 0.6;
    face.add(cheek);
  }
  const mouth = mesh(A.mouth, A.black, false);
  mouth.position.set(0, 0.95, -0.84);
  mouth.rotation.x = -0.25;
  face.add(mouth);

  const antenna = new THREE.Group();
  antenna.position.y = BODY_H - 0.06;
  const stalk = mesh(A.stalk, m.dark);
  stalk.position.y = 0.22;
  antenna.add(stalk);
  const tip = mesh(A.tip, m.tip);
  tip.position.y = 0.5;
  antenna.add(tip);
  pivot.add(antenna);

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.8, 0.88, 0);
    shoulder.add(mesh(A.arm, m.body));
    pivot.add(shoulder);
    arms.push(shoulder);
  }

  const feet = [];
  for (const side of [-1, 1]) {
    const f = mesh(A.foot, m.dark);
    f.position.set(side * 0.34, 0.12, -0.05);
    inner.add(f);
    feet.push(f);
  }

  const crown = new THREE.Group();
  crown.add(mesh(A.crown, A.gold));
  for (let i = 0; i < 5; i++) {
    const s = mesh(A.spike, A.gold);
    const a = (i / 5) * TAU;
    s.position.set(Math.cos(a) * 0.42, 0.26, Math.sin(a) * 0.42);
    crown.add(s);
  }
  crown.position.y = BODY_H + 0.12;
  crown.visible = false;
  pivot.add(crown);

  const stars = new THREE.Group();
  stars.position.y = BODY_H + 0.55;
  for (let i = 0; i < 3; i++) stars.add(mesh(A.star, A.starMat, false));
  stars.visible = false;
  root.add(stars);

  let tag = null;
  if (withTag) {
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name), depthTest: false, transparent: true }));
    tag.scale.set(2.6, 0.975, 1);
    tag.position.y = BODY_H + 1.5;
    tag.renderOrder = 10;
    root.add(tag);
  }

  const shadow = new THREE.Mesh(A.shadow, A.shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;

  return {
    root, tumble, pivot, eyes, antenna, arms, feet, crown, stars, tag, shadow,
    anim: {
      yaw: 0, phase: Math.random() * TAU, stride: 0, jelly: 0, jellyV: 0,
      q: new THREE.Quaternion(), spin: new THREE.Vector3(), ragdoll: 0,
      blink: 2 + Math.random() * 3, ant: 0, antV: 0, lastVx: 0, lastVy: 0,
      wasGround: true, splashed: false, wasHidden: false, dustT: 0, flail: 0,
    },
  };
}

/** Pose a character from its simulation body. */
function animateCharacter(c, b, x, y, z, dt, clock, P) {
  const a = c.anim;
  const R = c.root;
  R.position.set(x * S, z * S, y * S);
  const speed = Math.hypot(b.vx, b.vy);
  const ground = z <= 0.5 && !b.falling;

  // Facing: turn smoothly toward the direction of travel.
  if (a.ragdoll <= 0 && (speed > 25 || b.diving)) {
    const target = Math.atan2(-b.fx, -b.fy);
    let d = target - a.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.yaw += d * damp(b.diving ? 20 : 13, dt);
  }
  R.rotation.y = a.yaw;

  // Run cycle
  const moving = ground && speed > 20 && !b.sliding && b.stun <= 0;
  a.stride = lerp(a.stride, moving ? Math.min(1, speed / P.max_speed) : 0, damp(10, dt));
  if (moving) a.phase += dt * (7 + speed * 0.04);

  // Landing / jelly wobble (spring)
  if (ground && !a.wasGround) a.jellyV -= 2.2;
  a.wasGround = ground;
  a.jellyV += (-90 * a.jelly - 9 * a.jellyV) * dt;
  a.jelly += a.jellyV * dt;

  // Squash & stretch
  let sy = 1, sxz = 1;
  if (b.squash > 0) { sy -= b.squash * 0.3; sxz += b.squash * 0.2; }
  if (!ground && !b.diving && !b.falling) {
    const k = clamp(b.vz / P.jump_speed, -1, 1);
    sy += Math.abs(k) * 0.12;
    sxz -= Math.abs(k) * 0.06;
  }
  sy *= 1 + a.jelly * 0.35;
  sxz *= 1 - a.jelly * 0.18;
  const breathe = 1 + Math.sin(clock * 2.4 + a.phase) * 0.015 * (1 - a.stride);
  c.pivot.scale.set(sxz, sy * breathe, sxz);
  c.pivot.position.y = ground ? Math.abs(Math.sin(a.phase)) * 0.14 * a.stride : 0;

  // Ragdoll tumble when knocked, otherwise lean / dive pose.
  if (a.ragdoll > 0 || b.falling) {
    a.ragdoll -= dt;
    const w = a.spin.length();
    if (w > 1e-3) {
      tmpQ.setFromAxisAngle(tmpV.copy(a.spin).divideScalar(w), w * dt);
      a.q.premultiply(tmpQ);
    }
    a.spin.multiplyScalar(Math.exp(-(b.falling ? 0.4 : 2.2) * dt));
    if (b.falling && a.spin.lengthSq() < 4) a.spin.set(2.5, 0, 1.5);
  } else {
    const pitch = b.diving || b.sliding ? -1.35 : -0.22 * a.stride;
    tmpQ.setFromEuler(tmpE.set(pitch, 0, 0));
    a.q.slerp(tmpQ, damp(b.diving ? 16 : 9, dt));
  }
  c.tumble.quaternion.copy(a.q);

  // Arms
  const [al, ar] = c.arms;
  const tumbling = a.ragdoll > 0 || b.falling || (b.stun > 0 && !b.sliding);
  if (b.diving || b.sliding) {
    al.rotation.set(2.9, 0, -0.25);
    ar.rotation.set(2.9, 0, 0.25);
  } else if (tumbling || (!ground && b.vz < -150)) {
    const f = Math.sin(clock * 22) * 0.5;
    al.rotation.set(f, 0, -2.3 - f * 0.4);
    ar.rotation.set(-f, 0, 2.3 - f * 0.4);
  } else if (!ground) {
    al.rotation.set(0.3, 0, -1.9);
    ar.rotation.set(0.3, 0, 1.9);
  } else {
    const sw = Math.sin(a.phase) * 1.0 * a.stride;
    const idle = Math.sin(clock * 2 + a.phase) * 0.06 * (1 - a.stride);
    al.rotation.set(sw, 0, -0.35 - idle - a.stride * 0.1);
    ar.rotation.set(-sw, 0, 0.35 + idle + a.stride * 0.1);
  }

  // Feet
  const [fl, fr] = c.feet;
  if (ground && !b.sliding) {
    const s = Math.sin(a.phase), cs = Math.cos(a.phase);
    fl.position.set(-0.34, 0.12 + Math.max(0, cs) * 0.2 * a.stride, -0.05 - s * 0.36 * a.stride);
    fr.position.set(0.34, 0.12 + Math.max(0, -cs) * 0.2 * a.stride, -0.05 + s * 0.36 * a.stride);
  } else {
    const kick = Math.sin(clock * 14) * 0.15 * (tumbling ? 1 : 0.3);
    fl.position.set(-0.32, 0.2 + kick, 0.05);
    fr.position.set(0.32, 0.2 - kick, 0.05);
  }

  // Antenna: springy secondary motion driven by acceleration.
  const ax = (b.vx - a.lastVx) / Math.max(dt, 1e-4), ay = (b.vy - a.lastVy) / Math.max(dt, 1e-4);
  a.lastVx = b.vx;
  a.lastVy = b.vy;
  const fwdAcc = -(ax * -Math.sin(a.yaw) + ay * -Math.cos(a.yaw)) * 0.00012;
  a.antV += (-120 * a.ant - 7 * a.antV + clamp(fwdAcc, -0.6, 0.6) * 60 + (ground ? 0 : -b.vz * 0.004)) * dt;
  a.ant = clamp(a.ant + a.antV * dt, -0.9, 0.9);
  c.antenna.rotation.x = a.ant + Math.sin(a.phase * 2) * 0.08 * a.stride;

  // Blink
  a.blink -= dt;
  const closed = a.blink < 0.12;
  if (a.blink < 0) a.blink = 2 + Math.random() * 3.5;
  for (const e of c.eyes) e.scale.y = closed || tumbling ? 0.25 : 1.2;

  // Dizzy stars
  const dizzy = b.stun > 0.05 && !b.sliding && !b.falling && !b.diving;
  c.stars.visible = dizzy;
  if (dizzy) {
    c.stars.children.forEach((s, i) => {
      const an = clock * 6 + (i * TAU) / 3;
      s.position.set(Math.cos(an) * 0.65, Math.sin(an * 2) * 0.08, Math.sin(an) * 0.65);
      s.rotation.y = clock * 4;
    });
  }
  c.crown.visible = !!b.crown;
  if (b.crown) c.crown.rotation.y = clock * 0.8;

  // Blob shadow on the ground
  const sh = c.shadow;
  sh.visible = !b.falling && R.visible;
  if (sh.visible) {
    const h = clamp(z / 160, 0, 1);
    sh.position.set(x * S, 0.03, y * S);
    const sc = 1 - h * 0.45;
    sh.scale.set(sc, sc, sc);
  }
}

// ---------------------------------------------------------------- particles

class Particles {
  constructor(scene) {
    const max = 700;
    this.max = max;
    this.list = [];
    const puffMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), puffMat, max);
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.frustumCulled = false;
    this.puffs.count = 0;
    const confMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide });
    this.conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.16), confMat, max);
    this.conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.conf.frustumCulled = false;
    this.conf.count = 0;
    // Prime the colour buffers.
    const c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < max; i++) { this.puffs.setColorAt(i, c); this.conf.setColorAt(i, c); }
    scene.add(this.puffs, this.conf);
  }

  emit(o) {
    if (this.list.length >= this.max * 2) return;
    this.list.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: o.life, max: o.life, size: o.size, g: o.g ?? 0, drag: o.drag ?? 1.5,
      color: new THREE.Color(o.color), confetti: !!o.confetti, grow: o.grow ?? 0,
      rx: Math.random() * TAU, ry: Math.random() * TAU, spin: (Math.random() - 0.5) * 14,
    });
  }

  burst(p, n, color, speed, life, size, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.6);
      this.emit({
        x: p.x, y: p.y + (opts.up ?? 0.3), z: p.z,
        vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: (opts.vy ?? 1.5) * (0.5 + Math.random()),
        life: life * (0.7 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8),
        color, g: opts.g ?? 0, grow: opts.grow ?? 0, drag: opts.drag,
      });
    }
  }

  confetti(p, n) {
    const colors = [0xff5fa2, 0xffd23f, 0x5b8cff, 0x3ddc97, 0xff8c42, 0xb47cff, 0x40d9ff];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 2 + Math.random() * 5;
      this.emit({
        x: p.x, y: p.y + 1.5, z: p.z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, vy: 6 + Math.random() * 7,
        life: 2.2, size: 1, color: colors[i % colors.length], g: 12, drag: 1.2, confetti: true,
      });
    }
  }

  update(dt) {
    let np = 0, nc = 0;
    const keep = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.g * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d;
      if (p.confetti) p.vy = Math.max(p.vy, -3.5); // flutter
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = p.life / p.max;
      if (p.confetti) {
        if (nc >= this.max) continue;
        p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
        tmpQ.setFromEuler(tmpE.set(p.rx, p.ry, 0));
        tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS.set(1, 1, 1));
        this.conf.setMatrixAt(nc, tmpM);
        this.conf.setColorAt(nc, p.color);
        nc++;
      } else {
        if (np >= this.max) continue;
        const s = p.size * (p.grow ? (1 + (1 - t) * p.grow) * Math.min(1, t * 3) : t);
        tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ.identity(), tmpS.set(s, s, s));
        this.puffs.setMatrixAt(np, tmpM);
        this.puffs.setColorAt(np, p.color);
        np++;
      }
      keep.push(p);
    }
    this.list = keep;
    this.puffs.count = np;
    this.conf.count = nc;
    this.puffs.instanceMatrix.needsUpdate = true;
    this.conf.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
    if (this.conf.instanceColor) this.conf.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- sky

function makeSky(theme) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky[0]) },
      horizon: { value: new THREE.Color(theme.sky[1]) },
      bottom: { value: new THREE.Color(theme.sea).lerp(new THREE.Color(theme.sky[1]), 0.5) },
      sunDir: { value: new THREE.Vector3(-0.4, 0.55, 0.5).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(min(h * 1.4, 1.0), 0.7)) : mix(horizon, bottom, pow(min(-h * 3.0, 1.0), 0.6));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(sun, 300.0) * 2.5 + pow(sun, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), mat);
  sky.renderOrder = -1;
  return sky;
}

// ---------------------------------------------------------------- renderer

export class Renderer3D {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay ? overlay.getContext("2d") : null;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.95;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.ratio = Math.min(this.maxRatio, 1.25);
    this.badRatio = Infinity; // lowest resolution that proved too slow
    this.goodT = 0;
    this.fps = 60;
    this.camera = new THREE.PerspectiveCamera(58, 16 / 10, 0.1, 1500);
    this.pmrem = new THREE.PMREMGenerator(this.gl);
    this.A = makeCharacterAssets();
    this.world = null;
    this.mode = "play";
    this.modeT = 0;
    this.shake = 0;
    this.frameAvg = 1 / 60;
    this.perfT = 0;
    this.camPos = new THREE.Vector3(0, 10, 10);
    this.camYaw = 0;      // orbit camera heading (0 = looking up the course)
    this.camPitch = 0.42; // orbit camera tilt above the horizon (radians)
    this.zoom = 1;
    this.lookSpeed = 0.0035; // radians per pixel of mouse movement
    this.blend = 1;
    this.blendFromPos = new THREE.Vector3();
    this.blendFromLook = new THREE.Vector3();
    this.orbitTarget = null;
    this.camLook = new THREE.Vector3();
    this.envCache = new Map();
    this.pending = [];
    this.resize();
    window.addEventListener("resize", () => { this.needsResize = true; });
  }

  resize() {
    const w = this.canvas.clientWidth || 960, h = this.canvas.clientHeight || 600;
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.gl.setPixelRatio(this.ratio);
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.overlay) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.overlay.width = 960 * dpr;
      this.overlay.height = 600 * dpr;
      this.odpr = dpr;
    }
  }

  /** Camera style: "menu" (cinematic follow), "intro" (course fly-over) or "play". */
  cinematic(mode) {
    this.mode = mode;
    this.modeT = 0;
    this.camYaw = 0;
    this.camPitch = 0.42;
    this.blend = 0;
    this.blendFromPos.copy(this.camPos);
    this.blendFromLook.copy(this.camLook);
    this.orbitTarget = null;
  }

  consume(events, followId) {
    for (const e of events) this.pending.push({ ...e, follow: e.id === followId });
  }

  // ------------------------------------------------------------ level build

  _disposeLevel() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.userData.levelOwned) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          for (const k of ["map", "emissiveMap"]) m[k]?.dispose?.();
          m.dispose();
        }
      }
    });
  }

  _own(o) {
    o.traverse((c) => { c.userData.levelOwned = true; });
    return o;
  }

  _build(world) {
    this._disposeLevel();
    const L = world.level, th = L.theme;
    const scene = new THREE.Scene();
    this.scene = scene;
    this.world = world;
    this.pending = [];
    // Forget the previous round's level pieces; only the ones this level
    // builds below should be animated (e.g. no tiles in the final).
    this.tileMesh = null;
    this.tileColors = null;
    this.arena = null;
    this.flags = [];
    this.decor = [];
    this.spinners = [];
    this.sliders = [];
    this.bumpers = [];
    this.zoneViews = [];
    this.padViews = [];
    this.pendViews = [];
    this.moverViews = [];
    this.rollerViews = [];
    this.discViews = [];
    this.pistonViews = [];
    this.popupViews = [];
    this.cannonViews = [];
    this.meteorViews = [];
    this.doorViews = [];
    this.ghostViews = [];
    this.tiltViews = [];
    this.logViews = [];
    this.doorMats = null;

    const sky = this._own(makeSky(th));
    scene.add(sky);
    this.sky = sky;
    // Races: the haze closes in well before the finish (courses are 9,000+ px),
    // so the finish line stays a surprise until you get near it.
    const race = world.level.type === "race";
    scene.fog = new THREE.Fog(new THREE.Color(th.sky[1]), race ? 70 : 90, race ? 330 : 420);
    scene.environment = this._envFor(th);

    const hemi = new THREE.HemisphereLight(new THREE.Color(th.sky[0]).lerp(new THREE.Color(0xffffff), 0.5), new THREE.Color(th.sea), 0.65);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    sc.near = 1;
    sc.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    // Candy sea
    const seaTex = seaTexture(th.sea);
    seaTex.repeat.set(60, 60);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: seaTex, roughness: 0.12, metalness: 0.05 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = SEA_Y;
    sea.receiveShadow = false;
    scene.add(this._own(sea));
    this.sea = sea;
    this.seaTex = seaTex;

    const W = L.bounds.w * S, H = L.bounds.h * S;
    this.center = new THREE.Vector3(W / 2, 0, H / 2);
    this._buildClouds(scene, W, H);
    this._buildDecor(scene, W, H, th);

    this.static = new THREE.Group();
    scene.add(this.static);
    this._buildFloors(world, th);
    if (world.tiles) this._buildTiles(world, th);
    if (L.arena) this._buildArena(world, th);
    this._buildLines(world);
    this.spinners = world.spinners.map((s) => this._buildSpinner(s, th));
    this.sliders = world.sliders.map((s) => this._buildSlider(s));
    this.bumpers = world.bumpers.map((b) => this._buildBumper(b));
    this.zoneViews = world.zones.map((z) => this._buildZone(z));
    this.padViews = world.pads.map((p) => this._buildPad(p));
    this.pendViews = world.pendulums.map((p) => this._buildPendulum(p));
    this.moverViews = world.movers.map((m) => this._buildMover(m, th));
    this.discViews = world.discs.map((d) => this._buildDisc(d, th));
    this.pistonViews = world.pistons.map((p) => this._buildPiston(p));
    this.popupViews = world.popups.map((p) => this._buildPopup(p));
    this.cannonViews = world.cannons.map((c) => this._buildCannon(c));
    this.doorViews = world.doors.map((d) => this._buildDoor(d));
    this.ghostViews = world.ghosts.map((g) => this._buildGhost(g, th));
    this.tiltViews = world.tilts.map((t) => this._buildTilt(t, th));

    this.chars = new Map();
    for (const b of world.bodies) {
      const c = buildCharacter(this.A, b.color, b.name, b.isHuman);
      c.anim.yaw = Math.atan2(-b.fx, -b.fy);
      scene.add(c.root, c.shadow);
      this.chars.set(b.id, c);
    }

    this.particles = new Particles(scene);
    this._own(this.particles.puffs);
    this._own(this.particles.conf);
    this.static.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    this._snapCamera = true;
    this._collectCullables(world);
  }

  /**
   * Things that sit fully inside the fog are hidden instead of drawn: fogged
   * objects turn the flat fog colour, and against the sky's gradient their
   * outline would still show (a pale "ghost" finish arch on the horizon).
   */
  _collectCullables(world) {
    this.cull = [];
    if (world.level.type !== "race") return;
    const box = new THREE.Box3(), sphere = new THREE.Sphere();
    // Characters and rolling balls set their own visibility each frame (see _inSight).
    const skip = new Set([this.sky, this.sea, this.particles?.puffs, this.particles?.conf, ...this.rollerViews,
      ...this.doorViews.map((v) => v.m), ...this.ghostViews.map((v) => v.m)]);
    for (const c of this.chars.values()) { skip.add(c.root); skip.add(c.shadow); }
    const add = (o, moving) => {
      if (skip.has(o) || o.isLight || o.isCamera) return;
      box.setFromObject(o);
      if (box.isEmpty()) return;
      box.getBoundingSphere(sphere);
      if (sphere.radius > 120) return; // long floors: flat, they fade into the horizon anyway
      const local = moving ? sphere.center.clone().sub(o.getWorldPosition(new THREE.Vector3())) : null;
      this.cull.push({ o, center: moving ? null : sphere.center.clone(), local, r: sphere.radius + (moving ? 15 : 0) });
    };
    for (const o of this.static.children) add(o, false);
    for (const o of this.scene.children) if (o !== this.static) add(o, true);
    this.cullT = 0;
  }

  /** Is world point (x, y) closer than the fog's far edge? (Races only.) */
  _inSight(x, y) {
    if (!this.cull?.length || !this.scene.fog) return true;
    const cam = this.camera.position;
    return Math.hypot(x * S - cam.x, y * S - cam.z) < this.scene.fog.far + 3;
  }

  _cullFar(dt) {
    if (!this.cull?.length || !this.scene.fog) return;
    this.cullT -= dt;
    if (this.cullT > 0) return;
    this.cullT = 0.2;
    const cam = this.camera.position, far = this.scene.fog.far, p = new THREE.Vector3();
    for (const c of this.cull) {
      const at = c.center || c.o.getWorldPosition(p).add(c.local);
      c.o.visible = at.distanceTo(cam) - c.r < far;
    }
  }

  _envFor(th) {
    const key = th.sky.join() + th.sea;
    if (this.envCache.has(key)) return this.envCache.get(key);
    const envScene = new THREE.Scene();
    envScene.add(makeSky(th));
    // A couple of bright panels give glossy materials nice highlights.
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    panel.position.set(-150, 250, 150);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
    const tex = this.pmrem.fromScene(envScene, 0.02).texture;
    this.envCache.set(key, tex);
    return tex;
  }

  _buildClouds(scene, W, H) {
    const puffs = [];
    const n = Math.round(14 + H / 12);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? -1 : 1;
      const cx = side < 0 ? -20 - Math.random() * 80 : W + 20 + Math.random() * 80;
      const cz = -60 + Math.random() * (H + 120);
      const cy = -6 + Math.random() * 26;
      const k = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < k; j++) {
        puffs.push([cx + (j - k / 2) * 3.2, cy + Math.random() * 1.6, cz + (Math.random() - 0.5) * 4, 2.4 + Math.random() * 2.2]);
      }
    }
    const mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 }),
      puffs.length,
    );
    puffs.forEach(([x, y, z, s], i) => {
      tmpM.compose(tmpV.set(x, y, z), tmpQ.identity(), tmpS.set(s, s * 0.75, s));
      mesh.setMatrixAt(i, tmpM);
    });
    scene.add(this._own(mesh));
  }

  _buildDecor(scene, W, H, th) {
    // Floating candy rings and balloons around the course (pure decoration).
    this.decor = [];
    const colors = [0xff5fa2, 0xffd23f, 0x5b8cff, 0x3ddc97, 0xff8c42, 0xb47cff];
    const torus = new THREE.TorusGeometry(2.2, 0.55, 16, 40);
    const ball = new THREE.SphereGeometry(1.6, 24, 16);
    const n = Math.round(8 + H / 25);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? -1 : 1;
      const x = side < 0 ? -8 - Math.random() * 18 : W + 8 + Math.random() * 18;
      const z = Math.random() * H;
      const y = 1 + Math.random() * 9;
      const mat = new THREE.MeshPhysicalMaterial({ color: colors[i % colors.length], roughness: 0.25, clearcoat: 1 });
      const m = new THREE.Mesh(i % 3 ? ball : torus, mat);
      m.position.set(x, y, z);
      m.castShadow = false;
      scene.add(this._own(m));
      this.decor.push({ m, y, ph: Math.random() * TAU, ring: !(i % 3) });
    }
  }

  _buildFloors(world, th) {
    const floors = world.level.floors || [];
    if (!floors.length) return;
    const tex = floorTexture(th.floorA, th.floorB);
    tex.repeat.set(1 / 6, 1 / 6);
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 });
    const side = new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.55 });
    for (const f of floors) {
      const g = slabGeometry(f.x, f.y, f.w, f.h, 1.6);
      const m = new THREE.Mesh(g, [top, side]);
      m.receiveShadow = true;
      m.castShadow = true;
      this.static.add(this._own(m));
    }
  }

  _buildTiles(world, th) {
    const cfg = world.tiles.cfg;
    let g;
    if (world.tiles.hex) {
      // Pointy-top hexagonal prism (CylinderGeometry puts a corner on +Z).
      const R = (cfg.size / Math.sqrt(3)) * S;
      g = new THREE.CylinderGeometry(R, R * 0.96, 0.9, 6, 1);
      g.translate(0, -0.45, 0);
    } else {
      g = slabGeometry(-cfg.size / 2, -cfg.size / 2, cfg.size, cfg.size, 0.9, 0.35, 0.12);
    }
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, clearcoat: 0.6 });
    const mesh = new THREE.InstancedMesh(g, mat, world.tiles.list.length);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tileMesh = this._own(mesh);
    this.tileColors = [new THREE.Color(th.floorA), new THREE.Color(th.floorB), new THREE.Color(th.crack)];
    this.scene.add(mesh);
  }

  _buildArena(world, th) {
    const A = world.level.arena;
    const g = new THREE.CylinderGeometry(1, 1, 2.2, 96, 1);
    g.translate(0, -1.1, 0);
    const top = new THREE.MeshPhysicalMaterial({ map: ringTexture(th.floorA, th.floorB), roughness: 0.4, clearcoat: 0.4 });
    const side = new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.5 });
    const disc = new THREE.Mesh(g, [side, top, side]);
    disc.receiveShadow = true;
    disc.position.set(A.x * S, 0, A.y * S);
    this.scene.add(this._own(disc));
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.012, 8, 128),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff3355, emissiveIntensity: 0 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(A.x * S, 0.05, A.y * S);
    this.scene.add(this._own(rim));
    this.arena = { disc, rim };
  }

  _floorSpan(world, y) {
    const L = world.level, cx = L.bounds.w / 2;
    const f = (L.floors || []).find((f) => y >= f.y && y <= f.y + f.h && cx >= f.x && cx <= f.x + f.w);
    return f ? [f.x, f.x + f.w] : [0, L.bounds.w];
  }

  _buildLines(world) {
    const L = world.level;
    this.flags = [];
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8);
    const flagGeo = new THREE.PlaneGeometry(0.9, 0.55);
    flagGeo.translate(0.45, 0, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.6, roughness: 0.3 });
    for (const cp of world.checkpoints) {
      const [x0, x1] = this._floorSpan(world, cp.y);
      const line = new THREE.Mesh(
        new THREE.BoxGeometry((x1 - x0) * S - 0.6, 0.04, 0.22),
        new THREE.MeshBasicMaterial({ color: 0x3c9cff, transparent: true, opacity: 0.75 }),
      );
      line.position.set(((x0 + x1) / 2) * S, 0.03, cp.y * S);
      this.static.add(this._own(line));
      for (const x of [x0 + 12, x1 - 12]) {
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x * S, 1.2, cp.y * S);
        pole.castShadow = true;
        this.static.add(this._own(pole));
        const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0x3c9cff, side: THREE.DoubleSide }));
        flag.position.set(x * S, 2.1, cp.y * S);
        flag.castShadow = true;
        this.scene.add(this._own(flag));
        this.flags.push(flag);
      }
    }
    if (L.finish_y == null) return;
    const fy = L.finish_y;
    const [x0, x1] = this._floorSpan(world, fy + 10);
    const ct = checkerTexture();
    ct.repeat.set(((x1 - x0) * S) / 1.5, 1);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * S - 0.5, 2), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.6 }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(((x0 + x1) / 2) * S, 0.02, (fy - 20) * S);
    strip.receiveShadow = true;
    this.static.add(this._own(strip));
    // Arch
    const pillarMat = new THREE.MeshPhysicalMaterial({ color: 0xff5fa2, roughness: 0.3, clearcoat: 1 });
    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 7, 20);
    for (const x of [x0 + 8, x1 - 8]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(x * S, 3.5, fy * S);
      p.castShadow = true;
      this.static.add(this._own(p));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xffd23f, roughness: 0.2, clearcoat: 1 }));
      ball.position.set(x * S, 7.6, fy * S);
      ball.castShadow = true;
      this.static.add(this._own(ball));
    }
    const bw = (x1 - x0) * S - 1;
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(bw, 1.8, 0.4),
      [null, null, null, null, null, null].map((_, i) => (i === 4 || i === 5)
        ? new THREE.MeshStandardMaterial({ map: bannerTexture("FINISH", "#ff4fa0", "#ffffff"), roughness: 0.4 })
        : new THREE.MeshStandardMaterial({ color: 0xff4fa0, roughness: 0.4 })),
    );
    banner.position.set(((x0 + x1) / 2) * S, 6.4, fy * S);
    banner.castShadow = true;
    this.static.add(this._own(banner));
  }

  _buildSpinner(s, th) {
    const g = new THREE.Group();
    g.position.set(s.x * S, 0, s.y * S);
    const hubR = (s.hub || 14) * S;
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(hubR, hubR * 1.15, 2.4, 24),
      new THREE.MeshPhysicalMaterial({ color: 0x6c5fa0, roughness: 0.3, clearcoat: 0.8 }),
    );
    hub.position.y = 1.2;
    hub.castShadow = true;
    g.add(hub);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(hubR * 0.55, hubR * 0.55, 0.25, 20),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffaa00, emissiveIntensity: 0.4 }),
    );
    cap.position.y = 2.5;
    g.add(cap);
    const rotor = new THREE.Group();
    g.add(rotor);
    const tex = stripeTexture(th.bar, th.bar2);
    tex.repeat.set(1, (s.arm * S) / 1.4);
    const barMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 0.8 });
    const r = (s.thick / 2) * S;
    const armGeo = new THREE.CylinderGeometry(r, r, 1, 16, 1, true);
    armGeo.rotateZ(Math.PI / 2);
    armGeo.translate(0.5, 0, 0);
    const capGeo = new THREE.SphereGeometry(r, 16, 12);
    const arms = [];
    for (let k = 0; k < 4; k++) {
      const pivot = new THREE.Group();
      pivot.position.y = 0.62;
      const bar = new THREE.Mesh(armGeo, barMat);
      bar.castShadow = true;
      const end = new THREE.Mesh(capGeo, barMat);
      end.castShadow = true;
      pivot.add(bar, end);
      rotor.add(pivot);
      arms.push({ pivot, bar, end });
    }
    this.scene.add(this._own(g));
    return { g, rotor, arms };
  }

  _buildSlider(w) {
    const H = 2.5;
    const g = slabGeometry(-w.w / 2, -w.h / 2, w.w, w.h, H, 0.4, 0.15);
    g.translate(0, H + 0.3, 0);
    const chevron = chevronTexture();
    chevron.repeat.set((w.w * S) / 3, 1);
    const side = new THREE.MeshPhysicalMaterial({ map: chevron, roughness: 0.3, clearcoat: 0.8 });
    const top = new THREE.MeshPhysicalMaterial({ color: 0x8fbcff, roughness: 0.3, clearcoat: 0.8 });
    const m = new THREE.Mesh(g, [top, side]);
    m.castShadow = true;
    m.receiveShadow = true;
    // Side UVs from ExtrudeGeometry run around the outline; scale them to the wall height.
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) / (H + 0.3));
    m.position.set(w.cx * S, 0, w.y * S);
    this.scene.add(this._own(m));
    return m;
  }

  _buildBumper(b) {
    const g = new THREE.Group();
    g.position.set(b.x * S, 0, b.y * S);
    const r = b.r * S;
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.75, r * 0.9, 1.2, 28),
      new THREE.MeshPhysicalMaterial({ color: 0xc2185b, roughness: 0.35, clearcoat: 0.6 }),
    );
    base.position.y = 0.6;
    base.castShadow = true;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r, 32, 16, 0, TAU, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0xff5fa2, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
    );
    dome.position.y = 1.15;
    dome.scale.y = 0.75;
    dome.castShadow = true;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r * 0.95, 0.16, 12, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.2;
    g.add(base, dome, ring);
    this.scene.add(this._own(g));
    return { g, dome, ring };
  }

  _buildZone(z) {
    const geo = new THREE.PlaneGeometry(z.w * S, z.h * S);
    geo.rotateX(-Math.PI / 2);
    const view = { z, fans: [] };
    if (z.type === "conveyor") {
      const tex = arrowTexture(z.fx, z.fy, "#5a4a7a", "#ffd23f");
      tex.repeat.set((z.w * S) / 2.4, (z.h * S) / 2.4);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      m.position.set((z.x + z.w / 2) * S, 0.03, (z.y + z.h / 2) * S);
      m.receiveShadow = true;
      this.scene.add(this._own(m));
      const len = Math.hypot(z.fx, z.fy) || 1;
      view.tex = tex;
      view.uv = [z.fx / len, -z.fy / len]; // texture scroll direction
      view.rate = (len * S) / 2.4;
    } else if (z.type === "ice") {
      const tex = sparkleTexture();
      tex.repeat.set((z.w * S) / 6, (z.h * S) / 6);
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0xcff3ff, map: tex, transparent: true, opacity: 0.75, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
      }));
      m.position.set((z.x + z.w / 2) * S, 0.025, (z.y + z.h / 2) * S);
      m.receiveShadow = true;
      this.scene.add(this._own(m));
    } else if (z.type === "gust") {
      const tex = arrowTexture(1, 0, "rgba(255,255,255,0)", "rgba(255,255,255,0.9)");
      tex.repeat.set((z.w * S) / 6, (z.h * S) / 6);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      m.position.set((z.x + z.w / 2) * S, 0.06, (z.y + z.h / 2) * S);
      this.scene.add(this._own(m));
      view.mesh = m;
      view.tex = tex;
    } else if (z.type === "wind") {
      // Faint arrows on the ground while it blows, plus fans on the upwind edge.
      const tex = arrowTexture(z.fx, z.fy, "rgba(255,255,255,0)", "rgba(255,255,255,0.9)");
      tex.repeat.set((z.w * S) / 4, (z.h * S) / 4);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      m.position.set((z.x + z.w / 2) * S, 0.04, (z.y + z.h / 2) * S);
      this.scene.add(this._own(m));
      view.mesh = m;
      view.tex = tex;
      const len = Math.hypot(z.fx, z.fy) || 1;
      view.uv = [z.fx / len, -z.fy / len];
      const ux = z.fx / len, uy = z.fy / len;
      const along = Math.abs(ux) > Math.abs(uy);
      const count = Math.max(1, Math.round((along ? z.h : z.w) / 160));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const fx = along ? (ux > 0 ? z.x - 30 : z.x + z.w + 30) : z.x + z.w * t;
        const fy = along ? z.y + z.h * t : (uy > 0 ? z.y - 30 : z.y + z.h + 30);
        view.fans.push(this._buildFan(fx, fy, Math.atan2(-ux, -uy)));
      }
    }
    return view;
  }

  _buildFan(x, y, yaw) {
    const g = new THREE.Group();
    g.position.set(x * S, 0, y * S);
    g.rotation.y = yaw;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x6c5fa0, roughness: 0.4 }));
    stand.position.y = 0.7;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.18, 12, 32),
      new THREE.MeshPhysicalMaterial({ color: 0xff8c42, roughness: 0.3, clearcoat: 1 }));
    ring.position.y = 2.1;
    const blades = new THREE.Group();
    blades.position.y = 2.1;
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, side: THREE.DoubleSide });
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.05), bladeMat);
      b.position.y = 0.55;
      const holder = new THREE.Group();
      holder.rotation.z = (k * Math.PI) / 2;
      holder.add(b);
      blades.add(holder);
    }
    for (const o of [stand, ring]) o.castShadow = true;
    g.add(stand, ring, blades);
    this.scene.add(this._own(g));
    return { g, blades };
  }

  _buildPad(p) {
    const g = new THREE.Group();
    g.position.set((p.x + p.w / 2) * S, 0, (p.y + p.h / 2) * S);
    const base = new THREE.Mesh(new THREE.BoxGeometry(p.w * S, 0.35, p.h * S),
      new THREE.MeshStandardMaterial({ color: 0x23806f, roughness: 0.4 }));
    base.position.y = 0.17;
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.w * S - 0.3, 0.14, p.h * S - 0.3),
      new THREE.MeshStandardMaterial({ map: arrowTexture(p.dx, p.dy, "#3dffb8", "#ffffff"), emissive: 0x2ee6a6, emissiveIntensity: 0.6 }));
    top.material.map.repeat.set(Math.max(1, Math.round((p.w * S) / 2.4)), 1);
    top.position.y = 0.42;
    base.receiveShadow = top.receiveShadow = true;
    g.add(base, top);
    this.scene.add(this._own(g));
    return { g, top };
  }

  _buildPendulum(p) {
    const H = 11; // height of the beam
    const reach = (p.amp + 90) * S;
    const g = new THREE.Group();
    g.position.set(p.x * S, 0, p.y * S);
    const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x6c5fa0, roughness: 0.3, clearcoat: 0.8 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, H + 14, 14), frameMat);
      post.position.set(sx * reach, H / 2 - 7, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(reach * 2 + 1, 0.7, 0.7), frameMat);
    beam.position.y = H;
    beam.castShadow = true;
    g.add(beam);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 }));
    g.add(rope);
    const tex = stripeTexture("#ff5fa2", "#ffffff");
    tex.repeat.set(3, 2);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(p.r * S, 32, 20),
      new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.25, clearcoat: 1 }));
    ball.castShadow = true;
    g.add(ball);
    this.scene.add(this._own(g));
    return { g, rope, ball, H };
  }

  _buildMover(m, th) {
    const tex = floorTexture(th.floorA, th.floorB);
    tex.repeat.set(1 / 6, 1 / 6);
    const geo = slabGeometry(-m.w / 2, m.y, m.w, m.h, 1.2);
    const mesh = new THREE.Mesh(geo, [
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 }),
      new THREE.MeshStandardMaterial({ color: 0xffb800, roughness: 0.5 }),
    ]);
    mesh.receiveShadow = mesh.castShadow = true;
    this.scene.add(this._own(mesh));
    return mesh;
  }

  _buildDisc(d, th) {
    const g = new THREE.Group();
    g.position.set(d.x * S, 0, d.y * S);
    const r = d.r * S;
    const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.97, 1.4, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.5 }));
    side.position.y = -0.7;
    const tex = canvasTexture(512, 512, (c, w, h) => {
      const n = 12;
      for (let i = 0; i < n; i++) {
        c.fillStyle = i % 2 ? th.floorA : th.floorB;
        c.beginPath();
        c.moveTo(w / 2, h / 2);
        c.arc(w / 2, h / 2, w / 2, (i / n) * TAU, ((i + 1) / n) * TAU);
        c.fill();
      }
      c.fillStyle = "#ffd23f";
      c.beginPath();
      c.arc(w / 2, h / 2, w * 0.08, 0, TAU);
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.8)";
      c.lineWidth = 10;
      c.beginPath();
      c.arc(w / 2, h / 2, w / 2 - 6, 0, TAU);
      c.stroke();
    }, { repeat: false });
    const top = new THREE.Mesh(new THREE.CircleGeometry(r, 64),
      new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.6 }));
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    const spin = new THREE.Group();
    spin.add(top);
    g.add(side, spin);
    this.scene.add(this._own(g));
    return spin;
  }

  _buildPiston(p) {
    const H = 2.2;
    const g = new THREE.Group();
    // Housing where the piston sits when pulled in (on the far side of the punch).
    const housing = new THREE.Mesh(new THREE.BoxGeometry(p.w * S * 0.9, H + 0.6, p.h * S + 0.6),
      new THREE.MeshPhysicalMaterial({ color: 0x6c5fa0, roughness: 0.35, clearcoat: 0.6 }));
    housing.position.set((p.x0 - p.dir * p.w * 0.55) * S, (H + 0.6) / 2, p.y * S);
    housing.castShadow = true;
    this.scene.add(this._own(housing));
    const tex = canvasTexture(128, 64, (c, w, h) => {
      c.fillStyle = "#ffd23f";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#2a1b5e";
      for (let x = -h; x < w; x += 32) {
        c.beginPath();
        c.moveTo(x, h); c.lineTo(x + 16, h); c.lineTo(x + 16 + h, 0); c.lineTo(x + h, 0);
        c.fill();
      }
    });
    tex.repeat.set((p.w * S) / 2.5, 1);
    const block = new THREE.Mesh(new THREE.BoxGeometry(p.w * S, H, p.h * S),
      new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 0.8 }));
    block.position.y = H / 2;
    block.castShadow = block.receiveShadow = true;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.3 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.y = H / 2;
    g.add(block);
    this.scene.add(this._own(g), this._own(rod));
    return { g, rod, housingX: housing.position.x };
  }

  _buildPopup(p) {
    const H = 2.4;
    const tex = stripeTexture("#ff8c42", "#ffffff");
    tex.repeat.set(2, 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w * S, H, p.h * S),
      new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 0.8 }));
    m.castShadow = m.receiveShadow = true;
    m.position.set((p.x + p.w / 2) * S, -H / 2, (p.y + p.h / 2) * S);
    // A slot in the floor shows where a block will pop up.
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(p.w * S, p.h * S),
      new THREE.MeshBasicMaterial({ color: 0x2a1b5e, transparent: true, opacity: 0.35, depthWrite: false }));
    slot.rotation.x = -Math.PI / 2;
    slot.position.set((p.x + p.w / 2) * S, 0.03, (p.y + p.h / 2) * S);
    this.scene.add(this._own(m), this._own(slot));
    return { m, H };
  }

  _buildCannon(c) {
    const g = new THREE.Group();
    g.position.set(c.x * S, 0, c.y * S);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 30, 20),
      new THREE.MeshStandardMaterial({ color: 0xc48a3f, roughness: 0.5 }));
    pedestal.position.y = -15.2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.8, 20),
      new THREE.MeshPhysicalMaterial({ color: 0x6c5fa0, roughness: 0.3, clearcoat: 0.8 }));
    base.position.y = 0.4;
    const turret = new THREE.Group();
    turret.position.y = 1.4;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 3.2, 20),
      new THREE.MeshPhysicalMaterial({ color: 0x2a1b5e, roughness: 0.25, clearcoat: 1 }));
    barrel.rotation.z = -Math.PI / 2 + 0.15;
    barrel.position.x = 1.2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.2, 10, 24),
      new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xff8800, emissiveIntensity: 0 }));
    rim.rotation.y = Math.PI / 2;
    rim.position.set(2.75, 0.25, 0);
    turret.add(barrel, rim);
    for (const o of [base, barrel]) o.castShadow = true;
    g.add(pedestal, base, turret);
    this.scene.add(this._own(g));
    return { turret, rim };
  }

  // ---- mystery doors, trust tiles, tilting platforms, logs

  _buildDoor(d) {
    const H = 3.4;
    if (!this.doorMats) {
      const side = new THREE.MeshPhysicalMaterial({ color: 0x6c3cff, roughness: 0.35, clearcoat: 0.8 });
      const face = new THREE.MeshPhysicalMaterial({ map: bannerTexture("?", "#b47cff", "#ffffff"), roughness: 0.35, clearcoat: 0.6 });
      const xSide = new THREE.MeshPhysicalMaterial({ color: 0xc2185b, roughness: 0.35, clearcoat: 0.8 });
      const xFace = new THREE.MeshPhysicalMaterial({ map: bannerTexture("\u2716", "#ff8fab", "#a3163a"), roughness: 0.35, clearcoat: 0.6 });
      this.doorMats = { normal: [side, side, side, side, face, face], known: [xSide, xSide, xSide, xSide, xFace, xFace] };
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.w * S, H, Math.max(d.h * S, 0.6)), this.doorMats.normal);
    m.position.set((d.x + d.w / 2) * S, H / 2, (d.y + d.h / 2) * S);
    m.castShadow = m.receiveShadow = true;
    this.scene.add(this._own(m));
    return { m, known: false };
  }

  _buildGhost(g, th) {
    const geo = slabGeometry(g.x, g.y, g.w, g.h, 1.0, 0.5, 0.15);
    const base = g.kind === "crumble" ? 0xf1e4c6 : 0xe8f2ff;
    const top = new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.25, clearcoat: 0.9, emissive: 0x000000 });
    const side = new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.55 });
    const m = new THREE.Mesh(geo, [top, side]);
    m.receiveShadow = m.castShadow = true;
    this.scene.add(this._own(m));
    return { m, top, base, drop: 0 };
  }

  _buildTilt(t, th) {
    const g = new THREE.Group();
    g.position.set((t.x + t.w / 2) * S, 0, (t.y + t.h / 2) * S);
    const tex = floorTexture(th.floorA, th.floorB);
    tex.repeat.set(1 / 6, 1 / 6);
    const slab = new THREE.Mesh(slabGeometry(-t.w / 2, -t.h / 2, t.w, t.h, 1.2), [
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42 }),
      new THREE.MeshPhysicalMaterial({ color: 0xb47cff, roughness: 0.35, clearcoat: 0.6 }),
    ]);
    slab.receiveShadow = slab.castShadow = true;
    // A pivot post under the middle shows what it rocks on.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0x6c5fa0, roughness: 0.5 }));
    post.position.y = -5.2;
    g.add(slab, post);
    this.scene.add(this._own(g));
    return { g, slab };
  }

  _logView(i) {
    if (!this.logViews[i]) {
      const tex = stripeTexture("#b5733f", "#9a5f30");
      tex.repeat.set(6, 1);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      const g = new THREE.Group();
      g.add(body);
      this.scene.add(this._own(g));
      this.logViews[i] = { g, body };
    }
    return this.logViews[i];
  }

  _meteorView(i) {
    if (!this.meteorViews[i]) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1),
        new THREE.MeshStandardMaterial({ color: 0x7a4a2a, emissive: 0xff5a1f, emissiveIntensity: 0.8, flatShading: true }));
      rock.castShadow = true;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48),
        new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(this._own(rock), this._own(ring));
      this.meteorViews[i] = { rock, ring };
    }
    return this.meteorViews[i];
  }

  _rollerView(i) {
    if (!this.rollerViews[i]) {
      const tex = stripeTexture("#ffffff", "#cfefff");
      tex.repeat.set(4, 2);
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18),
        new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.35, clearcoat: 0.5 }));
      m.castShadow = true;
      this.scene.add(this._own(m));
      this.rollerViews[i] = m;
    }
    return this.rollerViews[i];
  }

  // ------------------------------------------------------------ per frame

  _sync(world, alpha, dt) {
    const clock = world.clock;
    // Spinners
    world.spinners.forEach((s, i) => {
      const v = this.spinners[i];
      const ang = (s.pangle ?? s.angle) + ((s.angle - (s.pangle ?? s.angle)) * alpha);
      v.rotor.rotation.y = -ang;
      v.arms.forEach((arm, k) => {
        arm.pivot.visible = k < s.arms;
        arm.pivot.rotation.y = -(k * TAU) / s.arms;
        arm.bar.scale.x = s.arm * S;
        arm.end.position.x = s.arm * S;
      });
    });
    world.sliders.forEach((w, i) => {
      const cx = lerp(w.pcx ?? w.cx, w.cx, alpha);
      this.sliders[i].position.x = cx * S;
    });
    world.bumpers.forEach((b, i) => {
      const v = this.bumpers[i];
      const p = 1 + b.pulse * 0.3;
      v.g.scale.set(p, 1 + b.pulse * 0.15, p);
      v.ring.material.emissiveIntensity = 0.3 + b.pulse * 1.5;
    });
    for (const f of this.flags) f.rotation.y = Math.sin(clock * 3 + f.position.x) * 0.35;
    world.discs.forEach((d, i) => {
      this.discViews[i].rotation.y = -lerp(d.pangle, d.angle, alpha);
    });
    world.pistons.forEach((p, i) => {
      const v = this.pistonViews[i];
      const cx = lerp(p.pcx, p.cx, alpha) * S;
      v.g.position.set(cx, 0, p.y * S);
      const rodLen = Math.abs(cx - v.housingX);
      v.rod.scale.y = Math.max(0.01, rodLen);
      v.rod.position.set((cx + v.housingX) / 2, 1.1, p.y * S);
    });
    world.popups.forEach((p, i) => {
      const v = this.popupViews[i];
      v.m.position.y = -v.H / 2 + ease(p.rise) * v.H;
    });
    world.cannons.forEach((c, i) => {
      const v = this.cannonViews[i];
      v.turret.rotation.y = -c.aim;
      v.rim.material.emissiveIntensity = c.flash * 2.5;
    });
    world.doors.forEach((d, i) => {
      const v = this.doorViews[i];
      v.m.visible = !d.broken && this._inSight(d.x, d.y);
      if (d.known && !v.known) { v.known = true; v.m.material = this.doorMats.known; }
    });
    world.ghosts.forEach((g, i) => {
      const v = this.ghostViews[i];
      if (g.st === 2) {
        // Drop away, then hide (crumble tiles come back later).
        v.drop = Math.min(v.drop + dt * 18, 30);
        v.m.position.y = -v.drop;
        v.m.visible = v.drop < 29;
        return;
      }
      v.drop = 0;
      v.m.visible = this._inSight(g.x, g.y);
      const shake = g.st === 1 ? Math.sin(clock * 70) * 0.12 : 0;
      v.m.position.set(shake, 0, 0);
      v.top.color.setHex(g.st === 1 ? 0xffb366 : g.known ? 0x9df5c9 : v.base);
      v.top.emissive.setHex(g.known ? 0x1f8a5a : 0x000000);
      v.top.emissiveIntensity = g.known ? 0.35 : 0;
    });
    world.tilts.forEach((t, i) => {
      this.tiltViews[i].g.rotation.z = -t.angle * 0.24;
    });
    for (let i = 0; i < Math.max(world.logs.length, this.logViews.length); i++) {
      const lg = world.logs[i];
      if (!lg && !this.logViews[i]) continue;
      const v = this._logView(i);
      v.g.visible = !!lg && this._inSight((lg.x0 + lg.x1) / 2, lg.y);
      if (!lg) continue;
      const y = lerp(lg.py ?? lg.y, lg.y, alpha);
      v.body.scale.set(lg.r * S, (lg.x1 - lg.x0) * S, lg.r * S);
      v.g.position.set(((lg.x0 + lg.x1) / 2) * S, lg.r * S, y * S);
      v.g.rotation.x = -lg.rot;
    }
    for (let i = 0; i < Math.max(world.meteors.length, this.meteorViews.length); i++) {
      const m = world.meteors[i];
      if (!m && !this.meteorViews[i]) continue;
      const v = this._meteorView(i);
      v.rock.visible = v.ring.visible = !!m && m.t > 0;
      if (!m || m.t <= 0) continue;
      const k = 1 - m.t / m.T; // 0 -> 1 as it falls
      v.ring.scale.setScalar(m.r * S);
      v.ring.position.set(m.x * S, 0.08, m.y * S);
      v.ring.material.opacity = 0.5 + Math.sin(clock * 14) * 0.3;
      v.rock.position.set(m.x * S + (1 - k) * 12, 1.4 + (1 - k) * (1 - k) * 40, m.y * S - (1 - k) * 8);
      v.rock.rotation.set(clock * 3, clock * 2, 0);
    }
    // Snowy rounds: flakes drift down over the arena, blown by the gusts.
    if (world.level.theme.snow && Math.random() < 0.9) {
      const gust = world.zones.find((z) => z.type === "gust");
      const wx = gust && gust.active && Number.isFinite(gust.fx) ? gust.fx * S * 2.5 : 0.6;
      const wz = gust && gust.active && Number.isFinite(gust.fy) ? gust.fy * S * 2.5 : 0;
      const L = world.level;
      for (let k = 0; k < 3; k++) {
        // Low over the arena, where the sun lights them (high up they'd show their dark undersides).
        const h = 1.2 + Math.random() * 5;
        this.particles.emit({
          x: Math.random() * L.bounds.w * S, y: h, z: Math.random() * L.bounds.h * S,
          vx: wx, vy: -1.6, vz: wz, life: h / 1.6, size: 0.1, color: 0xffffff, drag: 0,
        });
      }
    }
    for (const v of this.zoneViews) {
      if (v.z.type === "gust") {
        const on = v.z.active;
        v.mesh.material.opacity = lerp(v.mesh.material.opacity, on ? 0.32 : 0.08, damp(5, dt));
        v.mesh.rotation.y = -(v.z.angle || 0);
        v.tex.offset.x -= (on ? 1.5 : 0.3) * dt;
        if (on && Math.random() < dt * 18) {
          const z = v.z;
          this.particles.emit({
            x: (z.x + Math.random() * z.w) * S, y: 0.4 + Math.random() * 2.5, z: (z.y + Math.random() * z.h) * S,
            vx: z.fx * S * 4, vz: z.fy * S * 4, vy: 0, life: 0.7, size: 0.09, color: 0xffffff, drag: 0,
          });
        }
        continue;
      }
      if (v.z.type === "conveyor") {
        v.tex.offset.x -= v.uv[0] * v.rate * dt;
        v.tex.offset.y -= v.uv[1] * v.rate * dt;
      } else if (v.z.type === "wind") {
        const on = v.z.active;
        v.mesh.material.opacity = lerp(v.mesh.material.opacity, on ? 0.35 : 0, damp(6, dt));
        v.tex.offset.x -= v.uv[0] * 1.5 * dt;
        v.tex.offset.y -= v.uv[1] * 1.5 * dt;
        for (const f of v.fans) f.blades.rotation.z += (on ? 18 : 1.5) * dt;
        if (on && Math.random() < dt * 14) {
          const z = v.z;
          this.particles.emit({
            x: (z.x + Math.random() * z.w) * S, y: 0.4 + Math.random() * 2.5, z: (z.y + Math.random() * z.h) * S,
            vx: z.fx * S * 4, vz: z.fy * S * 4, vy: 0, life: 0.7, size: 0.09, color: 0xffffff, drag: 0,
          });
        }
      }
    }
    world.pads.forEach((p, i) => {
      const v = this.padViews[i];
      v.top.scale.y = 1 + p.pulse * 2.5;
      v.top.material.emissiveIntensity = 0.6 + p.pulse * 1.5 + Math.sin(clock * 4) * 0.15;
    });
    world.pendulums.forEach((p, i) => {
      const v = this.pendViews[i];
      const bx = (lerp(p.pbx ?? p.bx, p.bx, alpha) - p.x) * S;
      const by = 1.6;
      v.ball.position.set(bx, by, 0);
      v.ball.rotation.z = -bx * 0.3;
      const dx = bx, dy = by - v.H;
      const len = Math.hypot(dx, dy);
      v.rope.position.set(dx / 2, v.H + dy / 2, 0);
      v.rope.scale.y = len;
      v.rope.rotation.z = Math.atan2(dx, -dy) + Math.PI;
    });
    world.movers.forEach((m, i) => {
      this.moverViews[i].position.x = lerp(m.pcx ?? m.cx, m.cx, alpha) * S;
    });
    for (let i = 0; i < Math.max(world.rollers.length, this.rollerViews.length); i++) {
      const r = world.rollers[i];
      const v = r || this.rollerViews[i] ? this._rollerView(i) : null;
      if (!v) continue;
      v.visible = !!r && this._inSight(r.x, r.y);
      if (!r) continue;
      v.scale.setScalar(r.r * S);
      v.position.set(lerp(r.px ?? r.x, r.x, alpha) * S, r.r * S, lerp(r.py ?? r.y, r.y, alpha) * S);
      const sp = Math.hypot(r.vx, r.vy) || 1;
      v.quaternion.setFromAxisAngle(tmpV.set(r.vy / sp, 0, -r.vx / sp), r.rot);
    }
    for (const d of this.decor) {
      d.m.position.y = d.y + Math.sin(clock * 0.8 + d.ph) * 0.6;
      d.m.rotation.y = clock * 0.3 + d.ph;
      if (d.ring) d.m.rotation.x = 0.6 + Math.sin(clock * 0.5 + d.ph) * 0.3;
    }
    this.seaTex.offset.set(clock * 0.004, clock * 0.006);

    if (this.tileMesh) this._syncTiles(world);
    if (this.arena) {
      const r = world.arenaR * S;
      this.arena.disc.scale.set(r, 1, r);
      this.arena.rim.scale.set(r, r, 1);
      const atMin = world.arenaR <= world.level.arena.min_r + 0.5;
      const shrinking = world.time > world.level.arena.shrink_after;
      this.arena.rim.material.emissiveIntensity = atMin ? 1.2 : shrinking ? 0.4 + Math.sin(clock * 8) * 0.3 : 0;
    }

    // Characters
    for (const b of world.bodies) {
      const c = this.chars.get(b.id);
      if (!c) continue;
      const hidden = b.hidden || b.eliminated;
      if (hidden && !c.anim.wasHidden && b.hidden) this.particles.confetti(c.root.position, 14);
      c.anim.wasHidden = hidden;
      const x = lerp(b.px ?? b.x, b.x, alpha), y = lerp(b.py ?? b.y, b.y, alpha), z = lerp(b.pz ?? b.z, b.z, alpha);
      const show = !hidden && this._inSight(x, y);
      c.root.visible = show;
      c.shadow.visible = show;
      if (hidden) continue;
      animateCharacter(c, b, x, y, z, dt, clock, world.P);
      // Splash into the sea
      if (b.falling && !c.anim.splashed && c.root.position.y < SEA_Y + 0.5) {
        c.anim.splashed = true;
        this.particles.burst({ x: x * S, y: SEA_Y, z: y * S }, 18, world.level.theme.sea, 4, 0.9, 0.35, { vy: 7, g: 18, up: 0.2 });
        this.particles.burst({ x: x * S, y: SEA_Y, z: y * S }, 8, 0xffffff, 3, 0.8, 0.3, { vy: 6, g: 18, up: 0.2 });
      }
      if (!b.falling) c.anim.splashed = false;
      // Running dust
      if (b.z <= 0 && !b.falling && Math.hypot(b.vx, b.vy) > 180) {
        c.anim.dustT -= dt;
        if (c.anim.dustT <= 0) {
          c.anim.dustT = 0.09;
          this.particles.emit({
            x: x * S + (Math.random() - 0.5) * 0.4, y: 0.15, z: y * S + (Math.random() - 0.5) * 0.4,
            vx: -b.vx * S * 0.15, vz: -b.vy * S * 0.15, vy: 0.6, life: 0.35, size: 0.1, color: 0xffffff, grow: 1.2,
          });
        }
      }
    }
  }

  _syncTiles(world) {
    const cfg = world.tiles.cfg, mesh = this.tileMesh;
    const [ca, cb, cc] = this.tileColors;
    const col = new THREE.Color();
    world.tiles.list.forEach((t, i) => {
      let x = t.x * S, y = 0, z = t.y * S, s = 1;
      tmpQ.identity();
      if (t.state === "crack") {
        const k = 1 - t.t / (t.max || cfg.crack_time);
        x += (Math.random() - 0.5) * 0.12 * k;
        z += (Math.random() - 0.5) * 0.12 * k;
        y -= k * 0.15;
        col.copy(t.ring % 2 ? ca : cb).lerp(cc, Math.min(1, 0.35 + k));
      } else if (t.state === "gone") {
        if (t.goneT > 0.9) s = 0;
        y = -t.goneT * t.goneT * 22;
        tmpQ.setFromEuler(tmpE.set(t.goneT * 2, 0, t.goneT * 1.3));
        col.copy(cc);
      } else {
        col.copy(t.ring % 2 ? ca : cb);
      }
      tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(s, s, s));
      mesh.setMatrixAt(i, tmpM);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  _handleEvents(world) {
    const P = this.particles;
    for (const e of this.pending) {
      const c = e.id != null ? this.chars.get(e.id) : null;
      const pos = { x: e.x * S, y: 0, z: e.y * S };
      switch (e.type) {
        case "jump": P.burst(pos, 5, 0xffffff, 2, 0.3, 0.12, { vy: 0.5, grow: 1.0 }); break;
        case "dive": P.burst(pos, 4, 0xffffff, 2.5, 0.3, 0.12, { vy: 0.5, grow: 1.0 }); break;
        case "land": P.burst(pos, 9, 0xffffff, 3, 0.4, 0.15, { vy: 0.6, grow: 1.2 }); break;
        case "hit":
        case "bump": {
          const strong = e.type === "hit";
          P.burst({ ...pos, y: 1 }, strong ? 12 : 7, 0xffe066, strong ? 6 : 4, 0.4, 0.11, { vy: 3, g: 6 });
          if (c) {
            const a = c.anim;
            // Spin axis perpendicular to the knock direction, in the character's own frame.
            tmpV.set(e.dy ?? 0, 0, -(e.dx ?? 0)).applyAxisAngle(UP, -a.yaw);
            a.spin.copy(tmpV.multiplyScalar(strong ? 13 : 7));
            a.spin.y += (Math.random() - 0.5) * 8;
            a.ragdoll = strong ? 0.55 : 0.3;
            a.jellyV += strong ? 2.5 : 1.5;
          }
          if (e.follow) this.shake = strong ? 0.45 : 0.2;
          break;
        }
        case "finish": P.confetti({ ...pos, y: 1 }, 50); break;
        case "checkpoint": P.burst({ ...pos, y: 0.8 }, 18, 0x3c9cff, 4, 0.7, 0.18, { vy: 4, g: 8 }); break;
        case "cannon": P.burst({ ...pos, y: 1.6 }, 10, 0xffffff, 3, 0.5, 0.2, { vy: 2, grow: 1.2 }); break;
        case "pad": P.burst({ ...pos, y: 0.6 }, 14, 0x3dffb8, 3, 0.5, 0.12, { vy: 4, g: 6 }); break;
        case "respawn": P.burst({ ...pos, y: 1 }, 14, 0xbfe8ff, 3, 0.5, 0.12, { vy: 2 }); break;
        case "door": P.confetti({ ...pos, y: 1.6 }, 24); break;
        case "bonk": P.burst({ ...pos, y: 1.6 }, 8, 0xff8fab, 3, 0.4, 0.14, { vy: 2 }); break;
        case "crack": P.burst({ ...pos, y: 0.2 }, 6, 0xffb366, 2, 0.4, 0.12, { vy: 1.5 }); break;
        case "tile": {
          const col = world.level.theme.crack ?? 0xc9b48a;
          P.burst({ ...pos, y: -0.2 }, 6, col, 2, 0.7, 0.25, { vy: 1, g: 14 });
          break;
        }
        case "eliminated": break;
      }
    }
    this.pending.length = 0;
  }

  // ------------------------------------------------------------ camera

  _updateCamera(world, followId, dt, alpha) {
    const L = world.level, cam = this.camera;
    this.modeT += dt;
    let f = world.bodies.find((b) => b.id === followId && !b.hidden);
    if (!f) f = world.bodies.filter((b) => !b.hidden && !b.eliminated).sort((a, b) => a.y - b.y)[0];
    const target = new THREE.Vector3(this.center.x, 0, this.center.z);
    if (f) {
      // Ground-level target: the camera doesn't bob up and down with every jump.
      target.set(lerp(f.px ?? f.x, f.x, alpha) * S, 0, lerp(f.py ?? f.y, f.y, alpha) * S);
    }
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    const fit = L.camera === "fit";
    const chase = L.camera === "chase"; // follow camera on an open arena
    const size = Math.max(L.bounds.w, L.bounds.h) * S;
    let kPos = 4.5, kLook = 7;

    if (this.mode === "intro") {
      const t = ease(clamp(this.modeT / 7, 0, 1));
      if (fit || chase) {
        const a = -0.9 + this.modeT * 0.18;
        pos.set(this.center.x + Math.sin(a) * size * 0.9, size * 0.55, this.center.z + Math.cos(a) * size * 0.9);
        look.copy(this.center);
      } else {
        // Start in front of the finish arch and pull back along the course to the start line.
        const z0 = L.finish_y * S + 24, z1 = (L.spawn.y + L.spawn.h / 2) * S + 12;
        const z = lerp(z0, z1, t);
        pos.set(this.center.x + Math.sin(this.modeT * 0.35) * 5, 13 - t * 5, z);
        look.set(this.center.x, 0, z - 20);
      }
      kPos = kLook = 3;
    } else if (fit && this.mode !== "play") {
      const off = tmpV.copy(target).sub(this.center).setY(0);
      pos.set(this.center.x + off.x * 0.2, size * 1.0, this.center.z + size * 0.8 + off.z * 0.2);
      look.set(this.center.x + off.x * 0.25, 0, this.center.z + off.z * 0.25 + size * 0.04);
    } else if (this.mode === "menu") {
      const a = Math.sin(this.modeT * 0.15) * 0.8;
      pos.set(target.x + Math.sin(a) * 12, target.y + 6.5, target.z + Math.cos(a) * 12);
      look.set(target.x, target.y + 1, target.z - 4);
      kPos = 2;
      kLook = 3;
    }

    if (this.mode === "play") {
      this._orbitCamera(world, target, dt);
      this._snapCamera = false;
    } else {
      if (this._snapCamera) {
        this.camPos.copy(pos);
        this.camLook.copy(look);
        this._snapCamera = false;
      }
      this.camPos.lerp(pos, damp(kPos, dt));
      this.camLook.lerp(look, damp(kLook, dt));
    }
    cam.position.copy(this.camPos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    cam.lookAt(this.camLook);
    const fov = this.mode === "play" ? 60 : fit ? 50 : 58;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }

    // Keep the sky centred on the camera and the shadow box around the action.
    this.sky.position.copy(cam.position);
    this.sun.target.position.copy(this.camLook);
    this.sun.position.copy(this.camLook).add(tmpV.set(-22, 40, 18));
  }

  /** Camera heading the movement keys are relative to (0 = looking up the course). */
  get inputYaw() {
    return this.mode === "play" ? this.camYaw : 0;
  }

  /** Mouse look: turn the orbit camera (360 degrees round) and tilt it. */
  addLook(dx, dy) {
    if (this.mode !== "play") return;
    const k = this.lookSpeed * (this.sensitivity ?? 1);
    this.camYaw += dx * k;
    this.camPitch = clamp(this.camPitch + dy * k * (this.invertY ? -1 : 1), -0.12, 1.25);
  }

  /**
   * Player settings: mouse sensitivity, invert Y, and graphics quality
   * ("auto" adapts resolution to keep frames smooth, "high" always renders
   * sharp, "low" renders at reduced resolution for slower computers).
   */
  applySettings({ sensitivity = 1, invertY = false, quality = "auto" } = {}) {
    this.sensitivity = sensitivity;
    this.invertY = invertY;
    this.quality = quality;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.maxRatio = quality === "low" ? Math.min(dpr, 0.8) : dpr;
    this.ratio = quality === "high" ? dpr : Math.min(this.maxRatio, quality === "low" ? 0.8 : 1.25);
    this.badRatio = Infinity;
    this.needsResize = true;
  }

  /** Mouse wheel: move the camera closer or further away. */
  zoomBy(deltaY) {
    this.zoom = clamp(this.zoom * (1 + deltaY * 0.0012), 0.55, 1.8);
  }

  /**
   * Third-person orbit camera: it follows the character smoothly, while the
   * mouse sets its angle around the character directly (no lag on mouse look).
   */
  _orbitCamera(world, target, dt) {
    if (this._snapCamera || !this.orbitTarget) {
      this.orbitTarget = target.clone();
      if (this._snapCamera) this.blend = 1;
    }
    this.orbitTarget.lerp(target, damp(12, dt));
    const base = { follow: 11, chase: 9, fit: 12 }[world.level.camera] ?? 11;
    const dist = base * this.zoom;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const fx = Math.sin(this.camYaw), fz = -Math.cos(this.camYaw); // where the camera faces, on the ground
    const p = this.orbitTarget;
    const pivotY = p.y + 1.5;
    const pos = tmpV.set(p.x - fx * dist * cp, pivotY + dist * sp, p.z - fz * dist * cp);
    if (pos.y < 0.6) pos.y = 0.6; // never dip under the floor
    const look = tmpV2.set(p.x + fx * 1.5, pivotY, p.z + fz * 1.5);
    // Glide in from the previous camera (e.g. the intro fly-over) after a mode change.
    this.blend = Math.min(1, (this.blend ?? 1) + dt / 0.9);
    const k = ease(this.blend);
    this.camPos.lerpVectors(this.blendFromPos, pos, k);
    this.camLook.lerpVectors(this.blendFromLook, look, k);
  }

  // ------------------------------------------------------------ frame

  draw(world, followId, dt, alpha = 1) {
    if (!world) return;
    dt = Math.min(dt, 0.1);
    // Resize right before rendering (resizing clears the canvas), and pick up
    // layout changes such as the canvas becoming visible.
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.needsResize || (w && (w !== this.cssW || h !== this.cssH))) {
      this.needsResize = false;
      this.resize();
    }
    if (world !== this.world) {
      this._build(world);
      this.settleUntil = performance.now() + 2500; // shaders compiling, textures uploading
    }
    this._sync(world, alpha, dt);
    this._handleEvents(world);
    this._updateCamera(world, followId, dt, alpha);
    this._cullFar(dt);
    this.particles.update(dt);
    this.gl.render(this.scene, this.camera);
    this._adapt(dt);

    if (this.octx) {
      const g = this.octx;
      g.setTransform(this.odpr, 0, 0, this.odpr, 0, 0);
      g.clearRect(0, 0, 960, 600);
      if (world.type === "race" && !world.tutorial) drawProgressBar(g, world, followId);
    }
  }

  /**
   * Lower the resolution when frames are slow; raise it again only after a long
   * stretch of headroom, and never back to a level that was already too slow.
   * (Switching back and forth every few seconds causes visible hitches.)
   */
  _adapt(dt) {
    if (dt <= 0 || this.quality === "high" || this.quality === "low") return;
    const now = performance.now();
    // One-off hitches (switching windows, a round loading, a hidden tab coming
    // back) say nothing about how fast this computer draws: skip them, and
    // give a new scene a moment to settle.
    if (dt > 0.1 || document.hidden || now < (this.settleUntil || 0)) return;
    this.frameAvg = lerp(this.frameAvg, dt, 0.05);
    this.fps = 1 / this.frameAvg;
    this.perfT += dt;
    if (this.perfT < 1.5) return;
    this.perfT = 0;
    const floor = Math.min(this.maxRatio, this.maxRatio > 1.25 ? 0.75 : 0.85);
    if (this.frameAvg > 1 / 45) {
      // Only drop after it has been slow for a while (about 3 seconds).
      this.slowT = (this.slowT || 0) + 1.5;
      if (this.slowT >= 3 && this.ratio > floor) {
        this.badRatio = this.ratio;
        this.badAt = now;
        this.ratio = Math.max(floor, this.ratio - 0.25);
        this.slowT = 0;
        this.goodT = 0;
        this.needsResize = true;
      }
    } else if (this.frameAvg < 1 / 57) {
      this.slowT = 0;
      this.goodT += 1.5;
      // A resolution that was too slow gets another chance after half a minute.
      if (now - (this.badAt || 0) > 30000) this.badRatio = Infinity;
      const next = Math.min(this.maxRatio, this.ratio + 0.25);
      if (this.goodT >= 6 && next > this.ratio && next < this.badRatio) {
        this.ratio = next;
        this.goodT = 0;
        this.needsResize = true;
      }
    } else {
      this.slowT = 0;
      this.goodT = 0;
    }
  }
}

/** Renders a single character into small 2D canvases (menu / results cards). */
export class CharacterPreview {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.gl.setSize(280, 280, false);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(this.gl);
    const env = new THREE.Scene();
    env.add(makeSky({ sky: ["#5fb4ff", "#ffe1f0"], sea: "#ff6fb5" }));
    this.scene.environment = pm.fromScene(env, 0.02).texture;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xffb0d0, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 5, -6);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.6, -6.2);
    this.camera.lookAt(0, 1.05, 0);
    this.A = makeCharacterAssets();
    this.char = null;
    this.color = null;
    this.body = { vx: 0, vy: 0, vz: 0, fx: 0, fy: -1, stun: 0, squash: 0, falling: false, diving: false, sliding: false, crown: false };
  }

  draw(target, color, crown = false) {
    if (color !== this.color) {
      if (this.char) this.scene.remove(this.char.root);
      this.char = buildCharacter(this.A, color, "", false);
      this.scene.add(this.char.root);
      this.color = color;
    }
    const t = performance.now() / 1000;
    this.body.crown = crown;
    animateCharacter(this.char, this.body, 0, 0, 0, 1 / 60, t, { max_speed: 230, jump_speed: 380 });
    this.char.root.rotation.y = Math.sin(t * 0.8) * 0.5; // face the camera (-Z)
    this.char.shadow.visible = false;
    this.gl.render(this.scene, this.camera);
    const g = target.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, target.width, target.height);
    g.drawImage(this.canvas, 0, 0, target.width, target.height);
  }
}
