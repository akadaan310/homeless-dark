// Humans: MakeHuman CC0 masters rigged in this repository with clips Idle, WalkInPlace,
// JogInPlace, Talk, Listen, Wave, Seated and EnterVehicle. Each instance is a
// skeleton-aware ASTRO clone (skins rebound to cloned bones) with its own mixer. The rig's rest pose is an A-pose; an authored
// post-mixer correction lowers the upper arms (world-space rotation about the body's
// forward axis) so the clips read as natural standing posture.
import { Group, Mesh, Node, Quat, Vec3, Color, type ColorLike } from '@astro/core';
import { Mixer, type Action } from '@astro/geometry';
import { loadGLB } from './assets';

export type Pose = 'idle' | 'walk' | 'run' | 'talk' | 'listen' | 'wave' | 'seated' | 'enter';
type ClipKey = 'idle' | 'walk' | 'run' | 'talk' | 'listen' | 'wave' | 'seated' | 'enter';

export interface Human {
  root: Group;
  model: Node;
  mixer: Mixer;
  actions: Record<ClipKey, Action>;
  pose: Pose;
  speed: number;
  phase: number;
  armRelax: number;
  setPose(p: Pose, speed?: number): void;
  update(dt: number): { stepped: boolean };
  /** Sole contact discs from the actual foot/toe bones (world space; call after update). */
  soles(): { x: number; y: number; z: number; planted: boolean }[];
}

const CLIPS: Record<ClipKey, string> = { idle: 'Idle', walk: 'WalkInPlace', run: 'JogInPlace', talk: 'Talk', listen: 'Listen', wave: 'Wave', seated: 'Seated', enter: 'EnterVehicle' };

export async function makeHuman(variant: 'citizen' | 'citizen-alt' | 'citizen-lod' | 'citizen-alt-lod', tint?: ColorLike): Promise<Human> {
  const g = await loadGLB(variant);
  const model = g.scene.clone();
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    if (tint !== undefined && o.name.toLowerCase().includes('outfit')) {
      const mat = o.material.clone();
      mat.color = tint instanceof Color ? tint.clone() : new Color().setHex(tint);
      o.material = mat;
    }
  });
  const root = new Group();
  root.add(model);
  const mixer = new Mixer(model);
  const find = (name: string) => g.clips.find((c) => c.name.endsWith(`|${name}`) || c.name === name);
  const actions = {} as Record<ClipKey, Action>;
  for (const [k, name] of Object.entries(CLIPS) as [ClipKey, string][]) {
    const clip = find(name) ?? find('Idle') ?? g.clips[0]!;
    const a = mixer.clipAction(clip);
    a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
    actions[k] = a;
  }
  actions.enter.setLoop('once'); actions.enter.clampWhenFinished = true;
  const bones: Record<string, Node> = {};
  model.traverse((o) => { if (o.name) bones[o.name] ??= o; });
  const armL = bones['upperarm01.L'], armR = bones['upperarm01.R'];
  const feetB = [[bones['foot.L'], bones['toe2-1.L']], [bones['foot.R'], bones['toe2-1.R']]] as const;
  const tmpA = new Vec3(), tmpB = new Vec3();
  const walkDur = actions.walk.getClip().duration || 1;
  const runDur = actions.run.getClip().duration || 1;
  const qa = new Quat(), qp = new Quat(), qr = new Quat(), axis = new Vec3();

  // bones no clip animates keep their bind rotation as the base the correction is applied to each frame
  const armBase = new Map<Node, Quat>();
  for (const b of [armL, armR]) if (b) armBase.set(b, b.quaternion.clone());
  const relax = (bone: Node | undefined, angle: number) => {
    if (!bone || !bone.parent) return;
    if (!mixer.isBound(bone)) bone.quaternion.copy(armBase.get(bone)!);
    root.getWorldQuaternion(qr);
    axis.set(0, 0, 1).applyQuaternion(qr); // body forward in world
    qa.setFromAxisAngle(axis, angle);
    bone.parent.getWorldQuaternion(qp);
    // local' = parentWorld⁻¹ · R_world · parentWorld · local
    const inv = qp.clone().invert();
    bone.quaternion.premultiply(qp).premultiply(qa).premultiply(inv);
  };

  const h: Human = {
    root, model, mixer, actions, pose: 'idle', speed: 0, phase: 0, armRelax: 0.62,
    setPose(p, speed = 0) {
      if (p === 'enter' && h.pose !== 'enter') actions.enter.reset().play();
      h.pose = p; h.speed = speed;
    },
    update(dt) {
      const target: Record<ClipKey, number> = { idle: 0, walk: 0, run: 0, talk: 0, listen: 0, wave: 0, seated: 0, enter: 0 };
      target[h.pose] = 1;
      const k = 1 - Math.exp(-dt * 9);
      for (const key of Object.keys(actions) as ClipKey[]) {
        const a = actions[key];
        a.setEffectiveWeight(a.getEffectiveWeight() + (target[key] - a.getEffectiveWeight()) * k);
      }
      let stepped = false;
      if (h.pose === 'walk' || h.pose === 'run') {
        // stride ≈ 1.45 m per walk cycle, ≈ 2.4 m per jog cycle: cadence follows ground speed (foot-slip control)
        const stride = h.pose === 'run' ? 2.4 : 1.45;
        const cps = Math.max(0.4, h.speed / stride);
        actions.walk.timeScale = cps * walkDur;
        actions.run.timeScale = cps * runDur;
        const prev = h.phase;
        h.phase += dt * cps;
        stepped = Math.floor(prev * 2) !== Math.floor(h.phase * 2);
      }
      mixer.update(dt);
      root.updateMatrixWorld(true);
      const relaxAmt = h.pose === 'seated' ? h.armRelax * 0.4 : h.pose === 'wave' ? h.armRelax * 0.5 : h.armRelax;
      relax(armL, -relaxAmt);
      relax(armR, relaxAmt);
      return { stepped };
    },
    soles() {
      const out: { x: number; y: number; z: number; planted: boolean }[] = [];
      const ground = root.position.y;
      for (const [ankle, toe] of feetB) {
        if (!ankle || !toe) continue;
        ankle.getWorldPosition(tmpA); toe.getWorldPosition(tmpB);
        // sole centre ≈ between ankle and toe base, on the ground; planted when the sole is within 6 cm of it
        const sy = Math.min(tmpA.y - 0.07, tmpB.y - 0.02);
        out.push({ x: (tmpA.x + tmpB.x) / 2, y: sy, z: (tmpA.z + tmpB.z) / 2, planted: sy - ground < 0.06 });
      }
      return out;
    },
  };
  return h;
}
