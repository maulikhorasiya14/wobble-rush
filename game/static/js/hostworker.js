// Runs a multiplayer round for the room host, in a background worker.
//
// A worker keeps a steady pace even when the host's tab is in the background
// or busy drawing. It has its own connection to the server, so snapshots go
// straight out and players' reports come straight in without waiting on the
// host's page. (If that connection can't be made, the page relays instead.)
import { makeSnapshot, OWN_FIELDS, RemoteTrack, SHARED_EVENTS, SNAP_EVERY } from "./netsync.js";
import { World } from "./world.js";

const STEP = 1 / 120;
let world = null, index = 0, timer = null, last = 0, acc = 0, snapT = 0, events = [], reported = false, afterEnd = 0;
let tracks = new Map();
let ws = null, attached = false, cred = null, retry = null;

self.onmessage = ({ data: m }) => {
  if (m.t === "start") {
    cred = m.cred;
    connect();
    clearInterval(timer);
    world = new World(m.level, m.physics, m.roster, {
      qualify: m.qualify, countdown: m.countdown, multiplayer: true,
      external: m.roster.filter((r) => r.isHuman).map((r) => r.id),
    });
    index = m.index;
    acc = snapT = afterEnd = 0;
    events = [];
    reported = false;
    tracks = new Map();
    last = performance.now();
    timer = setInterval(tick, 4);
  } else if (m.t === "state") {
    onState(m);                       // relayed by the page (fallback)
  } else if (m.t === "left" && world) {
    world.dropPlayer(m.id);
  } else if (m.t === "stop") {
    clearInterval(timer);
    world = null;
  }
};

/** Our own line to the server, logged in as the host's game. */
function connect() {
  if (ws || !cred) return;
  const url = new URL("/ws", self.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  try {
    ws = new WebSocket(url);
  } catch {
    ws = null;
    return;
  }
  ws.onopen = () => ws.send(JSON.stringify({ t: "attach", id: cred.id, secret: cred.secret }));
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === "attached") { attached = true; self.postMessage({ t: "attached" }); }
    else if (m.t === "state") onState(m);
    else if (m.t === "left" && world) world.dropPlayer(m.id);
  };
  ws.onclose = () => {
    ws = null;
    if (attached) self.postMessage({ t: "detached" });
    attached = false;
    clearTimeout(retry);
    retry = setTimeout(connect, 1000);
  };
}

function send(msg) {
  const text = typeof msg === "string" ? msg : JSON.stringify(msg);
  if (attached && ws && ws.readyState === WebSocket.OPEN) ws.send(text);
  else self.postMessage({ t: "relay", text });   // the page sends it for us
}

/** A player's browser reported where its character is. */
function onState(m) {
  if (!world || !Array.isArray(m.s)) return;
  let track = tracks.get(m.id);
  if (!track) tracks.set(m.id, (track = new RemoteTrack()));
  track.push(m.at, m.s, m.ev, performance.now() / 1000);
}

/** Move every person's character to where their (smoothed) reports say. */
function applyTracks() {
  const now = performance.now() / 1000;
  for (const [id, track] of tracks) {
    const b = world.bodies.find((q) => q.id === id);
    const got = track.sample(now);
    if (!b || !got || b.eliminated) continue;
    for (const f of OWN_FIELDS) b[f] = got.body[f];
    if (got.body.eliminated) world.eliminate(b);
    for (const e of got.events.slice(0, 12)) {
      if (e && SHARED_EVENTS.has(e.type)) world.events.push({ ...e, id });
    }
  }
}

function tick() {
  if (!world) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  applyTracks();
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
    snapT -= SNAP_EVERY;
    if (snapT > SNAP_EVERY) snapT = 0;
    send(makeSnapshot(world, index, events));
    events = [];
  }
  if (ended && !reported) {
    reported = true;
    send({ t: "round_end", index, qualified: world.result.qualified, results: world.result.players });
  }
  if (ended) {
    afterEnd += dt;
    if (afterEnd > 3) clearInterval(timer); // a few more snapshots so everyone sees the finish
  }
}
