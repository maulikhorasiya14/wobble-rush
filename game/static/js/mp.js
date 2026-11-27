// Multiplayer: rooms joined with a code, up to 20 people per show.
// The server (game/multiplayer.py) runs the show. The room host's browser runs
// each round in a worker (hostworker.js); every browser plays the host's
// snapshots back smoothly and moves its own character itself (netsync.js).
import { encodeBody, Mirror, SHARED_EVENTS, SNAP_EVERY } from "./netsync.js";
import { World } from "./world.js";

const STEP = 1 / 120;
const $ = (id) => document.getElementById(id);

/** Something that went wrong that retrying won't fix (wrong code, room full...). */
class RoomError extends Error {}

export class Multiplayer {
  /** @param ui helpers and shared state from main.js */
  constructor(ui) {
    this.ui = ui;
    this.ws = null;
    this.me = null;
    this.code = null;
    this.color = null;     // our colour in this room (may differ from the profile)
    this.room = null;
    this.round = null;     // latest "round" message
    this.world = null;
    this.mirror = null;
    this.worker = null;    // host only
    this.acc = 0;
    this.sendT = 0;
    this.outEvents = [];
    this.spectate = null;
    this.timers = [];
    // Heartbeat so the server notices if this browser silently drops off.
    this.beat = setInterval(() => this.send({ t: "ping" }), 5000);
  }

  // ------------------------------------------------------------ connection

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws`);
      this.ws = ws;
      let open = false;
      const timer = setTimeout(() => { reject(new Error("the game server didn't answer")); ws.close(); }, 10000);
      ws.onopen = () => { open = true; clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); if (!open) reject(new Error("can't reach the game server")); };
      ws.onmessage = (e) => {
        try {
          this._onMessage(JSON.parse(e.data));
        } catch (err) {
          console.error("multiplayer message failed:", err);
        }
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (this.ws !== ws || this.closing) return;
        if (this.waiting) {
          this.waiting.reject(new Error("the connection dropped while joining"));
          this.waiting = null;
        } else if (open) {
          this.ui.onDisconnected();
        }
      };
    });
  }

  /** Create (code = null) or join a room. Resolves once we're in; retries a dropped connection once. */
  async enter(code, settings = {}, name = null) {
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.connect();
        await this._hello(code, settings, name);
        return;
      } catch (err) {
        lastErr = err;
        this._dropSocket();
        if (err instanceof RoomError) break;
      }
    }
    throw lastErr;
  }

  _hello(code, settings, name) {
    const p = { ...this.ui.app.profile, name: name || this.ui.app.profile.name };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiting) { this.waiting = null; reject(new Error("the game server didn't answer")); }
      }, 10000);
      this.waiting = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      if (code) this.send({ t: "join", code, name: p.name, color: p.color });
      else this.send({ t: "create", name: p.name, color: p.color, ...settings });
    });
  }

  _dropSocket() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* already closed */ } }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  leave() {
    this.closing = true;
    this._clearTimers();
    clearInterval(this.beat);
    this._stopWorker();
    this.send({ t: "leave" });
    this._dropSocket();
  }

  get isHost() { return !!this.round && this.round.host === this.me; }
  get isRoomHost() { return !!this.room && this.room.host === this.me; }
  get playing() { return !!this.round && this.round.roster.some((r) => r.id === this.me); }

  // ------------------------------------------------------------ messages

  _onMessage(msg) {
    switch (msg.t) {
      case "joined":
        this.me = msg.you;
        this.code = msg.code;
        this.color = msg.color;
        this.secret = msg.secret;
        break; // the room's details follow straight away
      case "error":
        if (this.waiting) { this.waiting.reject(new RoomError(msg.message)); this.waiting = null; }
        else this.ui.showError(msg.message);
        break;
      case "notice":
        this.ui.showInfo(msg.message);
        break;
      case "room":
        this.room = msg;
        if (this.waiting && this.me) { this.waiting.resolve(); this.waiting = null; }
        if (this.ui.app.screen === "lobby") this.renderLobby();
        break;
      case "round":
        this._onRound(msg);
        break;
      case "snap":
        if (this.mirror && this.round && msg.i === this.round.index) this.mirror.push(msg);
        break;
      case "state":
        // Only reaches the page if the host's worker couldn't connect by itself.
        if (this.isHost && this.worker) this.worker.postMessage({ t: "state", id: msg.id, at: msg.at, s: msg.s, ev: msg.ev });
        break;
      case "left":
        if (this.isHost && this.worker) this.worker.postMessage({ t: "left", id: msg.id });
        break;
      case "round_result":
        this._onRoundResult(msg);
        break;
      case "show_over":
        this._onShowOver(msg);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ lobby

  showLobby() {
    const { app, input } = this.ui;
    input.enabled = false;
    app.mpMenu = false;
    app.onSpace = null;
    $("hud").classList.add("hidden");
    // The menu's bot race plays behind the lobby.
    if (app.mode !== "lobby") { app.mode = "lobby"; this.ui.startAttract(); }
    this.ui.showScreen("lobby");
    this.renderLobby();
  }

  renderLobby() {
    const room = this.room;
    if (!room) return;
    const host = this.isRoomHost;
    $("lobby-code").textContent = room.code;
    $("lobby-share").textContent = `Share this code: friends press Multiplayer, type ${room.code} and press Join.`;
    $("lobby-count").textContent = `${room.players.length}/${room.max}`;
    const list = $("lobby-players");
    list.innerHTML = "";
    for (const p of room.players) {
      const li = document.createElement("li");
      li.append(this.ui.playerIcon({ ...p, isHuman: true }));
      const name = document.createElement("span");
      name.textContent = p.name;
      li.append(name);
      if (p.id === room.host) li.append(tag("Host", "host"));
      if (p.id === this.me) li.append(tag("You", "you"));
      list.append(li);
    }
    const data = this.ui.app.data.multiplayer;
    segmented($("lobby-rounds"), data.round_options, room.rounds, (n) => String(n), host,
      (n) => this.send({ t: "settings", rounds: n }));
    segmented($("lobby-bots"), data.bot_options, room.bots, (n) => (n ? `Fill to ${n}` : "Off"), host,
      (n) => this.send({ t: "settings", bots: n }));
    $("lobby-settings-note").textContent = host ? "" : "Only the host can change these.";

    const people = room.players.length;
    const total = people + Math.max(0, room.bots - people);
    const need = room.rounds + 1;
    const hostName = room.players.find((p) => p.id === room.host)?.name || "the host";
    let status, ok = false;
    if (room.phase !== "lobby") {
      status = "A show is in progress. You'll watch it, then join the next one.";
    } else if (total < need) {
      status = `A ${room.rounds}-round show needs at least ${need} players (${total} so far). `
        + (host ? "Wait for friends, turn on bots or pick fewer rounds." : `Waiting for more players or for ${hostName} to change the settings...`);
    } else {
      ok = true;
      const bots = total - people;
      status = `Ready: ${people} ${people === 1 ? "person" : "people"}${bots ? ` + ${bots} bots` : ""} · ${room.rounds} ${room.rounds === 1 ? "round" : "rounds"}`;
      if (!host) status += ` · waiting for ${hostName} to start`;
    }
    const st = $("lobby-status");
    st.textContent = status;
    st.classList.toggle("ready", ok);
    const start = $("btn-lobby-start");
    start.classList.toggle("hidden", !host);
    start.disabled = !ok || room.phase !== "lobby";
  }

  start() {
    this.send({ t: "start" });
  }

  // ------------------------------------------------------------ rounds

  _onRound(msg) {
    const { app, input, data } = this.ui;
    this._clearTimers();
    this.round = msg;
    const lvl = data.levels[msg.level];
    this.world = new World(lvl, data.physics, msg.roster, {
      qualify: msg.qualify, countdown: msg.intro + 3, localId: this.me, multiplayer: true,
    });
    this.mirror = new Mirror(this.world, this.me);
    app.world = this.world;
    app.mpMenu = false;
    app.onSpace = null;
    this.acc = 0;
    this.sendT = 0;
    this.outEvents = [];
    this.spectate = null;
    if (this.isHost) this._startWorker(lvl, msg);
    else this._stopWorker();

    // Round intro card, then into the round.
    app.mode = "intro";
    input.enabled = false;
    $("hud").classList.add("hidden");
    this.ui.renderer().cinematic?.("intro");
    this.ui.fillIntro(lvl, msg, msg.roster);
    $("btn-ready").classList.add("hidden");
    $("btn-intro-quit").classList.add("hidden");
    this.ui.showScreen("intro");
    const best = this.ui.pbFor(msg.level);
    const pb = best == null ? "" : ` · Personal best ${best.toFixed(2)}s`;
    const watching = this.playing ? "" : "You're watching this round. ";
    this._countdown(msg.intro, (n) => {
      $("intro-pb").textContent = `${watching}Starting in ${n}...${pb}`;
    }, () => this._play(lvl));
  }

  _startWorker(lvl, msg) {
    if (!this.worker) {
      this.worker = new Worker(new URL("./hostworker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data: m }) => {
        // Normally the worker talks to the server itself; this is the fallback
        // where the page passes its messages on.
        if (m.t !== "relay") return;
        this.send(m.text);
        if (m.text.startsWith('{"t":"snap"') && this.mirror && this.round && this.isHost) {
          this.mirror.push(JSON.parse(m.text)); // the server doesn't echo relayed snapshots back
        }
      };
      this.worker.onerror = (e) => console.error("host worker failed:", e.message);
    }
    this.worker.postMessage({
      t: "start", level: lvl, physics: this.ui.data.physics, roster: msg.roster,
      qualify: msg.qualify, countdown: msg.intro + 3, index: msg.index,
      cred: { id: this.me, secret: this.secret },
    });
  }

  _stopWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  _play(lvl) {
    const msg = this.round;
    this.ui.renderer().cinematic?.("play");
    this.ui.enterPlay("play", lvl, `Round ${msg.index + 1} of ${msg.total}`);
    this.ui.input.enabled = this.canControl();
    if (!this.playing) this.ui.banner("Watching", "small");
  }

  own() {
    return this.world ? this.world.bodies.find((b) => b.id === this.me) || null : null;
  }

  canControl() {
    const w = this.world;
    if (!w || w.status === "ended" || this.ui.app.mpMenu || this.ui.app.mode !== "play") return false;
    const mine = this.own();
    return !!mine && !mine.eliminated && !mine.finished;
  }

  /**
   * One frame of a multiplayer round: play back the host's snapshots, move our
   * own character, and report it. Returns the draw blend for our character.
   */
  frame(dt, playing) {
    const w = this.world;
    if (!this.mirror.frame()) return 1; // nothing from the host yet
    const mine = this.own();
    if (!mine) return 1;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 40) {
      const it = playing && this.canControl() ? this.ui.intent(STEP) : undefined;
      w.stepLocal(mine, it, STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 40) this.acc = 0;
    for (const e of w.events) {
      if (e.id === this.me && SHARED_EVENTS.has(e.type) && !e.fromHost) {
        this.outEvents.push({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), dx: e.dx, dy: e.dy });
      }
    }
    this.sendT += dt;
    if (this.sendT >= SNAP_EVERY && (this.ui.app.mode === "play" || this.ui.app.mode === "intro")) {
      this.sendT = 0;
      const row = encodeBody(mine);
      const ev = this.outEvents.splice(0, 12);
      // Skip identical reports while standing still.
      const key = row.join(",");
      if (ev.length || key !== this.lastRow || this.quietT > 0.5) {
        this.send({ t: "state", at: Math.round(performance.now()) / 1000, s: row, ev });
        this.lastRow = key;
        this.quietT = 0;
      } else {
        this.quietT = (this.quietT || 0) + SNAP_EVERY;
      }
    }
    return Math.min(1, this.acc / STEP);
  }

  // ------------------------------------------------------------ watching

  followId() {
    const w = this.world;
    if (!w) return null;
    const mine = this.own();
    if (mine && !mine.eliminated && !mine.finished) return this.me;
    const alive = this._watchable();
    let t = alive.find((b) => b.id === this.spectate);
    if (!t && mine && !mine.eliminated) return this.me; // finished: stay on yourself until you switch
    if (!t) t = alive[0];
    this.spectate = t ? t.id : null;
    return this.spectate;
  }

  /** People first (furthest ahead first), then bots. */
  _watchable() {
    return this.world.bodies.filter((b) => !b.eliminated && !b.hidden)
      .sort((a, b) => (b.isHuman - a.isHuman) || (a.y - b.y));
  }

  /** The character the camera follows while we can't play (finished, out or watching), else null. */
  watching() {
    const w = this.world;
    if (!w || this.ui.app.mode !== "play") return null;
    const mine = this.own();
    if (mine && !mine.eliminated && !mine.finished) return null;
    return w.bodies.find((b) => b.id === this.followId()) || null;
  }

  cycleWatch(dir) {
    const list = this._watchable();
    if (!list.length) return;
    const cur = this.followId();
    const i = list.findIndex((b) => b.id === cur);
    this.spectate = list[(i + dir + list.length) % list.length].id;
  }

  // ------------------------------------------------------------ results

  _onRoundResult(msg) {
    const { app, input } = this.ui;
    this._clearTimers();
    app.mode = "result";
    app.mpMenu = false;
    input.enabled = false;
    const mine = msg.results[this.me];
    const r = this.round || {};
    const lvl = this.ui.app.data.levels[r.level];
    const final = !!r.final;
    const title = $("result-title");
    let good = false;
    if (mine) {
      good = mine.qualified;
      title.textContent = good ? (final ? "Crowned!" : "Qualified!") : "Eliminated!";
      $("result-detail").textContent = this.ui.resultDetail(lvl, mine, good, final, r.qualify);
      $("result-pb").classList.toggle("hidden", !this.ui.isNewBest(lvl, mine.time, good));
    } else {
      title.textContent = "Round over";
      const names = msg.qualified.map((id) => this.round?.roster.find((p) => p.id === id)?.name).filter(Boolean);
      $("result-detail").textContent = final && names.length === 1
        ? `${names[0]} wins the crown!`
        : `${msg.qualified.length} qualified${names.length && names.length <= 6 ? `: ${names.join(", ")}` : ""}.`;
      $("result-pb").classList.add("hidden");
    }
    title.className = `stamp ${good ? "good" : "bad"}`;
    $("screen-result").className = `screen showbg ${good ? "mood-win" : "mood-lose"}`;
    $("btn-continue").classList.add("hidden");
    $("btn-result-quit").classList.add("hidden");
    const next = $("result-next");
    next.classList.remove("hidden");
    const out = mine && !mine.qualified && !msg.done ? "You're out, but you can keep watching. " : "";
    this._countdown(msg.next_in, (n) => {
      next.textContent = msg.done ? `Final results in ${n}...` : `${out}Next round in ${n}...`;
    });
    this.ui.showScreen("result");
  }

  _onShowOver(msg) {
    const { app } = this.ui;
    this._clearTimers();
    this._stopWorker();
    app.mode = "result";
    this.round = null;
    const you = msg.you || {};
    if (you.profile) {
      app.profile = you.profile;
      this.ui.refreshMenu();
    }
    const winner = msg.winners.length === 1 ? msg.winners[0] : null;
    const title = $("show-title");
    if (you.won) {
      title.textContent = "Crown won!";
      title.className = "good";
      $("show-detail").textContent = `You beat everyone in room ${this.code}. Incredible!`;
    } else {
      title.textContent = winner ? `${winner.name} wins!` : "Show over";
      title.className = "bad";
      const reached = you.reached === 1 ? "You were knocked out in round 1." : `You reached round ${you.reached}.`;
      $("show-detail").textContent = !you.played
        ? "Thanks for watching! You'll be in the next show."
        : winner ? reached : `${reached} Nobody took the crown this time.`;
    }
    this.ui.drawPreview($("show-preview"), winner ? winner.color : this.color || app.profile.color, !!winner);
    $("show-score-wrap").classList.toggle("hidden", !you.played);
    $("show-score").textContent = you.score ?? 0;
    this.ui.fillRecords(you.records || []);
    const st = $("show-standings");
    st.innerHTML = "";
    st.classList.remove("hidden");
    // Players knocked out in the same round share a place.
    const rankKey = (s) => `${s.won ? 0 : 1}|${s.left ? 1 : 0}|${99 - s.reached}`;
    for (const s of msg.standings) {
      const li = document.createElement("li");
      li.className = s.id === this.me ? "me" : "";
      li.dataset.rank = 1 + msg.standings.filter((o) => rankKey(o) < rankKey(s)).length;
      li.append(this.ui.playerIcon({ ...s, isHuman: true }));
      const name = document.createElement("span");
      name.textContent = s.name;
      const how = document.createElement("small");
      how.textContent = s.won ? "♛ Winner" : s.left ? "Left" : `Out in round ${s.reached}`;
      li.append(name, how);
      st.append(li);
    }
    $("btn-again").textContent = "Back to lobby";
    $("hud").classList.add("hidden");
    this.ui.showScreen("show");
    this.ui.armSpace(() => this.showLobby());
  }

  // ------------------------------------------------------------ helpers

  _countdown(seconds, onTick, onDone) {
    let n = Math.max(0, Math.round(seconds));
    onTick(n);
    const id = setInterval(() => {
      n--;
      if (n > 0) onTick(n);
      else {
        clearInterval(id);
        this.timers = this.timers.filter((t) => t !== id);
        if (onDone) onDone();
        else onTick(0);
      }
    }, 1000);
    this.timers.push(id);
  }

  _clearTimers() {
    for (const id of this.timers) clearInterval(id);
    this.timers = [];
  }
}

function tag(text, cls) {
  const el = document.createElement("em");
  el.className = `tag ${cls}`;
  el.textContent = text;
  return el;
}

/** A row of option buttons; only the host can change them. */
function segmented(box, options, value, label, editable, onPick) {
  box.innerHTML = "";
  for (const n of options) {
    const b = document.createElement("button");
    b.textContent = label(n);
    b.classList.toggle("active", n === value);
    b.disabled = !editable;
    if (!editable) b.title = "Only the host can change this";
    b.addEventListener("click", () => { b.blur(); onPick(n); });
    box.append(b);
  }
}
