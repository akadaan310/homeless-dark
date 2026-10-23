// Unified input: keyboard, mouse drag, touch (virtual joystick + look pad + buttons), gamepad.
export interface InputState {
  move: { x: number; y: number }; // x right, y forward, each in [-1, 1]
  look: { dx: number; dy: number }; // accumulated this frame (pixels-ish)
  run: boolean; jump: boolean; interact: boolean; vehicle: boolean; brake: boolean;
  up: boolean; down: boolean; // flight/boat vertical or throttle
  zoom: number;
}

export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private lookAcc = { dx: 0, dy: 0 };
  private zoomAcc = 0;
  touchMove = { x: 0, y: 0 };
  touchButtons = new Set<string>();
  private touchPressed = new Set<string>();
  enabled = true;
  lastDevice: 'keyboard' | 'touch' | 'gamepad' = 'keyboard';
  /** Deterministic replay hook (tests only): when set, read() returns this instead of device input. */
  scripted: (() => InputState) | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    let dragging = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { dragging = true; lx = e.clientX; ly = e.clientY; } });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === el) { this.lookAcc.dx += e.movementX; this.lookAcc.dy += e.movementY; return; }
      if (!dragging) return;
      this.lookAcc.dx += e.clientX - lx; this.lookAcc.dy += e.clientY - ly; lx = e.clientX; ly = e.clientY;
    });
    el.addEventListener('wheel', (e) => { this.zoomAcc += Math.sign(e.deltaY); }, { passive: true });
  }

  /** Touch look pad deltas (called by the HUD). */
  addLook(dx: number, dy: number) { this.lookAcc.dx += dx; this.lookAcc.dy += dy; this.lastDevice = 'touch'; }
  pressTouch(b: string) { if (!this.touchButtons.has(b)) this.touchPressed.add(b); this.touchButtons.add(b); this.lastDevice = 'touch'; }
  releaseTouch(b: string) { this.touchButtons.delete(b); }

  read(): InputState {
    if (this.scripted) return this.scripted();
    const k = (c: string) => this.keys.has(c);
    const once = (c: string, t?: string) => { const v = this.pressed.has(c) || (t ? this.touchPressed.has(t) : false); return v; };
    let x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let y = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    if (Math.abs(this.touchMove.x) + Math.abs(this.touchMove.y) > 0.05) { x = this.touchMove.x; y = this.touchMove.y; }
    const pads = navigator.getGamepads?.() ?? [];
    let gpLook = { dx: 0, dy: 0 }, gpRun = false, gpJump = false, gpInteract = false, gpVehicle = false;
    for (const gp of pads) {
      if (!gp) continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      if (Math.abs(dz(gp.axes[0] ?? 0)) + Math.abs(dz(gp.axes[1] ?? 0)) > 0) { x = dz(gp.axes[0] ?? 0); y = -dz(gp.axes[1] ?? 0); this.lastDevice = 'gamepad'; }
      gpLook = { dx: dz(gp.axes[2] ?? 0) * 12, dy: dz(gp.axes[3] ?? 0) * 12 };
      gpRun = !!gp.buttons[10]?.pressed || !!gp.buttons[5]?.pressed;
      gpJump = !!gp.buttons[0]?.pressed; gpInteract = !!gp.buttons[2]?.pressed; gpVehicle = !!gp.buttons[3]?.pressed;
    }
    const s: InputState = {
      move: { x: this.enabled ? x : 0, y: this.enabled ? y : 0 },
      look: { dx: this.lookAcc.dx + gpLook.dx, dy: this.lookAcc.dy + gpLook.dy },
      run: k('ShiftLeft') || k('ShiftRight') || this.touchButtons.has('run') || gpRun,
      jump: once('Space', 'jump') || gpJump,
      interact: once('KeyE', 'interact') || gpInteract,
      vehicle: once('KeyF', 'vehicle') || gpVehicle,
      brake: k('Space') || this.touchButtons.has('brake'),
      up: k('KeyR') || k('PageUp') || this.touchButtons.has('up'),
      down: k('KeyC') || k('PageDown') || this.touchButtons.has('down'),
      zoom: this.zoomAcc,
    };
    this.lookAcc = { dx: 0, dy: 0 };
    this.zoomAcc = 0;
    this.pressed.clear();
    this.touchPressed.clear();
    if (!this.enabled) { s.jump = s.interact = s.vehicle = false; }
    return s;
  }
}
