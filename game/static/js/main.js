// Game flow: menus, the 3-round show, the tutorial, HUD and personal bests.
import { api } from "./api.js";
import { Input } from "./input.js";
import { Renderer, drawBlob } from "./render.js";
import { World } from "./world.js";

const STEP = 1 / 120;
const $ = (id) => document.getElementById(id);
const SCREENS = ["menu", "first", "howto", "records", "intro", "result", "show", "tutdone", "pause"];

const renderer = new Renderer($("game"));
const input = new Input();

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
  startAttract();
  showScreen("menu");
  input.onKey = onKey;
  let last = performance.now(), acc = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (app.world && !app.paused) {
      acc += dt * (app.fastForward ? 3 : 1);
      const playing = app.mode === "play" || app.mode === "tutorial";
      let steps = 0;
      while (acc >= STEP && steps < 40) {
        app.world.update(STEP, playing ? input.step(STEP) : undefined);
        acc -= STEP;
        steps++;
      }
      const events = app.world.events;
      renderer.consume(events, followId());
      handleEvents(events);
      events.length = 0;
      if (playing) tick(dt);
      else if (app.mode === "menu") attractTick();
    } else {
      acc = 0;
    }
    renderer.draw(app.world, followId(), app.paused ? 0 : dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function followId() {
  if (app.mode === "menu") return app.attractFollow;
  return app.world?.human?.id;
}

function showScreen(name) {
  app.screen = name;
  for (const s of SCREENS) $(`screen-${s}`).classList.toggle("hidden", s !== name);
  // Keyboard shortcuts drive the menus, so don't leave a stale button focused.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
}

function showError(msg) {
  const el = $("error");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showError.t);
  showError.t = setTimeout(() => el.classList.add("hidden"), 5000);
}

// ------------------------------------------------------------------ menu

function buildMenu() {
  const sw = $("swatches");
  sw.innerHTML = "";
  for (const color of app.data.palette) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = color;
    b.title = color;
    b.setAttribute("aria-label", `Colour ${color}`);
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

function refreshMenu() {
  const p = app.profile;
  $("name-input").value = p.name;
  for (const b of $("swatches").children) b.classList.toggle("active", b.title === p.color);
  drawPreview($("preview"), p.color);
  const s = p.stats, pb = p.personal_best;
  $("menu-stats").innerHTML = "";
  for (const [label, value] of [["Best score", pb.best_score], ["Crowns", s.wins], ["Shows", s.shows_played]]) {
    const span = document.createElement("span");
    span.append(`${label}: `);
    const b = document.createElement("b");
    b.textContent = value;
    span.append(b);
    $("menu-stats").append(span);
  }
}

function drawPreview(canvas, color, crown = false) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2 + 14);
  ctx.scale(3, 3);
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
function startAttract() {
  const lvl = app.data.levels.spin_sprint;
  app.world = new World(lvl, app.data.physics, makeBots(12), { qualify: 12, countdown: 0 });
  app.mode = "menu";
  app.fastForward = false;
  app.attractFollow = null;
  $("hud").classList.add("hidden");
  $("tip").classList.add("hidden");
}

function attractTick() {
  const w = app.world;
  const leader = w.bodies.filter((b) => !b.finished).sort((a, b) => a.y - b.y)[0];
  if (leader) app.attractFollow = leader.id;
  if (w.status === "ended" || w.time > 90) startAttract();
  if (app.screen === "menu") drawPreview($("preview"), app.profile.color);
}

function makeBots(n) {
  const names = app.data.bot_names.slice().sort(() => Math.random() - 0.5);
  const colors = app.data.palette;
  return Array.from({ length: n }, (_, i) => ({
    id: `bot${i}`,
    name: names[i % names.length],
    color: colors[(i * 5 + 3) % colors.length],
    isHuman: false,
    skill: 0.25 + Math.random() * 0.7,
  }));
}

// ------------------------------------------------------------------ show

function startShowFlow() {
  if (!app.profile.tutorial_done) showScreen("first");
  else startShow();
}

function startShow() {
  const human = { id: "you", name: app.profile.name, color: app.profile.color, isHuman: true };
  app.show = { round: 0, roster: [human, ...makeBots(app.data.players - 1)], results: [] };
  showIntro();
}

function showIntro() {
  const cfg = app.data.show[app.show.round];
  const lvl = app.data.levels[cfg.level];
  const total = app.data.show.length;
  const final = app.show.round === total - 1;
  const n = app.show.roster.length;
  app.mode = "intro";
  $("hud").classList.add("hidden");
  // Preview the level behind the card.
  app.world = new World(lvl, app.data.physics, app.show.roster, { qualify: cfg.qualify, countdown: 9999 });
  $("intro-round").textContent = `Round ${app.show.round + 1} of ${total}`;
  const badge = $("intro-type");
  badge.textContent = final ? "FINAL" : lvl.type === "race" ? "RACE" : "SURVIVAL";
  badge.className = `badge ${final ? "final" : lvl.type === "race" ? "" : "survival"}`;
  $("intro-name").textContent = lvl.name;
  $("intro-desc").textContent = lvl.description;
  $("intro-goal").textContent = final
    ? `${lvl.goal} (${n} players)`
    : `${lvl.goal} ${cfg.qualify} of ${n} qualify.`;
  const best = pbFor(cfg.level);
  $("intro-pb").textContent = best == null ? "No personal best yet." : `Personal best: ${best.toFixed(2)}s`;
  showScreen("intro");
  app.onSpace = beginRound;
}

function beginRound() {
  const cfg = app.data.show[app.show.round];
  const lvl = app.data.levels[cfg.level];
  app.world = new World(lvl, app.data.physics, app.show.roster, { qualify: cfg.qualify, countdown: 3 });
  enterPlay("play", lvl, `Round ${app.show.round + 1} of ${app.data.show.length}`);
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
  $("hud").classList.remove("hidden");
  $("hud-round").textContent = roundLabel;
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
    if (n !== app.lastCount) { app.lastCount = n; banner(String(n)); }
  }
  $("hud-timer").textContent = formatTime(w.time);
  $("hud-status").textContent = statusText(w);

  if (app.mode === "tutorial") updateTip(w);

  if (w.status === "ended") {
    input.enabled = false;
    app.fastForward = false;
    app.endTimer += dt;
    if (app.endTimer > 1.8 && app.screen !== "result" && app.screen !== "tutdone") {
      if (app.mode === "tutorial") finishTutorial();
      else showRoundResult();
    }
  }
}

function statusText(w) {
  if (w.tutorial) return "Tutorial";
  if (w.type === "race") {
    const h = w.human;
    const base = `Qualified ${Math.min(w.finishers.length, w.qualify)} / ${w.qualify}`;
    return h && h.finished && w.status === "running" ? `${base} · fast-forward` : base;
  }
  const alive = w.aliveBodies().length;
  return w.qualify === 1 ? `${alive} left · last one wins` : `${alive} alive · ${w.qualify} qualify`;
}

function formatTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}

function handleEvents(events) {
  if (app.mode !== "play" && app.mode !== "tutorial") return;
  const hid = app.world.human?.id;
  for (const e of events) {
    if (e.type === "go") banner("GO!");
    else if (e.type === "checkpoint" && e.id === hid) banner("Checkpoint!", "small");
    else if (e.type === "finish" && e.id === hid) {
      if (app.mode === "tutorial") banner("Finished!");
      else {
        banner(e.place <= app.world.qualify ? "Qualified!" : "Finished", "");
        app.fastForward = true; // skip waiting for the others
      }
    } else if (e.type === "fall" && e.id === hid && app.world.type === "race") {
      banner("Whoops!", "small bad");
      if (app.mode === "tutorial") flashTip("You fell! You'll respawn at the last checkpoint you crossed.");
    } else if (e.type === "eliminated" && e.id === hid) banner("Eliminated!", "bad");
    else if (e.type === "end" && app.mode === "play" && app.world.human && !app.world.human.eliminated) {
      const q = app.world.result.playerQualified;
      if (app.world.type !== "race" || !q) banner(q ? (app.world.qualify === 1 ? "Winner!" : "Survived!") : "Eliminated!", q ? "" : "bad");
    }
  }
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
  const text = tip ? tip.text : null;
  if (text !== app.lastTip) {
    app.lastTip = text;
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
  const cfg = app.data.show[app.show.round];
  const lvl = w.level;
  app.show.results.push({ level: cfg.level, qualified: r.playerQualified, time: r.time, place: r.place });
  app.mode = "result";
  const last = app.show.round === app.data.show.length - 1;
  const title = $("result-title");
  if (r.playerQualified) {
    title.textContent = last ? "You won!" : "Qualified!";
    title.className = "good";
  } else {
    title.textContent = "Eliminated!";
    title.className = "bad";
  }
  let detail;
  if (lvl.type === "race") {
    detail = r.place ? `You finished #${r.place} in ${r.time.toFixed(2)}s.` : `The ${w.qualify} spots filled up before you reached the finish.`;
  } else if (r.playerQualified) {
    detail = last ? `You outlasted everyone in ${r.time.toFixed(1)}s!` : `You survived ${r.time.toFixed(1)}s.`;
  } else {
    detail = `You lasted ${r.time.toFixed(1)}s and placed #${r.place}.`;
  }
  $("result-detail").textContent = detail;
  const old = pbFor(cfg.level);
  const counts = lvl.type !== "race" || r.playerQualified;
  const better = old == null || (lvl.type === "race" ? r.time < old : r.time > old);
  $("result-pb").classList.toggle("hidden", !(counts && better));
  $("btn-continue").textContent = r.playerQualified && !last ? "Next round (Space)" : "See results (Space)";
  showScreen("result");
  app.onSpace = continueShow;
}

function continueShow() {
  const r = app.world.result;
  const last = app.show.round === app.data.show.length - 1;
  if (r.playerQualified && !last) {
    app.show.roster = app.show.roster.filter((p) => r.qualified.includes(p.id));
    app.show.round++;
    showIntro();
  } else {
    finishShow();
  }
}

async function finishShow() {
  app.onSpace = null;
  let res;
  try {
    res = await api.submitShow(app.show.results);
  } catch (err) {
    showError(`Could not save results: ${err.message}`);
    backToMenu();
    return;
  }
  app.profile = res.profile;
  const reached = app.show.results.length;
  const title = $("show-title");
  if (res.won) {
    title.textContent = "Crown won!";
    title.className = "good";
    $("show-detail").textContent = "You beat all 11 rivals across every round. Incredible!";
  } else {
    title.textContent = "Show over";
    title.className = "bad";
    const lvl = app.data.levels[app.data.show[reached - 1].level];
    $("show-detail").textContent = `You were eliminated in round ${reached} (${lvl.name}).`;
  }
  drawPreview($("show-preview"), app.profile.color, res.won);
  $("show-score").textContent = res.score;
  const list = $("show-records");
  list.innerHTML = "";
  for (const rec of res.records) {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = `New record · ${rec.label}: `;
    li.append(b, rec.value);
    list.append(li);
  }
  if (!res.records.length) {
    const li = document.createElement("li");
    li.textContent = `Best score so far: ${app.profile.personal_best.best_score}`;
    list.append(li);
  }
  app.mode = "result";
  $("hud").classList.add("hidden");
  showScreen("show");
  app.onSpace = startShow;
}

// ------------------------------------------------------------------ tutorial

function startTutorial() {
  const lvl = app.data.levels[app.data.tutorial_level];
  const human = { id: "you", name: app.profile.name, color: app.profile.color, isHuman: true };
  app.world = new World(lvl, app.data.physics, [human], { tutorial: true, countdown: 2 });
  app.tipFlashUntil = 0;
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
  showScreen("tutdone");
  app.onSpace = startShow;
}

// ------------------------------------------------------------------ pause & menus

function togglePause() {
  if (app.mode !== "play" && app.mode !== "tutorial") return;
  if (app.world.status === "ended") return;
  app.paused = !app.paused;
  input.enabled = !app.paused;
  input.reset();
  $("btn-restart-tut").classList.toggle("hidden", app.mode !== "tutorial");
  showScreen(app.paused ? "pause" : null);
}

function backToMenu() {
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
  const furthest = pb.furthest_round > app.data.show.length
    ? "Won the final" : pb.furthest_round ? `Round ${pb.furthest_round}` : "--";
  const rows = [
    ["Best show score", pb.best_score || "--"],
    ["Furthest round", furthest],
    ["Crowns won", s.wins],
    ["Shows played", s.shows_played],
    ["Rounds qualified", s.rounds_qualified],
  ];
  for (const id of [...app.data.show.map((r) => r.level), app.data.tutorial_level]) {
    const lvl = levels[id];
    const best = pb.levels[id]?.best_time;
    const kind = lvl.type === "race" ? "fastest" : "longest survived";
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
  if (code === "Escape" || code === "KeyP") {
    if (app.mode === "play" || app.mode === "tutorial") { e.preventDefault(); togglePause(); }
    else if (["howto", "records", "first"].includes(app.screen)) showScreen("menu");
    return;
  }
  if (e.target instanceof HTMLButtonElement) return; // the focused button handles it
  if ((code === "Space" || code === "Enter") && app.onSpace && ["intro", "result", "show", "tutdone"].includes(app.screen)) {
    e.preventDefault();
    const fn = app.onSpace;
    app.onSpace = null;
    fn();
  }
}

function on(id, fn) {
  $(id).addEventListener("click", (e) => { e.currentTarget.blur(); app.onSpace = null; fn(); });
}

on("btn-play", startShowFlow);
on("btn-tutorial", startTutorial);
on("btn-howto", () => showScreen("howto"));
on("btn-records", showRecords);
on("btn-first-tutorial", startTutorial);
on("btn-first-skip", startShow);
on("btn-ready", beginRound);
on("btn-continue", continueShow);
on("btn-again", startShow);
on("btn-tut-play", startShow);
on("btn-tut-again", startTutorial);
on("btn-resume", togglePause);
on("btn-restart-tut", () => { app.paused = false; startTutorial(); });
on("btn-quit", backToMenu);
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
  if (!app.paused && (app.mode === "play" || app.mode === "tutorial") && app.world?.status !== "ended") togglePause();
});

boot();
