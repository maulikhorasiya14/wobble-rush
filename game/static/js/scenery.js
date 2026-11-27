// Themed surroundings for the 3D renderer: what lies around and below a course.
//
// Every level names an environment in its theme (`theme.env`): tropical, snow,
// candy, sky, water, future or neon. Each one gets its own decoration beside
// the course (palm islands, pine trees, lollipops, hot-air balloons, boats,
// holo rings...), a distant backdrop (mountains, a skyline, neon hills) that
// travels with the camera so it always sits on the horizon, and an underside
// for the floors (rocky floating islands, or glowing edges for the high-tech
// worlds). Static pieces are instanced so a whole course costs only a few
// draw calls.
import * as THREE from "../vendor/three/three.module.min.js";

const S = 1 / 20;
const TAU = Math.PI * 2;
const dummy = new THREE.Object3D();
const child = new THREE.Object3D();
dummy.add(child);
const col = new THREE.Color();

/** Per-environment settings the renderer reads (lights, clouds, floor look). */
export const ENVS = {
  tropical: { clouds: 1, hemi: 0.7, sun: 2.6, sunColor: 0xfff1dc, under: "rock", rock: "#b9824f", grass: "#5fd068" },
  snow: { clouds: 1, hemi: 0.8, sun: 2.3, sunColor: 0xf2f7ff, under: "rock", rock: "#8fa9c8", grass: "#ffffff", snow: true },
  candy: { clouds: 1, hemi: 0.75, sun: 2.4, sunColor: 0xfff0f6, under: "rock", rock: "#f29bc4", grass: "#fff3fa" },
  sky: { clouds: 2.4, cloudsBelow: true, hemi: 0.8, sun: 2.6, sunColor: 0xfff6e0, under: "rock", rock: "#c99a6b", grass: "#7ee08a" },
  water: { clouds: 1, hemi: 0.75, sun: 2.7, sunColor: 0xfff4dc, under: "rock", rock: "#e8c98f", grass: "#f7e2a8" },
  future: { clouds: 0.6, hemi: 0.7, sun: 2.2, sunColor: 0xe8f4ff, under: "glow", glow: "#40d9ff", metal: true },
  neon: { clouds: 0, hemi: 0.95, sun: 1.5, sunColor: 0xffd6f5, under: "glow", glow: "#ff4fd8", glow2: "#40d9ff", metal: true },
};
export const envOf = (theme) => ENVS[theme.env] || ENVS.tropical;

function setColorIfAny(mesh, i, c) {
  if (c == null) return;
  mesh.setColorAt(i, col.set(c));
}

/** One InstancedMesh from a list of {x, y, z, sx, sy, sz, rx, ry, rz, c}. */
function instanced(geo, mat, list) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    dummy.scale.set(t.sx ?? 1, t.sy ?? t.sx ?? 1, t.sz ?? t.sx ?? 1);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    setColorIfAny(m, i, t.c);
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}

/** Matrices for leaves/branches: a parent placement plus a local offset. */
function nested(list, parent, local) {
  dummy.position.set(parent.x, parent.y, parent.z);
  dummy.rotation.set(parent.rx || 0, parent.ry || 0, parent.rz || 0);
  dummy.scale.setScalar(parent.s || 1);
  child.position.set(local.x || 0, local.y || 0, local.z || 0);
  child.rotation.set(local.rx || 0, local.ry || 0, local.rz || 0, "YXZ");
  child.scale.set(local.sx ?? 1, local.sy ?? local.sx ?? 1, local.sz ?? local.sx ?? 1);
  dummy.updateMatrixWorld(true);
  list.push({ m: child.matrixWorld.clone(), c: local.c });
}

function fromMatrices(geo, mat, list) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((t, i) => { m.setMatrixAt(i, t.m); setColorIfAny(m, i, t.c); });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}

function canvasTex(w, h, paint) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  paint(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const swirlTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = "#ffd6ea";
  g.lineWidth = 16;
  g.beginPath();
  for (let a = 0; a < TAU * 4; a += 0.05) {
    const r = (a / (TAU * 4)) * (w / 2 - 8);
    g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
  }
  g.stroke();
});

const stripes = (a, b, n = 8) => canvasTex(64, 256, (g, w, h) => {
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, (i * h) / n, w, h / n + 1); }
});

/** Spots beside the course (left and right of it, never over it). */
function sideSpots(W, H, n, near = 8, far = 40, rnd = Math.random) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? -1 : 1;
    const off = near + rnd() * (far - near);
    out.push({ x: side < 0 ? -off : W + off, z: -20 + rnd() * (H + 40), side });
  }
  return out;
}

/**
 * Build the surroundings into `scene`. `own` marks objects as belonging to the
 * level (so they're disposed with it). Returns {backdrop, update(clock, dt, cam)}.
 */
export function buildScenery(scene, level, own, seaY) {
  const th = level.theme, env = envOf(th), kind = th.env || "tropical";
  const W = level.bounds.w * S, H = level.bounds.h * S;
  const race = level.type === "race";
  const floaters = []; // animated decorations: {o, y, ph, spin, bob}
  const add = (o) => { if (o) scene.add(own(o)); return o; };
  const lambert = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const std = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...extra });
  const count = Math.round((race ? H / 16 : 16) * (kind === "sky" ? 0.8 : 1));

  // ---------------------------------------------------------- floor undersides
  const floors = level.floors || [];
  if (env.under === "rock" && floors.length) {
    // Each floor sits on a rocky, upside-down island (low-poly, flat shaded).
    const geo = new THREE.CylinderGeometry(0.72, 0.0, 1, 4, 3);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, -0.5, 0);
    const rock = new THREE.MeshStandardMaterial({ color: env.rock, roughness: 0.9, flatShading: true });
    const grass = new THREE.MeshStandardMaterial({ color: env.grass, roughness: 0.8 });
    const list = [], lips = [];
    for (const f of floors) {
      const w = f.w * S, h = f.h * S;
      const depth = Math.min(10, 2.5 + Math.min(w, h) * 0.35);
      list.push({ x: (f.x + f.w / 2) * S, y: -1.6, z: (f.y + f.h / 2) * S, sx: w * 1.02, sy: depth, sz: h * 1.02 });
      // A thin lip of grass / snow / frosting just under the edge of the floor.
      lips.push({ x: (f.x + f.w / 2) * S, y: -1.55, z: (f.y + f.h / 2) * S, sx: w + 0.5, sy: 0.35, sz: h + 0.5 });
    }
    add(instanced(geo, rock, list));
    const lip = new THREE.BoxGeometry(1, 1, 1);
    add(instanced(lip, grass, lips));
  } else if (env.under === "glow" && floors.length) {
    // High-tech worlds: floors float on a dark frame with glowing edges.
    const bar = new THREE.BoxGeometry(1, 1, 1);
    const glow = new THREE.MeshBasicMaterial({ color: env.glow, toneMapped: false });
    const glow2 = new THREE.MeshBasicMaterial({ color: env.glow2 || env.glow, toneMapped: false });
    const frame = std(kind === "neon" ? "#1a0f3d" : "#2b3a55", { metalness: 0.6, roughness: 0.35 });
    const edges = [], edges2 = [], frames = [];
    for (const f of floors) {
      const cx = (f.x + f.w / 2) * S, cz = (f.y + f.h / 2) * S, w = f.w * S, h = f.h * S;
      edges.push({ x: f.x * S, y: -0.9, z: cz, sx: 0.22, sy: 0.22, sz: h });
      edges.push({ x: (f.x + f.w) * S, y: -0.9, z: cz, sx: 0.22, sy: 0.22, sz: h });
      edges2.push({ x: cx, y: -0.9, z: f.y * S, sx: w, sy: 0.22, sz: 0.22 });
      edges2.push({ x: cx, y: -0.9, z: (f.y + f.h) * S, sx: w, sy: 0.22, sz: 0.22 });
      frames.push({ x: cx, y: -2.2, z: cz, sx: w * 0.8, sy: 1.2, sz: h * 0.8 });
    }
    add(instanced(bar, glow, edges));
    add(instanced(bar, glow2, edges2));
    add(instanced(bar, frame, frames));
  }

  // ---------------------------------------------------------- clouds
  if (env.clouds > 0) {
    const puffs = [];
    const n = Math.round((14 + H / 12) * env.clouds);
    for (let i = 0; i < n; i++) {
      const below = env.cloudsBelow && i % 3 === 0;
      const side = i % 2 ? -1 : 1;
      const cx = below ? -30 + Math.random() * (W + 60) : side < 0 ? -20 - Math.random() * 80 : W + 20 + Math.random() * 80;
      const cz = -60 + Math.random() * (H + 120);
      const cy = below ? seaY + 2 + Math.random() * 4 : -6 + Math.random() * 26;
      const k = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < k; j++) {
        const s = (2.4 + Math.random() * 2.2) * (below ? 1.6 : 1);
        puffs.push({ x: cx + (j - k / 2) * 3.2 * (below ? 1.5 : 1), y: cy + Math.random() * 1.6, z: cz + (Math.random() - 0.5) * 4, sx: s, sy: s * 0.7, sz: s });
      }
    }
    const tint = kind === "candy" ? 0xfff0fa : kind === "future" ? 0xe8f2ff : 0xffffff;
    add(instanced(new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 1, emissive: tint, emissiveIntensity: 0.3 }), puffs));
  }

  // ---------------------------------------------------------- decorations
  const spots = sideSpots(W, H, count, 9, 42);
  const islandTop = new THREE.CylinderGeometry(1, 0.92, 0.6, 12);
  const islandRock = new THREE.ConeGeometry(1, 1.8, 7);
  islandRock.rotateX(Math.PI);
  islandRock.translate(0, -1.2, 0);

  /** Floating islands (with something growing on top: `plant(top, list)`). */
  const islands = (topColor, rockColor, plant) => {
    const tops = [], rocks = [];
    spots.forEach((p, i) => {
      if (i % 2) return;
      const s = 2.5 + Math.random() * 3.5;
      const y = -4 + Math.random() * 12;
      tops.push({ x: p.x, y, z: p.z, sx: s, sy: 1, sz: s * (0.8 + Math.random() * 0.4) });
      rocks.push({ x: p.x, y: y - 0.1, z: p.z, sx: s * 0.95, sy: s * 0.9, sz: s * 0.95, ry: Math.random() * TAU });
      plant?.({ x: p.x, y: y + 0.3, z: p.z, s });
    });
    add(instanced(islandTop, std(topColor), tops));
    add(instanced(islandRock, new THREE.MeshStandardMaterial({ color: rockColor, roughness: 0.9, flatShading: true }), rocks));
  };

  const palms = (spotsList) => {
    const trunks = [], leaves = [], nuts = [];
    for (const p of spotsList) {
      const lean = (Math.random() - 0.5) * 0.5, yaw = Math.random() * TAU, hgt = 3.5 + Math.random() * 2;
      trunks.push({ x: p.x, y: p.y + hgt / 2, z: p.z, sx: 1, sy: hgt, sz: 1, rz: lean, ry: yaw });
      const top = { x: p.x - Math.sin(lean) * hgt * 0.5, y: p.y + hgt, z: p.z };
      for (let k = 0; k < 6; k++) {
        nested(leaves, top, { ry: (k / 6) * TAU + yaw, rz: -0.45, x: 0, sx: 1, c: k % 2 ? "#3fbf5a" : "#2fa94c" });
      }
      nuts.push({ x: top.x, y: top.y - 0.25, z: top.z, sx: 0.32 });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 7);
    const leafGeo = new THREE.SphereGeometry(1, 8, 4);
    leafGeo.scale(1.3, 0.12, 0.42);
    leafGeo.translate(1.2, 0, 0);
    add(instanced(trunkGeo, std("#a8703f"), trunks));
    add(fromMatrices(leafGeo, std("#ffffff"), leaves));
    add(instanced(new THREE.SphereGeometry(1, 8, 6), std("#7a4a24"), nuts));
  };

  const pines = (spotsList, snowy) => {
    const cones = [], caps = [], trunks = [];
    for (const p of spotsList) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let j = 0; j < n; j++) {
        const x = p.x + (Math.random() - 0.5) * p.s, z = p.z + (Math.random() - 0.5) * p.s;
        const h = 2.2 + Math.random() * 1.6;
        trunks.push({ x, y: p.y + 0.4, z, sx: 0.25, sy: 0.8, sz: 0.25 });
        for (let k = 0; k < 3; k++) {
          const s = (1.2 - k * 0.3) * (h / 3);
          cones.push({ x, y: p.y + 0.9 + k * h * 0.28, z, sx: s, sy: h * 0.42, sz: s });
        }
        if (snowy) caps.push({ x, y: p.y + 0.9 + 2 * h * 0.28 + h * 0.12, z, sx: h / 3 * 0.5, sy: h * 0.2, sz: h / 3 * 0.5 });
      }
    }
    const cone = new THREE.ConeGeometry(1, 1, 8);
    add(instanced(new THREE.CylinderGeometry(1, 1, 1, 6), std("#7a4a24"), trunks));
    add(instanced(cone, new THREE.MeshStandardMaterial({ color: "#2f8f5b", roughness: 0.8, flatShading: true }), cones));
    if (caps.length) add(instanced(cone, std("#ffffff"), caps));
  };

  const plantSpots = [];
  const plant = (p) => plantSpots.push(p);

  if (kind === "tropical") {
    islands("#5fd068", "#b9824f", plant);
    palms(plantSpots);
    balloons(4);
  } else if (kind === "snow") {
    islands("#ffffff", "#8fa9c8", plant);
    pines(plantSpots, true);
    // Ice crystals drifting slowly.
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshPhysicalMaterial({ color: "#bfe8ff", roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85, emissive: "#5ab8ff", emissiveIntensity: 0.25 });
    sideSpots(W, H, Math.round(count / 2), 10, 30).forEach((p) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(0.9, 1.6, 0.9);
      floater(m, p.x, 2 + Math.random() * 8, p.z, { spin: 0.4 });
    });
  } else if (kind === "candy") {
    islands("#fff3fa", "#f29bc4", plant);
    // Lollipops, donuts and gumdrops in bright colours.
    const sticks = [], pops = [], donuts = [], drops = [];
    const sweet = ["#ff5fa2", "#ffd23f", "#5b8cff", "#3ddc97", "#ff8c42", "#b47cff"];
    plantSpots.forEach((p, i) => {
      const h = 3 + Math.random() * 3;
      sticks.push({ x: p.x, y: p.y + h / 2, z: p.z, sx: 0.12, sy: h, sz: 0.12 });
      pops.push({ x: p.x, y: p.y + h + 1.1, z: p.z, sx: 1.4, sy: 1.4, sz: 1.4, rx: Math.PI / 2, rz: Math.random() * TAU, c: sweet[i % sweet.length] });
      for (let k = 0; k < 3; k++) {
        drops.push({ x: p.x + (Math.random() - 0.5) * p.s * 1.4, y: p.y, z: p.z + (Math.random() - 0.5) * p.s * 1.4,
          sx: 0.5 + Math.random() * 0.4, sy: 0.6, c: sweet[(i + k + 2) % sweet.length] });
      }
    });
    sideSpots(W, H, Math.round(count / 2), 10, 34).forEach((p, i) => {
      donuts.push({ x: p.x, y: 1 + Math.random() * 10, z: p.z, sx: 1.2 + Math.random(), rx: 0.4 + Math.random(), ry: Math.random() * TAU,
        c: sweet[(i + 1) % sweet.length] });
    });
    add(instanced(new THREE.CylinderGeometry(1, 1, 1, 8), std("#ffffff"), sticks));
    add(instanced(new THREE.CylinderGeometry(1, 1, 0.35, 32),
      new THREE.MeshPhysicalMaterial({ map: swirlTex(), roughness: 0.25, clearcoat: 1 }), pops));
    add(instanced(new THREE.TorusGeometry(1.2, 0.55, 12, 28),
      new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.3, clearcoat: 1 }), donuts));
    const dome = new THREE.SphereGeometry(1, 16, 10, 0, TAU, 0, Math.PI / 2);
    add(instanced(dome, new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.2, clearcoat: 1, sheen: 1 }), drops));
  } else if (kind === "sky") {
    islands("#7ee08a", "#c99a6b", plant);
    palms(plantSpots.filter((_, i) => i % 2 === 0));
    pines(plantSpots.filter((_, i) => i % 2 === 1), false);
    balloons(Math.round(count / 3));
  } else if (kind === "water") {
    // Boats, buoys and little sandy islands out on the sea.
    const sand = [], rocks = [], buoys = [];
    spots.forEach((p, i) => {
      if (i % 3 === 0) {
        const s = 3 + Math.random() * 4;
        sand.push({ x: p.x, y: seaY - 0.6, z: p.z, sx: s, sy: 1.2, sz: s * 0.8 });
        plant({ x: p.x, y: seaY + 0.3, z: p.z, s });
      } else if (i % 3 === 1) {
        rocks.push({ x: p.x, y: seaY, z: p.z, sx: 1 + Math.random() * 2, ry: Math.random() * TAU });
      } else {
        buoys.push(p);
      }
    });
    add(instanced(new THREE.SphereGeometry(1, 16, 8, 0, TAU, 0, Math.PI / 2), std("#f7e2a8"), sand));
    add(instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: "#7f8aa3", flatShading: true }), rocks));
    palms(plantSpots);
    const buoyMat = new THREE.MeshPhysicalMaterial({ map: stripes("#ff5757", "#ffffff", 6), roughness: 0.3, clearcoat: 1 });
    const lamp = new THREE.MeshBasicMaterial({ color: "#fff2a8", toneMapped: false });
    for (const p of buoys) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 2.4, 14), buoyMat);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), lamp);
      light.position.y = 1.4;
      g.add(body, light);
      floater(g, p.x, seaY + 0.8, p.z, { bob: 0.35, tilt: 0.12 });
    }
    // A few sailing boats further out.
    const sail = new THREE.MeshStandardMaterial({ color: "#ffffff", side: THREE.DoubleSide, roughness: 0.7 });
    const hullMat = std("#ff8c42");
    const tri = new THREE.Shape();
    tri.moveTo(0, 0); tri.lineTo(0, 4); tri.lineTo(2.6, 0); tri.lineTo(0, 0);
    const sailGeo = new THREE.ShapeGeometry(tri);
    sideSpots(W, H, Math.round(count / 4), 30, 70).forEach((p) => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 4), hullMat);
      const s = new THREE.Mesh(sailGeo, sail);
      s.rotation.y = Math.PI / 2;
      s.position.set(0, 0.4, 1.2);
      g.add(hull, s);
      g.rotation.y = Math.random() * TAU;
      floater(g, p.x, seaY + 0.3, p.z, { bob: 0.25, tilt: 0.08 });
    });
  } else if (kind === "future") {
    // Pylons with glowing strips and slowly turning holo rings.
    const pylons = [], strips = [];
    spots.forEach((p, i) => {
      const h = 10 + Math.random() * 18;
      pylons.push({ x: p.x, y: seaY + h / 2, z: p.z, sx: 1.6, sy: h, sz: 1.6 });
      strips.push({ x: p.x, y: seaY + h / 2, z: p.z, sx: 1.7, sy: h * 0.9, sz: 0.25, c: i % 2 ? "#40d9ff" : "#7cf7c8" });
    });
    add(instanced(new THREE.BoxGeometry(1, 1, 1), std("#334766", { metalness: 0.7, roughness: 0.3 }), pylons));
    add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), strips));
    const ringGeo = new THREE.TorusGeometry(2.6, 0.18, 8, 48);
    sideSpots(W, H, Math.round(count / 2), 9, 26).forEach((p, i) => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? "#40d9ff" : "#ffd23f", toneMapped: false, transparent: true, opacity: 0.85 }));
      floater(m, p.x, 3 + Math.random() * 8, p.z, { spin: 0.8, ring: true });
    });
  } else if (kind === "neon") {
    // Glowing pillars, rings and spinning cubes in neon colours.
    const neon = ["#ff4fd8", "#40d9ff", "#ffd23f", "#7cf75a"];
    const pillars = [], caps = [];
    spots.forEach((p, i) => {
      const h = 6 + Math.random() * 16;
      pillars.push({ x: p.x, y: seaY + h / 2, z: p.z, sx: 0.8, sy: h, sz: 0.8 });
      caps.push({ x: p.x, y: seaY + h + 0.6, z: p.z, sx: 0.9, c: neon[i % neon.length] });
    });
    add(instanced(new THREE.CylinderGeometry(1, 1, 1, 10), std("#22164a", { metalness: 0.5, roughness: 0.3 }), pillars));
    add(instanced(new THREE.SphereGeometry(1, 16, 10), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), caps));
    const ringGeo = new THREE.TorusGeometry(2.4, 0.2, 8, 40);
    const cubeGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    sideSpots(W, H, Math.round(count * 0.7), 9, 30).forEach((p, i) => {
      const c = neon[i % neon.length];
      const m = i % 2
        ? new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false }))
        : new THREE.Mesh(cubeGeo, new THREE.MeshStandardMaterial({ color: "#1a0f3d", emissive: c, emissiveIntensity: 1.2, roughness: 0.3 }));
      floater(m, p.x, 2 + Math.random() * 9, p.z, { spin: 0.9, ring: !!(i % 2) });
    });
  }

  function floater(o, x, y, z, opts = {}) {
    o.position.set(x, y, z);
    add(o);
    floaters.push({ o, y, ph: Math.random() * TAU, spin: opts.spin || 0, bob: opts.bob ?? 0.6, tilt: opts.tilt || 0, ring: !!opts.ring });
  }

  function balloons(n) {
    const colors = [["#ff5fa2", "#ffffff"], ["#ffd23f", "#ff8c42"], ["#5b8cff", "#ffffff"], ["#3ddc97", "#ffd23f"]];
    const basket = std("#9b6a3c");
    const rope = new THREE.MeshBasicMaterial({ color: "#6b4a2a" });
    sideSpots(W, H, n, 14, 50).forEach((p, i) => {
      const g = new THREE.Group();
      const [a, b] = colors[i % colors.length];
      const env_ = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 14),
        new THREE.MeshPhysicalMaterial({ map: stripes(a, b, 10), roughness: 0.4, clearcoat: 0.5 }));
      env_.scale.set(1, 1.2, 1);
      env_.rotation.z = Math.PI / 2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), basket);
      box.position.y = -3.6;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), rope);
      line.position.y = -2.7;
      g.add(env_, box, line);
      floater(g, p.x, 6 + Math.random() * 14, p.z, { bob: 1.2, spin: 0.1 });
    });
  }

  // ---------------------------------------------------------- backdrop
  // Lives around the camera (it follows it) and ignores the fog, tinted toward
  // the horizon colour so it reads as far away.
  const backdrop = new THREE.Group();
  const horizon = new THREE.Color(th.sky[1]);
  const far = (c, k = 0.45) => new THREE.Color(c).lerp(horizon, k);
  const R0 = 430;
  const ringOf = (n, fn) => { for (let i = 0; i < n; i++) fn((i / n) * TAU + Math.random() * 0.1, i); };
  if (kind === "tropical" || kind === "snow" || kind === "water" || kind === "candy") {
    const peaks = [], caps = [];
    const n = kind === "water" ? 14 : 26;
    const body = { tropical: "#3fae6a", snow: "#7f9cc4", water: "#4fb08a", candy: "#ff9ccf" }[kind];
    const cap = { tropical: "#7fdc8a", snow: "#ffffff", water: "#f7e2a8", candy: "#ffffff" }[kind];
    ringOf(n, (a, i) => {
      const r = R0 + Math.random() * 120;
      const h = (kind === "water" ? 18 : kind === "candy" ? 45 : 70) + Math.random() * (kind === "snow" ? 90 : 50);
      const w = h * (0.9 + Math.random() * 0.6);
      peaks.push({ x: Math.cos(a) * r, y: seaY + h / 2 - 2, z: Math.sin(a) * r, sx: w, sy: h, sz: w, ry: Math.random() * TAU,
        c: i % 2 ? body : far(body, 0.15).getStyle() });
      if (kind !== "water") caps.push({ x: Math.cos(a) * r, y: seaY + h * 0.82 - 2, z: Math.sin(a) * r, sx: w * 0.36, sy: h * 0.36, sz: w * 0.36 });
    });
    const geo = kind === "candy" ? new THREE.SphereGeometry(0.5, 16, 10) : new THREE.ConeGeometry(0.5, 1, 7);
    backdrop.add(instanced(geo, new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }), peaks));
    if (caps.length) backdrop.add(instanced(geo, new THREE.MeshBasicMaterial({ color: far(cap, 0.35), fog: false }), caps));
    // Fake shading: tint the instance colours toward the horizon too.
    backdrop.children.forEach((m) => {
      if (!m.instanceColor) return;
      for (let i = 0; i < m.count; i++) { m.getColorAt(i, col); m.setColorAt(i, col.lerp(horizon, 0.4)); }
      m.instanceColor.needsUpdate = true;
    });
  } else if (kind === "future") {
    const towers = [];
    ringOf(70, (a) => {
      const r = R0 + Math.random() * 100, h = 25 + Math.random() * 110, w = 8 + Math.random() * 16;
      towers.push({ x: Math.cos(a) * r, y: seaY + h / 2, z: Math.sin(a) * r, sx: w, sy: h, sz: w, ry: -a,
        c: far(Math.random() < 0.5 ? "#4b6fa8" : "#6c8cc4", 0.3).getStyle() });
    });
    backdrop.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }), towers));
    const lights = [];
    towers.forEach((t) => { if (Math.random() < 0.6) lights.push({ x: t.x, y: t.y + t.sy / 2 + 1, z: t.z, sx: 1.4 }); });
    backdrop.add(instanced(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: "#7cf7c8", fog: false, toneMapped: false }), lights));
  } else if (kind === "neon") {
    // Wireframe hills and a big striped sunset sun on the horizon.
    const hills = new THREE.Group();
    ringOf(18, (a, i) => {
      const r = R0 + 40, h = 40 + Math.random() * 60;
      const m = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6, 4),
        new THREE.MeshBasicMaterial({ color: i % 2 ? "#ff4fd8" : "#40d9ff", wireframe: true, fog: false, transparent: true, opacity: 0.55 }));
      m.position.set(Math.cos(a) * r, seaY + h / 2, Math.sin(a) * r);
      hills.add(m);
    });
    backdrop.add(hills);
    const sunTex = canvasTex(256, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#ffe36b"); grad.addColorStop(1, "#ff4fd8");
      g.fillStyle = grad;
      g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, TAU); g.fill();
      g.globalCompositeOperation = "destination-out";
      for (let k = 0; k < 6; k++) g.fillRect(0, h * 0.55 + k * 18, w, 4 + k * 2);
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(160, 160),
      new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, toneMapped: false, depthWrite: false }));
    sun.position.set(0, 40, -560);
    backdrop.add(sun);
  } else if (kind === "sky") {
    // Distant floating islands drifting in the haze.
    const tops = [], rocks = [];
    ringOf(16, (a) => {
      const r = R0 + Math.random() * 120, s = 18 + Math.random() * 26, y = -20 + Math.random() * 70;
      tops.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, sx: s, sy: 2, sz: s, c: far("#7ee08a").getStyle() });
      rocks.push({ x: Math.cos(a) * r, y: y - 0.2, z: Math.sin(a) * r, sx: s * 0.95, sy: s * 0.8, sz: s * 0.95, c: far("#c99a6b").getStyle() });
    });
    backdrop.add(instanced(islandTop, new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }), tops));
    backdrop.add(instanced(islandRock, new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }), rocks));
  }
  backdrop.traverse((o) => { o.frustumCulled = false; o.renderOrder = -0.5; });
  add(backdrop);

  return {
    backdrop,
    floaters,
    update(clock, cam) {
      backdrop.position.set(cam.x, 0, cam.z);
      for (const f of floaters) {
        f.o.position.y = f.y + Math.sin(clock * 0.8 + f.ph) * f.bob;
        if (f.spin) f.o.rotation.y = clock * f.spin + f.ph;
        if (f.ring) f.o.rotation.x = 0.6 + Math.sin(clock * 0.5 + f.ph) * 0.3;
        if (f.tilt) f.o.rotation.z = Math.sin(clock * 1.3 + f.ph) * f.tilt;
      }
    },
  };
}
