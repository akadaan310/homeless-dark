// Humans: MakeHuman CC0 masters rigged in this repository with clips Idle, WalkInPlace,
// JogInPlace, Talk, Listen, Wave, Seated and EnterVehicle. Each instance is a
// SkeletonUtils clone with its own mixer. The rig's rest pose is an A-pose; an authored
// post-mixer correction lowers the upper arms (world-space rotation about the body's
// forward axis) so the clips read as natural standing posture.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLB } from './assets';

export type Pose = 'idle' | 'walk' | 'run' | 'talk' | 'listen' | 'wave' | 'seated' | 'enter';
type ClipKey = 'idle' | 'walk' | 'run' | 'talk' | 'listen' | 'wave' | 'seated' | 'enter';

export interface Human {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<ClipKey, THREE.AnimationAction>;
  pose: Pose;
  speed: number;
  phase: number;
  armRelax: number;
  setPose(p: Pose, speed?: number): void;
  update(dt: number): { stepped: boolean };
}

const CLIPS: Record<ClipKey, string> = { idle: 'Idle', walk: 'WalkInPlace', run: 'JogInPlace', talk: 'Talk', listen: 'Listen', wave: 'Wave', seated: 'Seated', enter: 'EnterVehicle' };

export async function makeHuman(variant: 'citizen' | 'citizen-alt' | 'citizen-lod' | 'citizen-alt-lod', tint?: THREE.ColorRepresentation): Promise<Human> {
  const g = await loadGLB(variant);
  const model = skeletonClone(g.scene);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    if (tint !== undefined && m.name.toLowerCase().includes('outfit')) {
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color = new THREE.Color(tint);
      m.material = mat;
    }
  });
  const root = new THREE.Group();
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const find = (name: string) => g.animations.find((c) => c.name.endsWith(`|${name}`) || c.name === name);
  const actions = {} as Record<ClipKey, THREE.AnimationAction>;
  for (const [k, name] of Object.entries(CLIPS) as [ClipKey, string][]) {
    const clip = find(name) ?? find('Idle') ?? g.animations[0]!;
    const a = mixer.clipAction(clip);
    a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
    actions[k] = a;
  }
  actions.enter.setLoop(THREE.LoopOnce, 1); actions.enter.clampWhenFinished = true;
  const bones: Record<string, THREE.Bone> = {};
  model.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
  const armL = bones['upperarm01.L'], armR = bones['upperarm01.R'];
  const walkDur = actions.walk.getClip().duration || 1;
  const runDur = actions.run.getClip().duration || 1;
  const qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), qr = new THREE.Quaternion(), axis = new THREE.Vector3();

  const relax = (bone: THREE.Bone | undefined, angle: number) => {
    if (!bone || !bone.parent) return;
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
  };
  return h;
}
