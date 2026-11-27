// Runs a multiplayer round for the room host, in a background worker.
//
// A worker keeps a steady pace even when the host's tab is in the background
// or busy drawing, so everyone else's game never stalls because of the host.
// It sends snapshots (as JSON text) to the host's page, which forwards them to
// the server and also plays them itself, exactly like every other player.
import { decodeBody, makeSnapshot, OWN_FIELDS, SHARED_EVENTS, SNAP_EVERY } from "./netsync.js";
import { World } from "./world.js";

const STEP = 1 / 120;
let world = null, index = 0, timer = null, last = 0, acc = 0, snapT = 0, events = [], reported = false, afterEnd = 0;

self.onmessage = ({ data: m }) => {
  if (m.t === "start") {
    clearInterval(timer);
    world = new World(m.level, m.physics, m.roster, {
      qualify: m.qualify, countdown: m.countdown, multiplayer: true,
      external: m.roster.filter((r) => r.isHuman).map((r) => r.id),
    });
    index = m.index;
    acc = snapT = afterEnd = 0;
    events = [];
    reported = false;
    last = performance.now();
    timer = setInterval(tick, 4);
  } else if (m.t === "state" && world) {
    applyState(m.id, m.s, m.ev);
  } else if (m.t === "left" && world) {
    world.dropPlayer(m.id);
  } else if (m.t === "stop") {
    clearInterval(timer);
    world = null;
  }
};

/** A player's browser reported where its character is. */
function applyState(id, row, ev) {
  const b = world.bodies.find((q) => q.id === id);
  if (!b || b.eliminated || !Array.isArray(row)) return;
  const s = decodeBody(row);
  for (const f of OWN_FIELDS) b[f] = s[f];
  if (s.eliminated) world.eliminate(b);
  if (Array.isArray(ev)) {
    for (const e of ev.slice(0, 12)) {
      if (e && SHARED_EVENTS.has(e.type)) world.events.push({ ...e, id });
    }
  }
}

function tick() {
  if (!world) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  // Nobody left racing: hurry the bots along.
  const ff = world.status === "running" && !world.bodies.some((b) => b.isHuman && !b.finished && !b.eliminated);
  acc += dt * (ff ? 3 : 1);
  let n = 0;
  while (acc >= STEP && n < 240) {
    world.update(STEP);
    acc -= STEP;
    n++;
  }
  for (const e of world.events) events.push(e);
  world.events.length = 0;
  snapT += dt;
  const ended = world.status === "ended";
  if (snapT >= SNAP_EVERY || (ended && !reported)) {
    snapT = 0;
    self.postMessage({ t: "snap", text: JSON.stringify(makeSnapshot(world, index, events)) });
    events = [];
  }
  if (ended && !reported) {
    reported = true;
    self.postMessage({ t: "round_end", index, qualified: world.result.qualified, results: world.result.players });
  }
  if (ended) {
    afterEnd += dt;
    if (afterEnd > 3) clearInterval(timer); // a few more snapshots so everyone sees the finish
  }
}
