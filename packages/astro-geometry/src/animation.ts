// Keyframe animation and weighted blending for ASTRO skeletons.
// Tracks bind by node NAME so a clip applies to any skeleton clone.
import { Node, Quat, Vec3 } from '@astro/core';

export interface Track { nodeName: string; path: 'translation' | 'rotation' | 'scale'; times: Float32Array; values: Float32Array; interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE' }

export class Clip {
  readonly duration: number;
  constructor(readonly name: string, readonly tracks: Track[]) {
    this.duration = Math.max(0, ...tracks.map((t) => t.times[t.times.length - 1] ?? 0));
  }
}

function sampleTrack(t: Track, time: number, out: number[]): void {
  const n = t.path === 'rotation' ? 4 : 3;
  const times = t.times, last = times.length - 1;
  const cs = t.interpolation === 'CUBICSPLINE';
  const stride = cs ? n * 3 : n, off = cs ? n : 0; // cubic: in-tangent, value, out-tangent
  if (last < 0) return;
  if (time <= times[0]!) { for (let k = 0; k < n; k++) out[k] = t.values[off + k]!; return; }
  if (time >= times[last]!) { for (let k = 0; k < n; k++) out[k] = t.values[last * stride + off + k]!; return; }
  let i = 0;
  let lo = 0, hi = last;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid]! <= time) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  const t0 = times[i]!, t1 = times[i + 1]!, dt = t1 - t0, u = dt > 0 ? (time - t0) / dt : 0;
  if (t.interpolation === 'STEP') { for (let k = 0; k < n; k++) out[k] = t.values[i * stride + k]!; return; }
  if (cs) {
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    for (let k = 0; k < n; k++) {
      const p0 = t.values[i * stride + n + k]!, m0 = t.values[i * stride + 2 * n + k]! * dt, p1 = t.values[(i + 1) * stride + n + k]!, m1 = t.values[(i + 1) * stride + k]! * dt;
      out[k] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
    }
  } else if (n === 4) {
    const a = new Quat().fromArray(t.values, i * 4), b = new Quat().fromArray(t.values, (i + 1) * 4);
    a.slerp(b, u); out[0] = a.x; out[1] = a.y; out[2] = a.z; out[3] = a.w; return;
  } else for (let k = 0; k < n; k++) out[k] = t.values[i * n + k]! * (1 - u) + t.values[(i + 1) * n + k]! * u;
  if (n === 4) { const l = Math.hypot(out[0]!, out[1]!, out[2]!, out[3]!) || 1; for (let k = 0; k < 4; k++) out[k] = out[k]! / l; }
}

export class Action {
  time = 0;
  timeScale = 1;
  weight = 0;
  paused = false;
  loop: 'repeat' | 'once' = 'repeat';
  clampWhenFinished = false;
  enabled = true;
  constructor(readonly clip: Clip) {}
  play() { this.enabled = true; return this; }
  reset() { this.time = 0; this.paused = false; this.enabled = true; return this; }
  setEffectiveWeight(w: number) { this.weight = w; return this; }
  getEffectiveWeight() { return this.weight; }
  setLoop(mode: 'repeat' | 'once') { this.loop = mode; return this; }
  getClip() { return this.clip; }
  advance(dt: number) {
    if (this.paused || !this.enabled) return;
    this.time += dt * this.timeScale;
    const d = this.clip.duration || 1;
    if (this.loop === 'repeat') this.time = ((this.time % d) + d) % d;
    else if (this.time >= d) { this.time = d; if (!this.clampWhenFinished) this.enabled = false; }
  }
}

/** Weighted blend of all actions onto a node tree; unweighted remainder blends toward the rest pose. */
export class Mixer {
  readonly actions: Action[] = [];
  private nodes = new Map<string, Node>();
  private rest = new Map<Node, { p: Vec3; q: Quat; s: Vec3 }>();
  constructor(root: Node) {
    root.traverse((n) => { if (n.name && !this.nodes.has(n.name)) this.nodes.set(n.name, n); this.rest.set(n, { p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone() }); });
  }
  clipAction(c: Clip) { const a = new Action(c); this.actions.push(a); return a; }
  update(dt: number) {
    const acc = new Map<Node, { p: number[]; pw: number; q: number[]; qw: number; s: number[]; sw: number }>();
    const tmp = [0, 0, 0, 0];
    for (const a of this.actions) {
      a.advance(dt);
      if (!a.enabled || a.weight <= 1e-4) continue;
      for (const tr of a.clip.tracks) {
        const node = this.nodes.get(tr.nodeName);
        if (!node) continue;
        sampleTrack(tr, a.time, tmp);
        let e = acc.get(node);
        if (!e) { e = { p: [0, 0, 0], pw: 0, q: [0, 0, 0, 0], qw: 0, s: [0, 0, 0], sw: 0 }; acc.set(node, e); }
        const w = a.weight;
        if (tr.path === 'translation') { for (let k = 0; k < 3; k++) e.p[k]! += tmp[k]! * w; e.pw += w; }
        else if (tr.path === 'scale') { for (let k = 0; k < 3; k++) e.s[k]! += tmp[k]! * w; e.sw += w; }
        else {
          // hemisphere alignment before accumulation (nlerp blending)
          const sign = e.qw > 0 && e.q[0]! * tmp[0]! + e.q[1]! * tmp[1]! + e.q[2]! * tmp[2]! + e.q[3]! * tmp[3]! < 0 ? -1 : 1;
          for (let k = 0; k < 4; k++) e.q[k]! += tmp[k]! * w * sign; e.qw += w;
        }
      }
    }
    for (const [node, e] of acc) {
      const r = this.rest.get(node)!;
      if (e.pw > 0) { const rw = Math.max(0, 1 - e.pw); node.position.set((e.p[0]! + r.p.x * rw) / (e.pw + rw), (e.p[1]! + r.p.y * rw) / (e.pw + rw), (e.p[2]! + r.p.z * rw) / (e.pw + rw)); }
      if (e.sw > 0) { const rw = Math.max(0, 1 - e.sw); node.scale.set((e.s[0]! + r.s.x * rw) / (e.sw + rw), (e.s[1]! + r.s.y * rw) / (e.sw + rw), (e.s[2]! + r.s.z * rw) / (e.sw + rw)); }
      if (e.qw > 0) {
        const rw = Math.max(0, 1 - e.qw);
        const sign = e.q[0]! * r.q.x + e.q[1]! * r.q.y + e.q[2]! * r.q.z + e.q[3]! * r.q.w < 0 ? -1 : 1;
        node.quaternion.set(e.q[0]! + r.q.x * rw * sign, e.q[1]! + r.q.y * rw * sign, e.q[2]! + r.q.z * rw * sign, e.q[3]! + r.q.w * rw * sign).normalize();
      }
    }
  }
}
