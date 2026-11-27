// Game flow: menus, the 3-round show, the tutorial, HUD and personal bests.
import { api } from "./api.js";
import { Input } from "./input.js";
import { Multiplayer } from "./mp.js";
import { music } from "./music.js";
import { ambience, at, setMusicVolume, setVolume, sfx, voicePitch } from "./sfx.js";
import { Renderer, drawBlob } from "./render.js";
import { CharacterPreview, Renderer3D, webglAvailable } from "./render3d.js";
import { World } from "./world.js";

const STEP = 1 / 120;
const $ = (id) => document.getElementById(id);
// Screens with a big card over the game, where the background can be drawn less often.
const COVERED_SCREENS = new Set(["first", "howto", "records", "show", "tutdone", "pause", "mp", "lobby", "settings", "rounds"]);
const SCREENS = ["menu", "first", "howto", "records", "intro", "result", "show", "tutdone", "pause", "mp", "lobby",
  "settings", "rounds"];

// Graphics: 3D (three.js) by default, classic 2D when chosen or when WebGL is missing.
const GRAPHICS_KEY = "wobble.graphics";
let renderer, preview = null, graphics = "2d";
function makeRenderer() {
  const wanted = localStorage.getItem(GRAPHICS_KEY) || "3d";
  if (wanted === "3d" && webglAvailable()) {
    try {
      renderer = new Renderer3D($("game3d"), $("game"));
      preview = new CharacterPreview();
      $("game3d").classList.remove("hidden");
      graphics = "3d";
      return;
    } catch (err) {
      console.warn("3D graphics unavailable, using 2D:", err);
    }
  }
  renderer = new Renderer($("game"));
  graphics = "2d";
}
makeRenderer();
const input = new Input();

// ---- player settings (saved in this browser)
const SETTINGS_KEY = "wobble.settings";
const settings = { volume: 0.7, music: 0.5, sensitivity: 1, invertY: false, quality: "auto", showFps: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch { /* defaults */ }
function applySettings() {
  setVolume(settings.volume);
  setMusicVolume(settings.music);
  renderer.applySettings?.(settings);
  document.getElementById("fps").classList.toggle("hidden", !settings.showFps);
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applySettings();
}
applySettings();

const app = {
  data: null,
  profile: null,
  mode: "menu",      // menu | intro | play | tutorial | result
  world: null,
  show: null,        // {round, roster, results}
  paused: false,
  endTimer: 0,       // delay between round end and result card
  fastForward: false,
  lastTip: null,
  screen: "menu",
  onSpace: null,
  mp: null,          // Multiplayer while in a room
  mpMenu: false,     // the in-game menu is open during a multiplayer round (the game keeps going)
};

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    [app.data, app.profile] = await Promise.all([api.levels(), api.profile()]);
  } catch (err) {
    showError(`Could not reach the game server: ${err.message}`);
    return;
  }
  buildMenu();
  // Phones and tiny windows: say up front that this needs a keyboard and some room.
  const updateSmall = () => {
    const small = matchMedia("(pointer: coarse)").matches || innerWidth < 760 || innerHeight < 420;
    $("small-note").classList.toggle("hidden", !small);
  };
  updateSmall();
  addEventListener("resize", updateSmall);
  startAttract();
  showScreen("menu");
  input.onKey = onKey;
  const roomCode = new URLSearchParams(location.search).get("room");
  if (roomCode) {
    history.replaceState(null, "", location.pathname);
    openMultiplayer(roomCode);
  }
  let last = performance.now(), acc = 0;
  const loop = (now) => {
    requestAnimationFrame(loop); // schedule first: an error below must never stop the game
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      frame(dt);
    } catch (err) {
      recoverFromError(err);
    }
  };
  const frame = (dt) => {
    let alpha = Math.min(1, acc / STEP);
    if (app.world && !app.paused) {
      const playing = app.mode === "play" || app.mode === "tutorial";
      const mp = app.mp && app.mp.world === app.world ? app.mp : null;
      if (mp) {
        // Multiplayer: play the host's snapshots back and move our own character.
        alpha = mp.frame(dt, playing);
        acc = 0;
      } else {
        acc += dt * (app.fastForward ? 3 : 1);
        let steps = 0;
        while (acc >= STEP && steps < 40) {
          app.world.update(STEP, playing ? cameraRelative(input.step(STEP)) : undefined);
          acc -= STEP;
          steps++;
        }
        alpha = Math.min(1, acc / STEP);
      }
      const events = app.world.events;
      renderer.consume(events, followId());
      handleEvents(events);
      events.length = 0;
      if (playing) tick(dt);
      else if (app.mode === "menu" || app.mode === "lobby") attractTick();
    } else {
      acc = 0;
    }
    if ((app.mode === "play" || app.mode === "tutorial") && !app.paused && renderer.addLook) {
      const [lx, ly, wheel] = input.takeLook();
      if (lx || ly) renderer.addLook(lx, ly);
      if (wheel) renderer.zoomBy(wheel);
    }
    // Behind a menu card the scene is mostly hidden: draw it less often, which
    // keeps the page snappy (joining a room, typing) on slower computers.
    app.drawDt = (app.drawDt || 0) + dt;
    const covered = COVERED_SCREENS.has(app.screen);
    if (!covered || app.drawDt >= 1 / 20) {
      renderer.draw(app.world, followId(), app.paused ? 0 : app.drawDt, alpha);
      app.drawDt = 0;
    }
    updateMusic();
    updateAmbience();
    updateFps(dt);
  };
  requestAnimationFrame(loop);
}

let fpsAvg = 1 / 60, fpsT = 0;
function updateFps(dt) {
  if (dt <= 0) return;
  fpsAvg += (dt - fpsAvg) * 0.05;
  fpsT += dt;
  const el = $("fps");
  if (fpsT > 0.5 && !el.classList.contains("hidden")) {
    fpsT = 0;
    const res = renderer.ratio ? ` · res ${Math.round(renderer.ratio * 100)}%` : "";
    el.textContent = `${Math.round(1 / fpsAvg)} FPS${res}`;
  }
}

/**
 * Turn "screen" directions from the keyboard into world directions using the
 * 3D camera's heading, so W always runs into the screen even after the camera
 * has swung round. (The 2D view never rotates, so it has no heading.)
 */
function cameraRelative(it) {
  const yaw = renderer.inputYaw || 0;
  if (yaw && (it.mx || it.my)) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const mx = it.mx * c - it.my * s, my = it.mx * s + it.my * c;
    it.mx = mx;
    it.my = my;
  }
  return it;
}

// ---- Mouse capture for the 3D orbit camera ----
function lockMouse() {
  if (graphics !== "3d") return;
  const c = $("game3d");
  try {
    const p = c.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {}); // browsers may refuse without a click
  } catch { /* not allowed right now; clicking the game will capture it */ }
}

function unlockMouse() {
  if (document.pointerLockElement) document.exitPointerLock();
}

function updateLookHint() {
  const playing = (app.mode === "play" || app.mode === "tutorial") && !app.paused && !app.mpMenu;
  const show = graphics === "3d" && playing && !document.pointerLockElement && app.world?.status !== "ended";
  $("look-hint").classList.toggle("hidden", !show);
}

$("game3d").addEventListener("mousedown", () => {
  if ((app.mode === "play" || app.mode === "tutorial") && !app.paused) lockMouse();
});
$("game3d").addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerlockchange", () => {
  // Losing the mouse (Esc) during play pauses the game, like most 3D games.
  if (!document.pointerLockElement && (app.mode === "play" || app.mode === "tutorial")
      && !app.paused && !app.mpMenu && app.world?.status !== "ended") {
    app.lockLostAt = performance.now();
    togglePause();
  }
  updateLookHint();
});

// ---- Recovering from unexpected errors instead of freezing ----
let errorCount = 0, errorWindowStart = 0;
function recoverFromError(err) {
  console.error("Wobble Rush recovered from an error:", err);
  const now = performance.now();
  if (now - errorWindowStart > 3000) { errorWindowStart = now; errorCount = 0; }
  errorCount++;
  // Make the 3D renderer rebuild its scene from scratch on the next frame.
  if (renderer.world !== undefined) renderer.world = null;
  if (errorCount > 20 && graphics === "3d") {
    // 3D keeps failing on this computer: switch to the classic 2D view.
    localStorage.setItem(GRAPHICS_KEY, "2d");
    showError("3D graphics hit a problem, switching to the classic 2D view...");
    setTimeout(() => location.reload(), 1500);
    errorCount = -1000;
  } else if (errorCount === 5) {
    showError("Something went wrong; returning to the main menu.");
    try { backToMenu(); } catch { /* keep going */ }
  }
}

function followId() {
  if (app.mode === "menu" || app.mode === "lobby") return app.attractFollow;
  if (app.mp && app.mp.world === app.world) return app.mp.followId();
  return app.world?.human?.id;
}

function showScreen(name) {
  app.screen = name;
  if (name) unlockMouse();
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle("hidden", s !== name);
  // Keyboard shortcuts drive the menus, so don't leave a stale button focused.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
}

function showError(msg, kind = "error") {
  const el = $("error");
  el.textContent = msg;
  el.className = kind === "info" ? "info" : "";
  clearTimeout(showError.t);
  showError.t = setTimeout(() => el.classList.add("hidden"), 5000);
}

/** A friendly notice (not a problem), e.g. "the host left". */
function showInfo(msg) {
  showError(msg, "info");
}

function hideToast() {
  clearTimeout(showError.t);
  $("error").classList.add("hidden");
}

/**
 * Let Space/Enter run `fn` on a card, but only after a short moment, so a
 * player still mashing jump at the end of a round can't skip the card unread.
 */
function armSpace(fn, delay = 700) {
  app.onSpace = fn;
  app.spaceAt = performance.now() + delay;
}

// ------------------------------------------------------------------ menu

function buildMenu() {
  const sw = $("swatches");
  sw.innerHTML = "";
  for (const color of app.data.palette) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = color;
    const label = app.data.palette_names?.[color] || color;
    b.title = label;
    b.dataset.color = color;
    b.setAttribute("aria-label", `Colour: ${label}`);
    b.addEventListener("click", () => saveProfile({ color }));
    sw.appendChild(b);
  }
  const nameInput = $("name-input");
  nameInput.addEventListener("change", () => {
    const name = nameInput.value.trim();
    if (name) saveProfile({ name });
    else nameInput.value = app.profile.name;
  });
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });
  buildRoundsPicker();
  refreshMenu();
}

async function saveProfile(changes) {
  try {
    app.profile = await api.saveProfile(changes);
  } catch (err) {
    showError(err.message);
  }
  refreshMenu();
}

const ROUNDS_KEY = "wobble.rounds";
function chosenRounds() {
  const n = Number(localStorage.getItem(ROUNDS_KEY));
  return app.data.round_options.includes(n) ? n : app.data.default_rounds;
}

function buildRoundsPicker() {
  const box = $("rounds-options");
  box.innerHTML = "";
  for (const n of app.data.round_options) {
    const b = document.createElement("button");
    b.textContent = n;
    b.title = `${n} rounds`;
    b.addEventListener("click", () => {
      localStorage.setItem(ROUNDS_KEY, String(n));
      b.blur();
      refreshRoundsPicker();
    });
    box.append(b);
  }
  refreshRoundsPicker();
}

function refreshRoundsPicker() {
  const n = chosenRounds();
  for (const b of $("rounds-options").children) b.classList.toggle("active", Number(b.textContent) === n);
  $("show-meta").textContent = `${n} random rounds \u00b7 12 players \u00b7 1 crown`;
}

function refreshMenu() {
  const p = app.profile;
  $("name-input").value = p.name;
  for (const b of $("swatches").children) b.classList.toggle("active", b.dataset.color === p.color);
  drawPreview($("preview"), p.color);
  const s = p.stats, pb = p.personal_best;
  $("menu-stats").innerHTML = "";
  for (const [icon, label, value] of [["\u265B", "Crowns", s.wins], ["\u2605", "Best score", pb.best_score], ["\u25B6", "Shows", s.shows_played]]) {
    const span = document.createElement("span");
    const i = document.createElement("i");
    i.textContent = icon;
    const b = document.createElement("b");
    b.textContent = value;
    span.append(i, `${label} `, b);
    $("menu-stats").append(span);
  }
  $("hero-name").textContent = p.name;
}

function drawPreview(canvas, color, crown = false) {
  if (preview) { preview.draw(canvas, color, crown); return; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = canvas.width / 140;
  ctx.translate(canvas.width / 2, canvas.height / 2 + 14 * k);
  ctx.scale(3 * k, 3 * k);
  const t = performance.now() / 1000;
  drawBlob(ctx, { color, fx: 0, fy: 0.4, walk: t * 3, hitT: 0 }, 16, t);
  if (crown) {
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.moveTo(-12, -30); ctx.lineTo(-12, -42); ctx.lineTo(-6, -36); ctx.lineTo(0, -46);
    ctx.lineTo(6, -36); ctx.lineTo(12, -42); ctx.lineTo(12, -30);
    ctx.fill();
  }
}

// A race of bots plays behind the main menu.
function startAttract(keepLobby = false) {
  const lvl = app.data.levels.spin_sprint;
  app.world = new World(lvl, app.data.physics, makeBots(12), { qualify: 12, countdown: 0 });
  renderer.cinematic?.("menu");
  app.mode = keepLobby && app.mode === "lobby" ? "lobby" : "menu";
  app.fastForward = false;
  app.attractFollow = null;
  $("hud").classList.add("hidden");
  $("tip").classList.add("hidden");
}

function attractTick() {
  const w = app.world;
  const leader = w.bodies.filter((b) => !b.finished).sort((a, b) => a.y - b.y)[0];
  if (leader) app.attractFollow = leader.id;
  if (w.status === "ended" || w.time > 90) startAttract(true);
  if (app.screen === "menu") drawPreview($("preview"), app.profile.color);
}

function makeBots(n, avoid = null) {
  const names = app.data.bot_names.slice().sort(() => Math.random() - 0.5);
  // Never dress a bot exactly like you.
  const colors = app.data.palette.filter((c) => c !== avoid);
  return Array.from({ length: n }, (_, i) => ({
    id: `bot${i}`,
    name: names[i % names.length],
    color: colors[(i * 5 + 3) % colors.length],
    isHuman: false,
    skill: 0.2 + Math.random() * 0.65,
  }));
}

// ------------------------------------------------------------------ show

function startShowFlow() {
  if (!app.profile.tutorial_done) showScreen("first");
  else startShow();
}

async function startShow() {
  if (app.starting) return;
  app.starting = true;
  let id = null, plan = app.data.show; // classic show if the server can't be reached
  try {
    const res = await api.newShow(chosenRounds());
    id = res.show_id;
    plan = res.rounds;
  } catch (err) {
    showError(`Couldn't set up a random show (${err.message}); playing the classic show.`);
  } finally {
    app.starting = false;
  }
  const human = { id: "you", name: app.profile.name, color: app.profile.color, isHuman: true };
  app.show = { id, plan, round: 0, roster: [human, ...makeBots(app.data.players - 1, human.color)], results: [], records: [] };
  wipe(showIntro);
}

function showIntro() {
  const cfg = app.show.plan[app.show.round];
  const lvl = app.data.levels[cfg.level];
  const total = app.show.plan.length;
  const final = app.show.round === total - 1;
  const n = app.show.roster.length;
  app.mode = "intro";
  $("hud").classList.add("hidden");
  // Preview the level behind the card.
  app.world = new World(lvl, app.data.physics, app.show.roster, { qualify: cfg.qualify, countdown: 9999 });
  renderer.cinematic?.("intro");
  fillIntro(lvl, { index: app.show.round, total, qualify: cfg.qualify, final }, app.show.roster);
  const best = pbFor(cfg.level);
  $("intro-pb").textContent = best == null ? "No personal best yet" : `Personal best: ${best.toFixed(2)}s`;
  $("btn-ready").classList.remove("hidden");
  $("btn-intro-quit").classList.remove("hidden");
  showScreen("intro");
  sfx.introSting();
  armSpace(beginRound);
}

/** The round intro card (single player and multiplayer). */
function fillIntro(lvl, cfg, roster) {
  const n = roster.length;
  $("intro-round").textContent = `Round ${cfg.index + 1} of ${cfg.total}`;
  const badge = $("intro-type");
  badge.textContent = cfg.final ? "FINAL" : lvl.type === "race" ? "RACE" : "SURVIVAL";
  badge.className = `badge ${cfg.final ? "final" : lvl.type === "race" ? "" : "survival"}`;
  $("intro-name").textContent = lvl.name;
  $("intro-desc").textContent = lvl.description;
  $("intro-goal").textContent = cfg.final
    ? `${lvl.goal} (${n} players)`
    : `${lvl.goal} ${cfg.qualify} of ${n} qualify.`;
  const row = $("intro-players");
  row.innerHTML = "";
  for (const p of roster) row.append(playerIcon(p, "big"));
  fillCourse($("intro-course"), lvl);
}

const SECTION_ICONS = {
  "Spinner field": "\u{1F300}", "Spinner forest": "\u{1F332}", "Giant sweeper": "\u{1F9F9}", "Spinner bridge": "\u{1F309}",
  "Mystery doors": "\u{1F6AA}", "Trust tiles": "\u2754", "Crumble bridge": "\u{1F9F1}", "Tilting platforms": "\u2696\uFE0F",
  "Log hurdles": "\u{1FAB5}", "Cannon alley": "\u{1F4A3}", "Shifting gates": "\u{1F6A7}", "Hammer hops": "\u{1F528}",
  "Hammer walk": "\u{1F528}", "Hammer gauntlet": "\u{1F528}", "Giant hammers": "\u{1F528}", "Belt islands": "\u{1F3DD}\uFE0F",
  "Belt sprint": "\u23E9", "Belt bridges": "\u{1F6E4}\uFE0F", "Conveyor lanes": "\u2195\uFE0F", "Cross belts": "\u2194\uFE0F", "Express bridge": "\u23EB",
  "Twister discs": "\u{1F32A}\uFE0F", "Turntables": "\u{1F504}", "Big wheels": "\u{1F3A1}", "Snow bridge": "\u2744\uFE0F",
  "Snowball slope": "\u26C4", "Gust gauntlet": "\u{1F4A8}", "Wind path": "\u{1F4A8}", "Windy islands": "\u{1F32C}\uFE0F",
  "Piston corridor": "\u{1F529}", "Piston plaza": "\u{1F529}", "Piston gauntlet": "\u{1F529}", "Pop-up blocks": "\u{1F7E7}",
  "Pinball lane": "\u{1F3AF}", "Bumper maze": "\u{1F3AF}", "Island hops": "\u{1F3DD}\uFE0F", "Zig-zag platforms": "\u3030\uFE0F",
  "Stepping stones": "\u{1FAA8}", "Split path": "\u{1F500}", "Sliding walls": "\u{1F9CA}", "Bounce pads": "\u{1F680}",
  "Bounce chain": "\u{1F680}", "Pad sprint": "\u{1F680}", "Drifting lifts": "\u{1F6D7}", "Speedy lifts": "\u{1F6D7}",
  "Snowball": "\u26C4",
};

/** A strip of the course's sections, in order (races only). */
function fillCourse(box, lvl) {
  box.innerHTML = "";
  const parts = (lvl.sections || []).filter((n) => n !== "Start" && n !== "Finish");
  box.classList.toggle("hidden", !parts.length);
  parts.forEach((name, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.animationDelay = `${0.4 + i * 0.05}s`;
    const icon = document.createElement("i");
    icon.textContent = SECTION_ICONS[name] || "\u2B50";
    chip.append(icon, name);
    box.append(chip);
    if (i < parts.length - 1) {
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "\u203A";
      box.append(arrow);
    }
  });
}

/** Is this player the person at this computer? */
function isMe(p) {
  return app.mp ? p.id === app.mp.me : p.isHuman;
}

/** Small gumdrop icon for player rows, the HUD and the feed. */
function playerIcon(p, extra = "") {
  const el = document.createElement("span");
  el.className = `pi ${extra} ${isMe(p) ? "you" : ""}`;
  el.style.setProperty("--c", p.color);
  el.title = p.name;
  return el;
}

/** Striped wipe across the screen; `fn` runs while the screen is covered. */
function wipe(fn) {
  if (app.wiping) return;
  app.wiping = true;
  setTimeout(() => { app.wiping = false; }, 900);
  sfx.swoosh();
  const el = $("wipe");
  el.classList.remove("go");
  void el.offsetWidth;
  el.classList.add("go");
  setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error(err);
      showError("Something went wrong; returning to the main menu.");
      backToMenu();
    }
  }, 420);
}

function beginRound() {
  const cfg = app.show.plan[app.show.round];
  const lvl = app.data.levels[cfg.level];
  // Reuse the world shown behind the intro card so the camera glides into place.
  if (app.world && app.world.level === lvl && app.world.status === "countdown") app.world.countdown = 3;
  else app.world = new World(lvl, app.data.physics, app.show.roster, { qualify: cfg.qualify, countdown: 3 });
  renderer.cinematic?.("play");
  enterPlay("play", lvl, `Round ${app.show.round + 1} of ${app.show.plan.length}`);
}

function enterPlay(mode, lvl, roundLabel) {
  app.mode = mode;
  app.endTimer = 0;
  app.fastForward = false;
  app.lastTip = null;
  app.lastCount = null;
  input.reset();
  input.enabled = true;
  showScreen(null);
  lockMouse();
  $("hud").classList.remove("hidden");
  $("feed").innerHTML = "";
  $("hud-players").dataset.key = "";
  $("hud-status").textContent = "";
  $("hud-round").textContent = roundLabel;
  app.lastSection = null;
  const look = graphics === "3d" ? " \u00b7 Mouse look \u00b7 Wheel zoom" : "";
  $("hud-keys").textContent = `WASD move${look} \u00b7 SPACE jump \u00b7 SHIFT dive \u00b7 `
    + (app.mp ? "ESC menu (the game keeps going)" : "ESC pause");
  $("hud-level").textContent = lvl.name;
  const best = pbFor(lvl.id);
  $("hud-pb").textContent = best == null ? "--" : `${best.toFixed(2)}s`;
}

function pbFor(levelId) {
  return app.profile.personal_best.levels[levelId]?.best_time ?? null;
}

function tick(dt) {
  const w = app.world;
  // Countdown banner
  if (w.status === "countdown") {
    const n = Math.ceil(w.countdown);
    if (n !== app.lastCount) {
      app.lastCount = n;
      if (n <= 3) { banner(String(n)); sfx.beep(n); }
    }
  }
  // Your own clock stops when you cross the line.
  $("hud-timer").textContent = formatTime(w.human?.finished && !w.tutorial ? w.human.finishTime : w.time);
  setStatus(w);
  updatePlayersBar(w);
  updatePlace(w);

  if (app.mode === "tutorial") updateTip(w);
  updateSection(w);
  if (!app.paused) ambientSounds(w);
  updateLookHint();

  if (w.status === "ended") {
    if (app.mp) {
      // Multiplayer: the server sends the round result once the host reports it.
      if (input.enabled) { input.enabled = false; unlockMouse(); }
      return;
    }
    unlockMouse();
    input.enabled = false;
    app.fastForward = false;
    app.endTimer += dt;
    if (app.endTimer > 1.8 && app.screen !== "result" && app.screen !== "tutdone") {
      if (app.mode === "tutorial") finishTutorial();
      else showRoundResult();
    }
  }
}

/** Live race position: "4th of 12" (finishers in order, then whoever is furthest along). */
function updatePlace(w) {
  const el = $("hud-place");
  const me = w.bodies.find((b) => b.id === followId());
  if (w.type !== "race" || w.tutorial || !me || me.eliminated) { el.classList.add("hidden"); return; }
  let place;
  const fin = w.finishers.indexOf(me.id);
  if (fin >= 0) place = fin + 1;
  else place = w.finishers.length + 1 + w.bodies.filter((b) => b !== me && !b.finished && !b.eliminated && b.y < me.y).length;
  const n = w.bodies.filter((b) => !b.eliminated || b.finished).length;
  const text = `${ordinal(place)} of ${n}`;
  if (el.textContent !== text) {
    const up = app.lastPlace && place < app.lastPlace;
    el.textContent = text;
    el.classList.remove("hidden", "up");
    if (up) { void el.offsetWidth; el.classList.add("up"); }
    el.classList.toggle("safe", place <= w.qualify);
    app.lastPlace = place;
  }
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return n + s;
}

/** "Section 4 of 12 · Zig-zag platforms" as you reach each part of a race. */
function updateSection(w) {
  const el = $("hud-section");
  const spans = w.level.section_spans;
  const me = w.bodies.find((b) => b.id === followId());
  if (!spans || !me || w.status === "countdown") { el.classList.add("hidden"); app.lastSection = null; return; }
  const i = spans.findIndex((s) => me.y >= s.y0 && me.y <= s.y1);
  if (i < 0 || i === app.lastSection) return;
  app.lastSection = i;
  el.textContent = `Section ${i + 1} of ${spans.length} \u00b7 ${spans[i].name}`;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}

function setStatus(w) {
  let big, sub;
  if (w.tutorial) {
    big = "";
    sub = "Reach the finish line";
  } else if (w.type === "race") {
    big = `${Math.min(w.finishers.length, w.qualify)}/${w.qualify}`;
    sub = w.human && w.human.finished && w.status === "running" && !app.mp ? "Qualified · fast-forward" : "Qualified";
  } else {
    big = String(w.aliveBodies().length);
    sub = w.qualify === 1 ? "Left · last one wins" : `Left · ${w.qualify} qualify`;
  }
  if (w.level.human_lives && w.human && !w.human.eliminated) {
    sub += ` · ${"\u2665".repeat(w.human.lives)}${w.human.lives ? "" : "last life"}`;
  }
  const watched = app.mp?.watching();
  if (watched) {
    sub += watched.id === app.mp.me
      ? " · \u2190 \u2192 to watch others"
      : ` · Watching ${watched.name} (\u2190 \u2192 to switch)`;
  }
  const el = $("hud-status");
  if (el.textContent !== big) {
    el.textContent = big;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
  $("hud-sub").textContent = sub;
}

/** Row of player icons: qualified ones lift up, eliminated ones grey out. */
function updatePlayersBar(w) {
  const bar = $("hud-players");
  if (w.tutorial) { bar.innerHTML = ""; return; }
  const key = w.bodies.map((b) => (b.finished ? "f" : b.eliminated ? "x" : "a")).join("") + w.bodies.length;
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.innerHTML = "";
  for (const b of w.bodies) {
    bar.append(playerIcon(b, b.finished ? "in" : b.eliminated ? "out" : ""));
  }
}

function addFeed(body, text, mood) {
  const feed = $("feed");
  const row = document.createElement("div");
  row.className = mood;
  const b = document.createElement("b");
  b.textContent = isMe(body) ? "You" : body.name;
  row.append(playerIcon(body), b, ` ${text}`);
  feed.append(row);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => row.remove(), 4200);
}

function formatTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}

function handleEvents(events) {
  if (app.mode !== "play" && app.mode !== "tutorial") return;
  const hid = app.world.human?.id;
  const byId = (id) => app.world.bodies.find((b) => b.id === id);
  playSounds(events);
  for (const e of events) {
    if (app.mode === "tutorial" && e.id === hid && ["jump", "dive", "checkpoint"].includes(e.type)) app.tutSkills?.add(e.type);
    if (app.mode === "play" && (e.type === "finish" || e.type === "eliminated" || e.type === "left")) {
      const body = byId(e.id);
      const text = e.type === "finish" ? "qualified!" : e.type === "left" ? "left the game" : "eliminated";
      if (body) addFeed(body, text, e.type === "finish" ? "good" : "bad");
    }
    if (e.type === "go") banner("GO!");
    else if (e.type === "checkpoint" && e.id === hid) banner("Checkpoint!", "small");
    else if (e.type === "finish" && e.id === hid) {
      if (app.mode === "tutorial") banner("Finished!");
      else {
        banner(e.place <= app.world.qualify ? "Qualified!" : "Finished", "");
        if (!app.mp) app.fastForward = true; // skip waiting for the others
      }
    } else if (e.type === "fall" && e.id === hid && app.world.type === "race") {
      banner("Whoops!", "small bad");
      if (app.mode === "tutorial") flashTip("You fell! You'll respawn at the last checkpoint you crossed.");
    } else if (e.type === "lifelost" && e.id === hid) {
      banner(e.lives ? `Saved! ${e.lives} ${e.lives === 1 ? "life" : "lives"} left` : "Last life!", "small");
    } else if (e.type === "eliminated" && e.id === hid) banner("Eliminated!", "bad");
    else if (e.type === "end" && app.mode === "play" && app.world.human && !app.world.human.eliminated) {
      const q = app.world.result.playerQualified;
      if (app.world.type !== "race" || !q) banner(q ? (app.world.qualify === 1 ? "Winner!" : "Survived!") : "Eliminated!", q ? "" : "bad");
    }
  }
}

/** Sounds for what happens to the character you follow, other players nearby, and loud things nearby. */
const OWN_SOUNDS = ["jump", "dive", "land", "hit", "bump", "pad", "fall", "respawn", "checkpoint", "lifelost"];
const OTHER_SOUNDS = ["jump", "dive", "land", "hit", "bump", "pad", "fall"];
const NEAR_SOUNDS = ["door", "bonk", "crack", "tile", "cannon"];
const HEAR = 650; // px: how far away you can hear things
const otherLast = new Map();

/**
 * Where a sound at world (x, y) is, heard from the character you follow:
 * panned left/right relative to the camera, quieter further away.
 */
function spotOf(x, y, me) {
  if (!me) return { pan: 0, vol: 1 };
  const yaw = renderer.inputYaw || 0;
  const dx = x - me.x, dy = y - me.y, d = Math.hypot(dx, dy);
  const right = dx * Math.cos(yaw) + dy * Math.sin(yaw);
  return { pan: Math.max(-0.85, Math.min(0.85, right / 260)), vol: Math.pow(Math.max(0, 1 - d / HEAR), 1.4) };
}

function playSounds(events) {
  const fid = followId();
  const me = app.world.bodies.find((b) => b.id === fid);
  for (const e of events) {
    if (e.type === "go") sfx.go();
    else if (e.id === fid && OWN_SOUNDS.includes(e.type)) {
      at({ pitch: voicePitch(e.id) }, () => (e.type === "land" ? sfx.land((e.v || 420) / 420) : sfx[e.type]()));
      // Falling into the sea: a splash when you hit the water.
      if (e.type === "fall") setTimeout(() => sfx.splash(), 600);
    } else if (e.id === fid && e.type === "finish") sfx.qualified();
    else if (e.id === fid && e.type === "eliminated") sfx.eliminated();
    else if (NEAR_SOUNDS.includes(e.type) && me && Math.hypot(e.x - me.x, e.y - me.y) < HEAR) at(spotOf(e.x, e.y, me), () => sfx[e.type]());
    else if (me && e.id !== undefined && OTHER_SOUNDS.includes(e.type)) {
      // Other players around you: quieter, from where they are, in their own voice.
      const sp = spotOf(e.x, e.y, me);
      if (sp.vol < 0.05) continue;
      const now = performance.now();
      if (now - (otherLast.get(e.type) || 0) < 90) continue;  // a crowd jumping at once is one sound
      otherLast.set(e.type, now);
      at({ ...sp, vol: sp.vol * 0.55, pitch: voicePitch(e.id) }, () => (e.type === "land" ? sfx.land((e.v || 420) / 420) : sfx[e.type]()));
    }
  }
}

/** A quiet background bed for the world you're in (waves, wind, hum...). */
function updateAmbience() {
  const w = app.world;
  const on = w && !app.paused && ["play", "tutorial", "menu", "lobby"].includes(app.mode);
  ambience.set(on ? w.level.theme?.env || "tropical" : null);
}

// ---- music and ambient sound

/** Which music fits right now (null = quiet, e.g. during the intro and countdown). */
function desiredTrack() {
  const m = app.mode, w = app.world;
  if (m === "menu" || m === "lobby") return "menu";
  if (m === "play" || m === "tutorial") {
    if (!w || w.status !== "running") return null;
    if (m === "tutorial") return "menu";
    if (w.qualify === 1 && w.type !== "race") return "final";
    return w.type === "race" ? "race" : "survival";
  }
  if (m === "result" && app.screen === "show") return "menu";
  return null;
}

function updateMusic() {
  const want = app.paused ? null : desiredTrack();
  if (want !== music.name) {
    if (want) music.play(want);
    else music.stop();
  }
}

const TAU2 = Math.PI * 2;
const nearState = new Map();
let nearWorld = null;
/** True the moment something comes close (not every frame while it stays close). */
function cameClose(key, isNear) {
  const was = nearState.get(key);
  nearState.set(key, isNear);
  return isNear && !was;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/** Footsteps for the character you follow, and obstacles swishing past close by. */
function ambientSounds(w) {
  if (w !== nearWorld) { nearWorld = w; nearState.clear(); }
  const me = w.bodies.find((b) => b.id === followId());
  if (!me || me.eliminated || w.status !== "running") return;
  const sp = Math.hypot(me.vx, me.vy);
  if (me.z <= 0 && !me.falling && sp > 80) {
    const phase = Math.floor((me.walk * 2) / Math.PI);
    if (phase !== app.stepPhase) { app.stepPhase = phase; sfx.step(surfaceUnder(w, me)); }
  }
  const near = (x, y, fn) => at(spotOf(x, y, me), fn);
  // Giant bouncing balls: a slam each time one lands near you.
  w.bouncers.forEach((o, k) => {
    const landed = o.bz < 4 && (nearState.get(`ob${k}`) ?? 99) >= 4;
    nearState.set(`ob${k}`, o.bz);
    if (landed && Math.hypot(o.bx - me.x, o.y - me.y) < HEAR) near(o.bx, o.y, () => sfx.slam());
  });
  // Vanishing platforms close by: a chime when they start flashing, a "shwip" when they go.
  w.blinks.forEach((p, k) => {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (Math.abs(cx - me.x) > 400 || Math.abs(cy - me.y) > 300) return;
    const warn = w.blinkWarn(p, w.time);
    const st = warn < 0 ? 2 : warn > 0 ? 1 : 0, was = nearState.get(`bl${k}`) ?? 0;
    nearState.set(`bl${k}`, st);
    if (st === 1 && was === 0) near(cx, cy, () => sfx.blinkWarn());
    if (st === 2 && was !== 2) near(cx, cy, () => sfx.blinkOut());
  });
  w.spinners.forEach((s, k) => {
    let close = false;
    if (Math.abs(s.x - me.x) < s.arm + 90 && Math.abs(s.y - me.y) < s.arm + 90) {
      for (let a = 0; a < s.arms; a++) {
        const ang = s.angle + (a * TAU2) / s.arms;
        if (segDist(me.x, me.y, s.x, s.y, s.x + Math.cos(ang) * s.arm, s.y + Math.sin(ang) * s.arm) < 75) close = true;
      }
    }
    if (cameClose(`s${k}`, close)) near(s.x, s.y, () => sfx.whoosh(Math.min(1.6, 0.7 + Math.abs(s.omega) * 0.3)));
  });
  w.pendulums.forEach((p, k) => {
    if (cameClose(`p${k}`, Math.hypot(p.bx - me.x, p.y - me.y) < p.r + 110)) near(p.bx, p.y, () => sfx.swing());
  });
  w.hammers.forEach((h, k) => {
    const head = w.hammerHeads(h).find(([hx, hy]) => Math.hypot(hx - me.x, hy - me.y) < h.r + 110);
    if (cameClose(`h${k}`, !!head)) near(head[0], head[1], () => sfx.swing());
  });
  w.sliders.forEach((s, k) => {
    if (cameClose(`w${k}`, Math.abs(s.cx - me.x) < s.w / 2 + 50 && Math.abs(s.y - me.y) < 70)) near(s.cx, s.y, () => sfx.slide());
  });
  w.pistons.forEach((p, k) => {
    if (cameClose(`k${k}`, Math.abs(p.vx) > 200 && Math.abs(p.y - me.y) < 160 && Math.abs(p.cx - me.x) < 260)) near(p.cx, p.y, () => sfx.piston());
  });
  for (const lg of w.logs) {
    if (cameClose(`l${lg.id}`, Math.abs(lg.y - me.y) < 220 && me.x > lg.x0 - 20 && me.x < lg.x1 + 20)) near(me.x, lg.y, () => sfx.roll());
  }
  for (const r of w.rollers) {
    if (cameClose(`r${r.id}`, Math.hypot(r.x - me.x, r.y - me.y) < 200)) near(r.x, r.y, () => sfx.roll());
  }
}

/** What you're walking on, for the footstep sound. */
function surfaceUnder(w, b) {
  if (b.onIce) return "ice";
  for (const z of w.zones) {
    if (z.type === "conveyor" && b.x >= z.x && b.x <= z.x + z.w && b.y >= z.y && b.y <= z.y + z.h) return "belt";
  }
  const env = w.level.theme?.env;
  if (env === "snow") return "snow";
  if (env === "future" || env === "neon") return "metal";
  return "floor";
}

/** Confetti over the screen when you qualify or win. */
function celebrate(big = false) {
  const box = $("celebrate");
  box.innerHTML = "";
  const colors = ["#ff5fa2", "#ffd23f", "#3ddc97", "#5b8cff", "#b47cff", "#ff8c42", "#40d9ff"];
  const n = big ? 120 : 60;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * (big ? 1.2 : 0.6)}s`;
    p.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 30}em`);
    p.style.setProperty("--spin", `${(Math.random() - 0.5) * 1440}deg`);
    box.append(p);
  }
  clearTimeout(celebrate.t);
  celebrate.t = setTimeout(() => { box.innerHTML = ""; }, 4500);
}

/** The result card's sound and confetti. */
function resultFanfare(good, final) {
  if (good && final) { sfx.crown(); celebrate(true); }
  else if (good) { sfx.qualified(); celebrate(false); }
  else sfx.eliminated();
}

function banner(text, cls = "") {
  const el = $("banner");
  el.textContent = text;
  el.className = "";
  void el.offsetWidth; // restart the animation
  el.className = `show ${cls}`;
}

function updateTip(w) {
  const h = w.human;
  if (!h) return;
  if (app.tipFlashUntil && performance.now() < app.tipFlashUntil) return;
  const tip = (w.level.tips || []).find((t) => h.y >= t.y0 && h.y <= t.y1);
  const text = tip ? (graphics === "2d" && tip.text_2d) || tip.text : null;
  // Keep each tip up long enough to read, even if you run past its stretch quickly.
  if (text !== app.lastTip && (text || performance.now() - (app.tipShownAt || 0) > 2500)
      && performance.now() - (app.tipShownAt || 0) > 1800) {
    app.lastTip = text;
    app.tipShownAt = performance.now();
    const el = $("tip");
    el.classList.toggle("hidden", !text);
    if (text) {
      el.textContent = text;
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
    }
  }
}

function flashTip(text) {
  const el = $("tip");
  el.textContent = text;
  el.classList.remove("hidden");
  app.lastTip = text;
  app.tipFlashUntil = performance.now() + 2500;
}

function showRoundResult() {
  const w = app.world, r = w.result;
  const cfg = app.show.plan[app.show.round];
  const lvl = w.level;
  app.show.results.push({ level: cfg.level, qualified: r.playerQualified, time: r.time, place: r.place });
  app.mode = "result";
  const last = app.show.round === app.show.plan.length - 1;
  const title = $("result-title");
  if (r.playerQualified) {
    title.textContent = last ? "Crowned!" : "Qualified!";
    title.className = "stamp good";
  } else {
    title.textContent = "Eliminated!";
    title.className = "stamp bad";
  }
  $("screen-result").className = `screen showbg ${r.playerQualified ? "mood-win" : "mood-lose"}`;
  $("result-detail").textContent = resultDetail(lvl, r, r.playerQualified, last, w.qualify);
  $("result-pb").classList.toggle("hidden", !isNewBest(lvl, r.time, r.playerQualified));
  saveRound(cfg.level, r);
  resultFanfare(r.playerQualified, last);
  $("btn-continue").textContent = r.playerQualified && !last ? "Next round (Space)" : "See results (Space)";
  $("btn-continue").classList.remove("hidden");
  $("btn-result-quit").classList.remove("hidden");
  $("result-next").classList.add("hidden");
  showScreen("result");
  armSpace(continueShow);
}

/** Would this round's time beat your personal best? (Shown on the result card.) */
function isNewBest(lvl, time, qualified) {
  if (lvl.type === "race" && !qualified) return false;
  const old = pbFor(lvl.id);
  const better = old == null || (lvl.type === "race" ? time < old : time > old);
  $("result-pb").textContent = lvl.type === "race" ? "New personal best!" : "Your longest survival yet!";
  return better;
}

/** Keep a round's personal best straight away, even if the show is quit later. */
async function saveRound(levelId, r) {
  const show = app.show;
  if (!show?.id) return;
  try {
    const res = await api.saveRound(show.id, show.round, r.time, r.playerQualified);
    app.profile = res.profile;
    show.records.push(...res.records);
  } catch { /* the show's final results will save it instead */ }
}

/** "New record" lines on the show summary. */
function fillRecords(records) {
  const list = $("show-records");
  list.innerHTML = "";
  for (const rec of records) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = `New record \u00b7 ${rec.label}${/[!?.]$/.test(rec.label) ? " " : ": "}`;
    li.append(b, rec.value);
    list.append(li);
  }
}

function resultDetail(lvl, r, qualified, last, qualify) {
  if (lvl.type === "race") {
    if (r.place) return `You finished #${r.place} in ${r.time.toFixed(2)}s.`;
    return `The ${qualify} spots filled up before you reached the finish.`;
  }
  if (qualified) return last ? `You outlasted everyone in ${r.time.toFixed(1)}s!` : `You survived ${r.time.toFixed(1)}s.`;
  return `You lasted ${r.time.toFixed(1)}s${r.place ? ` and placed #${r.place}` : ""}.`;
}

function continueShow() {
  const r = app.world.result;
  const last = app.show.round === app.show.plan.length - 1;
  if (r.playerQualified && !last) {
    app.show.roster = app.show.roster.filter((p) => r.qualified.includes(p.id));
    app.show.round++;
    wipe(showIntro);
  } else {
    finishShow();
  }
}

async function finishShow() {
  app.onSpace = null;
  let res;
  try {
    res = await api.submitShow(app.show.id, app.show.results);
  } catch (err) {
    showError(`Could not save results: ${err.message}`);
    backToMenu();
    return;
  }
  app.profile = res.profile;
  const reached = app.show.results.length;
  const title = $("show-title");
  if (!res.won) sfx.showOver();
  if (res.won) {
    title.textContent = "Crown won!";
    title.className = "good";
    $("show-detail").textContent = "You beat all 11 rivals across every round. Incredible!";
  } else {
    title.textContent = "Show over";
    title.className = "bad";
    const lvl = app.data.levels[app.show.plan[reached - 1].level];
    $("show-detail").textContent = `You were eliminated in round ${reached} (${lvl.name}).`;
  }
  drawPreview($("show-preview"), app.profile.color, res.won);
  $("show-score-wrap").classList.remove("hidden");
  $("show-standings").classList.add("hidden");
  $("btn-again").textContent = "Play again";
  $("show-score").textContent = res.score;
  const list = $("show-records");
  list.innerHTML = "";
  const records = [...app.show.records];
  for (const rec of res.records) if (!records.some((r) => r.label === rec.label)) records.push(rec);
  fillRecords(records);
  if (!records.length) {
    const li = document.createElement("li");
    li.textContent = `Best score so far: ${app.profile.personal_best.best_score}`;
    list.append(li);
  }
  app.mode = "result";
  $("hud").classList.add("hidden");
  showScreen("show");
  armSpace(startShow);
}

// ------------------------------------------------------------------ tutorial

function startTutorial() {
  const lvl = app.data.levels[app.data.tutorial_level];
  const human = { id: "you", name: app.profile.name, color: app.profile.color, isHuman: true };
  app.world = new World(lvl, app.data.physics, [human], { tutorial: true, countdown: 2 });
  renderer.cinematic?.("play");
  app.tipFlashUntil = 0;
  app.tipShownAt = 0;
  app.tutSkills = new Set();
  enterPlay("tutorial", lvl, "Tutorial");
}

async function finishTutorial() {
  const t = app.world.result.time;
  app.mode = "result";
  $("tip").classList.add("hidden");
  $("hud").classList.add("hidden");
  let detail = `Your time: ${t.toFixed(2)}s.`;
  try {
    const res = await api.tutorialDone(t);
    app.profile = res.profile;
    if (res.new_best) detail += " That's a new personal best!";
  } catch (err) {
    showError(`Could not save progress: ${err.message}`);
  }
  $("tutdone-detail").textContent = detail;
  // Which moves did you actually try?
  const skills = $("tutdone-skills");
  skills.innerHTML = "";
  for (const [key, name, how] of [["jump", "Jump", "Space"], ["dive", "Dive", "Shift in mid-air"], ["checkpoint", "Checkpoint", "cross the dashed line"]]) {
    const li = document.createElement("li");
    const done = app.tutSkills?.has(key);
    li.className = done ? "done" : "";
    li.textContent = done ? `\u2714 ${name}` : `\u2716 ${name} (try ${how})`;
    skills.append(li);
  }
  showScreen("tutdone");
  armSpace(startShow, 1200);
}

// ------------------------------------------------------------------ pause & menus

function togglePause() {
  if (app.mp) return toggleMpMenu();
  if (app.mode !== "play" && app.mode !== "tutorial") return;
  if (app.world.status === "ended") return;
  app.paused = !app.paused;
  input.enabled = !app.paused;
  input.reset();
  if (app.paused) unlockMouse();
  else lockMouse();
  updateLookHint();
  $("btn-restart-tut").classList.toggle("hidden", app.mode !== "tutorial");
  $("pause-title").textContent = "Paused";
  $("btn-quit").textContent = "Quit to menu";
  $("btn-resume").textContent = "Resume";
  $("pause-note").textContent = app.mode === "tutorial" ? "" : "Quitting ends the show. Personal best times from finished rounds are kept.";
  showScreen(app.paused ? "pause" : null);
}

/** Multiplayer can't pause (others are still playing): Esc opens a menu instead. */
function toggleMpMenu() {
  if (app.mode !== "play") return;
  app.mpMenu = !app.mpMenu;
  input.reset();
  input.enabled = !app.mpMenu && app.mp.canControl();
  if (app.mpMenu) unlockMouse();
  else lockMouse();
  updateLookHint();
  $("btn-restart-tut").classList.add("hidden");
  $("pause-title").textContent = `Room ${app.mp.code}`;
  $("btn-quit").textContent = "Leave room";
  $("btn-resume").textContent = "Back to game";
  $("pause-note").textContent = "The round keeps going while this menu is open.";
  showScreen(app.mpMenu ? "pause" : null);
}

function backToMenu() {
  if (app.mp) {
    app.mp.leave();
    app.mp = null;
  }
  app.mpMenu = false;
  unlockMouse();
  $("look-hint").classList.add("hidden");
  app.paused = false;
  app.show = null;
  app.onSpace = null;
  input.enabled = false;
  startAttract();
  refreshMenu();
  showScreen("menu");
}

function showRecords() {
  const p = app.profile, pb = p.personal_best, s = p.stats;
  const levels = app.data.levels;
  const furthest = pb.furthest_round ? `Round ${pb.furthest_round}` : "--";
  const rows = [
    ["Best show score", pb.best_score || "--"],
    ["Furthest round", furthest],
    ["Crowns won", s.wins],
    ["Shows played", s.shows_played],
    ["Rounds qualified", s.rounds_qualified],
  ];
  const pool = app.data.pool;
  for (const id of [...pool.race, ...pool.survival, ...pool.final, app.data.tutorial_level]) {
    const lvl = levels[id];
    const best = pb.levels[id]?.best_time;
    const kind = lvl.type === "race" ? "fastest time" : "longest survival";
    rows.push([`${lvl.name} (${kind})`, best == null ? "--" : `${best.toFixed(2)}s`]);
  }
  const table = $("records-table");
  table.innerHTML = "";
  for (const [label, value] of rows) {
    const tr = table.insertRow();
    tr.insertCell().textContent = label;
    tr.insertCell().textContent = value;
  }
  showScreen("records");
}

function onKey(code, e) {
  if (code === "KeyF") { settings.showFps = !settings.showFps; saveSettings(); return; }
  if (code === "Escape" && performance.now() - (app.lockLostAt || 0) < 400) return;
  if (code === "Escape" || code === "KeyP") {
    if (app.mode === "play" || app.mode === "tutorial") { e.preventDefault(); togglePause(); }
    else if (["howto", "records", "first", "mp", "settings", "rounds"].includes(app.screen)) showScreen("menu");
    else if (code === "Escape" && !app.mp && ["intro", "result"].includes(app.screen)) quitShow();
    else if (code === "Escape" && app.screen === "lobby" && confirm("Leave this room?")) backToMenu();
    return;
  }
  if (e.repeat) return; // a held key never presses buttons on cards
  // Mashing jump through the end of a round shouldn't click through the card:
  // a press only counts after a short pause since the previous one.
  let mashing = false;
  if (code === "Space" || code === "Enter") {
    const now = performance.now();
    mashing = now - (app.lastSpaceAt || 0) < 400;
    app.lastSpaceAt = now;
  }
  // Watching someone else in multiplayer: switch who the camera follows.
  if (app.mp?.watching() && !app.mpMenu) {
    if (code === "ArrowLeft" || code === "KeyA") { app.mp.cycleWatch(-1); return; }
    if (code === "ArrowRight" || code === "KeyD") { app.mp.cycleWatch(1); return; }
  }
  if (e.target instanceof HTMLButtonElement) return; // the focused button handles it
  if ((code === "Space" || code === "Enter") && app.onSpace && ["intro", "result", "show", "tutdone"].includes(app.screen)
      && performance.now() >= (app.spaceAt || 0) && !mashing) {
    e.preventDefault();
    const fn = app.onSpace;
    app.onSpace = null;
    fn();
  }
}

function on(id, fn) {
  $(id).addEventListener("click", (e) => { e.currentTarget.blur(); app.onSpace = null; fn(); });
}

/** Leave a single-player show between rounds (round bests are already saved). */
function quitShow() {
  if (confirm("Quit this show? Personal best times from finished rounds are kept.")) backToMenu();
}

on("btn-play", startShowFlow);
on("btn-settings", openSettings);
on("btn-rounds", openRounds);

function openSettings() {
  const seg = (box, options, value, onPick) => {
    box.innerHTML = "";
    for (const [v, label] of options) {
      const b = document.createElement("button");
      b.textContent = label;
      b.classList.toggle("active", v === value);
      b.addEventListener("click", () => { b.blur(); onPick(v); });
      box.append(b);
    }
  };
  const draw = () => {
    seg($("set-graphics"), [["3d", "3D"], ["2d", "Classic 2D"]], graphics, (v) => {
      if (v === graphics) return;
      localStorage.setItem(GRAPHICS_KEY, v);
      location.reload();
    });
    $("set-quality-row").classList.toggle("hidden", graphics !== "3d");
    seg($("set-quality"), [["auto", "Auto"], ["high", "Sharp"], ["low", "Fast"]], settings.quality, (v) => {
      settings.quality = v; saveSettings(); draw();
    });
    $("set-volume").value = Math.round(settings.volume * 100);
    $("set-volume-val").textContent = `${Math.round(settings.volume * 100)}%`;
    $("set-music").value = Math.round(settings.music * 100);
    $("set-music-val").textContent = `${Math.round(settings.music * 100)}%`;
    $("set-sens").value = Math.round(settings.sensitivity * 100);
    $("set-sens-val").textContent = `${Math.round(settings.sensitivity * 100)}%`;
    $("set-invert").checked = settings.invertY;
    $("set-fps").checked = settings.showFps;
  };
  draw();
  showScreen("settings");
}
$("set-volume").addEventListener("input", (e) => {
  settings.volume = e.target.value / 100;
  $("set-volume-val").textContent = `${e.target.value}%`;
  saveSettings();
});
$("set-volume").addEventListener("change", () => sfx.jump());
$("set-music").addEventListener("input", (e) => {
  settings.music = e.target.value / 100;
  $("set-music-val").textContent = `${e.target.value}%`;
  saveSettings();
});
$("set-sens").addEventListener("input", (e) => {
  settings.sensitivity = e.target.value / 100;
  $("set-sens-val").textContent = `${e.target.value}%`;
  saveSettings();
});
$("set-invert").addEventListener("change", (e) => { settings.invertY = e.target.checked; saveSettings(); });
$("set-fps").addEventListener("change", (e) => { settings.showFps = e.target.checked; saveSettings(); });

/** A browsable list of every round in the game. */
function openRounds() {
  const list = $("rounds-list");
  list.innerHTML = "";
  const pool = app.data.pool;
  const groups = [["Races", pool.race], ["Survival rounds", pool.survival], ["Finals", pool.final]];
  for (const [title, ids] of groups) {
    const h = document.createElement("h3");
    h.textContent = `${title} (${ids.length})`;
    list.append(h);
    const grid = document.createElement("div");
    grid.className = "rounds-grid";
    for (const id of ids) {
      const lvl = app.data.levels[id];
      const card = document.createElement("div");
      card.className = `round-card ${lvl.type === "race" ? "race" : pool.final.includes(id) ? "final" : "survival"}`;
      const name = document.createElement("b");
      name.textContent = lvl.name;
      const desc = document.createElement("p");
      desc.textContent = lvl.description;
      card.append(name, desc);
      const best = pbFor(id);
      if (best != null) {
        const pb = document.createElement("small");
        pb.textContent = `Your best: ${best.toFixed(2)}s`;
        card.append(pb);
      }
      if (lvl.sections) {
        const strip = document.createElement("div");
        strip.className = "course-strip mini";
        fillCourse(strip, lvl);
        card.append(strip);
      }
      grid.append(card);
    }
    list.append(grid);
  }
  showScreen("rounds");
}

// A soft click for every button.
document.addEventListener("click", (e) => {
  if (e.target instanceof Element && e.target.closest("button")) sfx.click();
}, true);
// ...and a faint tick when the pointer moves onto one.
document.addEventListener("pointerover", (e) => {
  const btn = e.target instanceof Element && e.target.closest("button");
  if (btn && !btn.disabled && !btn.contains(e.relatedTarget)) sfx.hover();
});
on("btn-tutorial", startTutorial);
on("btn-howto", () => showScreen("howto"));
on("btn-records", showRecords);
on("btn-first-tutorial", startTutorial);
on("btn-first-skip", startShow);
on("btn-ready", beginRound);
on("btn-continue", continueShow);
on("btn-again", () => (app.mp ? app.mp.showLobby() : startShow()));
on("btn-tut-play", startShow);
on("btn-tut-again", startTutorial);
on("btn-resume", togglePause);
on("btn-restart-tut", () => { app.paused = false; startTutorial(); });
on("btn-quit", backToMenu);
on("btn-intro-quit", quitShow);
on("btn-result-quit", quitShow);
on("btn-reset", async () => {
  if (!confirm("Reset all stats and personal bests? This can't be undone.")) return;
  try {
    app.profile = await api.resetProgress();
  } catch (err) {
    showError(err.message);
  }
  refreshMenu();
  showRecords();
});
for (const b of document.querySelectorAll("[data-back]")) {
  b.addEventListener("click", () => (app.mode === "menu" ? showScreen("menu") : backToMenu()));
}
window.addEventListener("blur", () => {
  if (app.mp) return; // multiplayer never pauses
  if (!app.paused && (app.mode === "play" || app.mode === "tutorial") && app.world?.status !== "ended") togglePause();
});

// ------------------------------------------------------------------ multiplayer

function openMultiplayer(code = "") {
  if (app.mp) { app.mp.showLobby(); return; }
  $("mp-code").value = code;
  $("mp-name").value = app.profile.name;
  showScreen("mp");
  // From an invite link: pick a name, then press Join.
  if (code) $("mp-name").select();
}

async function enterRoom(code) {
  if (app.joining) return;
  app.joining = true;
  const btn = $(code ? "btn-mp-join" : "btn-mp-create");
  const label = btn.textContent;
  btn.textContent = code ? "Joining..." : "Creating...";
  for (const id of ["btn-mp-join", "btn-mp-create"]) $(id).disabled = true;
  const mp = new Multiplayer(mpUi);
  try {
    // Join with the typed name straight away; saving it to the profile can finish meanwhile.
    const name = $("mp-name").value.trim().slice(0, 16);
    if (name && name !== app.profile.name) saveProfile({ name });
    await mp.enter(code, { rounds: chosenRounds(), bots: 12 }, name || app.profile.name);
  } catch (err) {
    mp.leave();
    showError(code ? `Couldn't join: ${err.message}` : `Couldn't create a room: ${err.message}`);
    return;
  } finally {
    app.joining = false;
    btn.textContent = label;
    for (const id of ["btn-mp-join", "btn-mp-create"]) $(id).disabled = false;
  }
  hideToast();
  app.mp = mp;
  if (mp.round && app.mode !== "lobby") return; // already watching a round in progress
  mp.showLobby();
}

function joinRoom(code) {
  code = code.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { showError("Room codes are 4 letters."); return; }
  enterRoom(code);
}

const mpUi = {
  app, input,
  get data() { return app.data; },
  renderer: () => renderer,
  startAttract: () => startAttract(true),
  intent: (step) => cameraRelative(input.step(step)),
  armSpace, fillRecords, isNewBest, resultFanfare, sfx,
  showScreen, showError, showInfo, banner, playerIcon, enterPlay, fillIntro, resultDetail, pbFor, refreshMenu, drawPreview,
  onDisconnected() {
    showError("Lost the connection to the room.");
    backToMenu();
  },
};

on("btn-mp", () => openMultiplayer());
on("btn-mp-create", () => enterRoom(null));
on("btn-mp-join", () => joinRoom($("mp-code").value));
$("mp-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("mp-name").blur(); });
$("mp-code").addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom($("mp-code").value); });
on("btn-lobby-start", () => app.mp?.start());
on("btn-lobby-leave", backToMenu);

// Handy for troubleshooting from the browser console.
window.wobble = { app, get renderer() { return renderer; } };

boot();
