// Keyboard input. Jump and dive presses are buffered briefly so a press just
// before landing still counts.
const MOVE = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};
const JUMP = new Set(["Space"]);
const DIVE = new Set(["ShiftLeft", "ShiftRight", "KeyE"]);
const BUFFER = 0.1;

export class Input {
  constructor() {
    this.down = new Set();
    this.jumpT = 0;
    this.diveT = 0;
    this.enabled = false;
    this.onKey = null; // optional (code) => void for menus
    this.intent = { mx: 0, my: 0, jump: false, dive: false, usedJump: false, usedDive: false };

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (this.onKey) this.onKey(e.code, e);
      if (!this.enabled) return;
      if (MOVE[e.code] || JUMP.has(e.code) || DIVE.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (JUMP.has(e.code)) this.jumpT = BUFFER;
      if (DIVE.has(e.code)) this.diveT = BUFFER;
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));

    // Mouse look: counts while the mouse is captured (pointer lock) or while
    // dragging with a button held down.
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    window.addEventListener("mousemove", (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement || e.buttons) {
        this.lookX += e.movementX || 0;
        this.lookY += e.movementY || 0;
      }
    });
    window.addEventListener("wheel", (e) => { if (this.enabled) this.wheel += e.deltaY; }, { passive: true });
    window.addEventListener("blur", () => this.down.clear());
  }

  /** Movement + actions for one simulation step. */
  step(dt) {
    let mx = 0, my = 0;
    for (const code of this.down) {
      const m = MOVE[code];
      if (m) { mx += m[0]; my += m[1]; }
    }
    const it = this.intent;
    if (it.usedJump) this.jumpT = 0;
    if (it.usedDive) this.diveT = 0;
    it.usedJump = it.usedDive = false;
    it.mx = Math.sign(mx);
    it.my = Math.sign(my);
    it.jump = this.jumpT > 0;
    it.dive = this.diveT > 0 && !it.jump;
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.diveT = Math.max(0, this.diveT - dt);
    return it;
  }

  /** Mouse movement and wheel since the last call: [dx, dy, wheel]. */
  takeLook() {
    const out = [this.lookX, this.lookY, this.wheel];
    this.lookX = this.lookY = this.wheel = 0;
    return out;
  }

  reset() {
    this.down.clear();
    this.jumpT = this.diveT = 0;
    this.lookX = this.lookY = this.wheel = 0;
  }
}
