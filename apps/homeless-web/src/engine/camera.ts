// Camera grammar: third-person follow, vehicle chase, cabin/cockpit and cinematic
// modes with authored transitions; collision against Rapier (CAMERA_BLOCK group);
// frame-rate-invariant damping; stable horizon; no shake unless opted in.
import { Vec3, Quat, Euler, type Camera } from '@astro/core';
import type { Physics } from './physics';
import { GROUP } from './physics';

export type CamMode = 'follow' | 'vehicle' | 'cabin' | 'cockpit' | 'cinematic';

export class CameraRig {
  yaw = Math.PI; // facing −z initially is yaw = π? (camera behind looking +x…) — set by spawn
  pitch = -0.18;
  distance = 4.2;
  mode: CamMode = 'follow';
  readonly target = new Vec3();
  private cur = new Vec3();
  private initialized = false;
  sensitivity = 0.0042;
  collisions = 0;
  reducedMotion = false;
  cinematic: { from: Vec3; to: Vec3; look: Vec3; t: number; dur: number } | null = null;

  constructor(readonly camera: Camera, private phys: Physics) {}

  look(dx: number, dy: number) {
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-1.1, Math.min(0.45, this.pitch - dy * this.sensitivity));
  }

  /** Forward direction on the ground plane for movement input. */
  forward(out = new Vec3()): Vec3 { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out = new Vec3()): Vec3 { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }

  setMode(m: CamMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.distance = m === 'vehicle' ? 7.5 : m === 'follow' ? 4.2 : 0.01;
    this.camera.fov = m === 'cabin' ? 70 : m === 'cockpit' ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, focus: Vec3, heading?: number, interiorEye?: Vec3, interiorQuat?: Quat): void {
    if (this.cinematic) {
      const c = this.cinematic;
      c.t += dt;
      const u = Math.min(1, c.t / c.dur), s = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(c.from, c.to, s);
      this.camera.lookAt(c.look);
      if (u >= 1) this.cinematic = null;
      return;
    }
    if ((this.mode === 'cabin' || this.mode === 'cockpit') && interiorEye) {
      this.camera.position.copy(interiorEye);
      const q = new Quat().setFromEuler(new Euler(this.pitch * 0.8, this.yaw, 0, 'YXZ'));
      if (interiorQuat) this.camera.quaternion.copy(interiorQuat).multiply(q); else this.camera.quaternion.copy(q);
      return;
    }
    if (this.mode === 'vehicle' && heading !== undefined) {
      // gently swing behind the vehicle heading unless the player is looking around
      let d = heading - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 1.6));
    }
    this.target.copy(focus);
    const dir = new Vec3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    let dist = this.distance;
    const hit = this.phys.ray(this.target, dir, dist + 0.3, GROUP.CAMERA_BLOCK);
    if (hit && hit.toi < dist + 0.3) { dist = Math.max(0.6, hit.toi - 0.3); this.collisions++; }
    const desired = this.target.clone().addScaledVector(dir, dist);
    if (desired.y < this.target.y - 1.2) desired.y = this.target.y - 1.2;
    if (!this.initialized) { this.cur.copy(desired); this.initialized = true; }
    // frame-rate invariant damping; snap inward immediately when blocked (no clipping)
    const k = 1 - Math.exp(-dt * (hit ? 30 : 12));
    this.cur.lerp(desired, k);
    this.camera.position.copy(this.cur);
    this.camera.lookAt(this.target);
  }

  snap() { this.initialized = false; }
}
