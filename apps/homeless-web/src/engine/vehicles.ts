// Vehicles: the original CC0 CivicSedan as a drivable Rapier raycast vehicle with
// hinged doors, wheel pivots, seats, headlights and wet clear-coat paint; plus
// traffic on the sourced Dale Mabry carriageways (kinematic, signal-aware).
import { Group, Node, Mesh, Material, SpotLight, Vec3, Quat, Box3 } from '@astro/core';
import type RAPIER from '@dimforge/rapier3d-compat';
import { loadGLB } from './assets';
import { consolidate, along, polylineLength, toXZ, type P2 } from './geom';
import { Physics, Vehicle, GROUP, groups } from './physics';
import { weather } from './materials';

export interface CarRig {
  root: Group; // world-space transform target
  body: Node; // model (front = −Z)
  wheels: Group[]; // FL, FR, RL, RR pivots
  doors: Record<'LF' | 'RF' | 'LR' | 'RR', { pivot: Group; open: number; target: number; sign: number }>;
  seats: Record<'driver' | 'passenger' | 'rearL' | 'rearR', Vec3>; // local
  doorPoints: Record<'driver' | 'passenger', Vec3>; // local, outside the door
  lights: { head: SpotLight[]; headMat: Material[]; tailMat: Material[] };
  paint: Material;
  size: Vec3;
  wheelRadius: number;
}

const DOOR_KEYS = { LF: 'LeftFrontDoor', RF: 'RightFrontDoor', LR: 'LeftRearDoor', RR: 'RightRearDoor' } as const;
const WHEEL_KEYS = ['LeftFrontWheel', 'RightFrontWheel', 'LeftRearWheel', 'RightRearWheel'];

export async function makeCarRig(paintHex: number, withLights: boolean, lod = false): Promise<CarRig> {
  const g = await loadGLB(lod ? 'sedan-lod' : 'sedan');
  const src = g.scene.clone(true);
  src.updateMatrixWorld(true);
  // orientation: front must be −Z (physics convention). The bonnet tells us where the front is.
  const bonnet = src.getObjectByName('SculptedBonnet');
  const bb = new Box3().setFromObject(src);
  const center = bb.getCenter(new Vec3());
  const front = bonnet ? new Box3().setFromObject(bonnet).getCenter(new Vec3()).z - center.z : -1;
  // traffic (lod) merges everything into a handful of draw calls; the player's car keeps doors and wheels articulated
  const keep = (o: Node) => !lod && ((WHEEL_KEYS as string[]).includes(o.name) || Object.values(DOOR_KEYS).includes(o.name as never));
  const body = consolidate(src, keep);
  const holder = new Group();
  holder.add(body);
  body.position.set(-center.x, -bb.min.y, -center.z);
  if (front > 0) holder.rotation.y = Math.PI;
  holder.updateMatrixWorld(true);
  const size = bb.getSize(new Vec3());
  // materials: clear-coat paint whose roughness follows the wetness field; emissive lamps
  let paint: Material | null = null;
  const headMat: Material[] = [], tailMat: Material[] = [];
  holder.traverse((m) => {
    if (!(m instanceof Mesh)) return;
    const mat = m.material;
    if (mat.name === 'MidnightBluePearl') {
      paint ??= new Material({ color: paintHex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, name: 'paint', side: mat.side });
      m.material = paint;
    } else if (mat.name === 'AutomotiveGlass') {
      const gm = mat.clone(); gm.transparent = true; gm.opacity = 0.35; gm.roughness = 0.03; gm.depthWrite = false; m.material = gm; m.castShadow = false;
    } else if (mat.name === 'HeadlampLens') {
      const hm = new Material({ color: 0xdfe6ee, roughness: 0.1, emissive: 0xfff3dc, emissiveIntensity: 0, side: mat.side, name: 'headlamp' }); m.material = hm; headMat.push(hm);
    } else if (mat.name === 'TailLampLens') {
      const tm = new Material({ color: 0x5a0a0a, roughness: 0.2, emissive: 0xff2010, emissiveIntensity: 0, side: mat.side, name: 'taillamp' }); m.material = tm; tailMat.push(tm);
    }
  });
  // wheel pivots at wheel bbox centres, door pivots at the front hinge edge
  const root = new Group();
  root.add(holder);
  root.updateMatrixWorld(true);
  const wheels: Group[] = [];
  let wheelRadius = 0.335;
  for (const name of WHEEL_KEYS) {
    const node = holder.getObjectByName(name);
    const pivot = new Group();
    pivot.name = `${name}-pivot`;
    if (node) {
      const wb = new Box3().setFromObject(node);
      wheelRadius = wb.getSize(new Vec3()).y / 2;
      pivot.position.copy(wb.getCenter(new Vec3()));
      root.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(node);
    } else root.add(pivot);
    wheels.push(pivot);
  }
  const doors = {} as CarRig['doors'];
  // Source door names follow the modelling tool's mirror convention; resolve driver/passenger by geometry:
  // LF/LR always mean the car's left (−X, driver side in left-hand-drive markets).
  const sideOf = (name: string) => { const n = holder.getObjectByName(name); return n ? new Box3().setFromObject(n).getCenter(new Vec3()).x : 0; };
  const swap = sideOf(DOOR_KEYS.LF) > 0;
  const resolved: Record<keyof typeof DOOR_KEYS, string> = swap ? { LF: DOOR_KEYS.RF, RF: DOOR_KEYS.LF, LR: DOOR_KEYS.RR, RR: DOOR_KEYS.LR } : { ...DOOR_KEYS };
  for (const [k, name] of Object.entries(resolved) as [keyof typeof DOOR_KEYS, string][]) {
    const node = holder.getObjectByName(name);
    const pivot = new Group();
    const left = k === 'LF' || k === 'LR';
    if (node) {
      const db = new Box3().setFromObject(node);
      pivot.position.set(left ? db.min.x : db.max.x, (db.min.y + db.max.y) / 2, db.min.z); // front edge (−Z) hinge
      root.add(pivot); pivot.updateMatrixWorld(true); pivot.attach(node);
    } else root.add(pivot);
    doors[k] = { pivot, open: 0, target: 0, sign: left ? -1 : 1 };
  }
  const hw = size.x / 2;
  const seats = {
    driver: new Vec3(-hw * 0.42, 0.32, 0.25), passenger: new Vec3(hw * 0.42, 0.32, 0.25),
    rearL: new Vec3(-hw * 0.42, 0.34, 1.15), rearR: new Vec3(hw * 0.42, 0.34, 1.15),
  };
  const doorPoints = { driver: new Vec3(-hw - 0.75, 0, 0.1), passenger: new Vec3(hw + 0.75, 0, 0.1) };
  const head: SpotLight[] = [];
  if (withLights) {
    for (const x of [-hw * 0.62, hw * 0.62]) {
      const s = new SpotLight(0xfff1d8, 0, 45, 0.42, 0.45, 1.6);
      s.position.set(x, 0.72, -size.z / 2 + 0.2);
      s.target.position.set(x * 1.2, 0, -size.z / 2 - 18);
      root.add(s, s.target);
      head.push(s);
    }
  }
  return { root, body: holder, wheels, doors, seats, doorPoints, lights: { head, headMat, tailMat }, paint: paint ?? new Material({ name: 'paint-missing' }), size, wheelRadius };
}

export function updateCarVisual(rig: CarRig, dt: number, opts: { lights: number; brake: boolean; steer: number; spin: number[]; susp?: number[] }) {
  for (const d of Object.values(rig.doors)) {
    d.open += (d.target - d.open) * (1 - Math.exp(-dt * 6));
    d.pivot.rotation.y = d.sign * -d.open * 1.15;
  }
  rig.wheels.forEach((w, i) => {
    w.rotation.order = 'YXZ';
    w.rotation.y = i < 2 ? opts.steer : 0;
    w.rotation.x = opts.spin[i] ?? 0;
  });
  for (const m of rig.lights.headMat) m.emissiveIntensity = opts.lights * 6;
  for (const m of rig.lights.tailMat) m.emissiveIntensity = opts.lights * 2.5 + (opts.brake ? 5 : 0);
  for (const s of rig.lights.head) s.intensity = opts.lights * 220;
  // wet clear coat: water film lowers base roughness, beads keep clearcoat sharp
  rig.paint.roughness = 0.32 * (1 - 0.6 * weather.uWetness.value);
}

// ---------------------------------------------------------------- player car
export class PlayerCar {
  vehicle: Vehicle;
  rig!: CarRig;
  occupants = new Map<string, keyof CarRig['seats']>();
  private pos = new Vec3();
  private quat = new Quat();
  engineOn = false;
  throttle = 0;
  braking = false;

  private constructor(private phys: Physics, spawn: Vec3, yaw: number) {
    this.vehicle = new Vehicle(phys, spawn, yaw, {
      mass: 1350, halfExtents: new Vec3(0.9, 0.42, 2.2), wheelRadius: 0.335, wheelbase: 2.86, track: 1.56, comY: 0.05,
      maxEngine: 2600, maxBrake: 45, maxSteer: 0.55,
    });
  }

  static async create(phys: Physics, scene: Node, spawn: Vec3, yaw: number): Promise<PlayerCar> {
    const c = new PlayerCar(phys, spawn, yaw);
    c.rig = await makeCarRig(0x1d3557, true);
    scene.add(c.rig.root);
    c.vehicle.park();
    return c;
  }

  get collider(): RAPIER.Collider { return this.vehicle.collider; }

  update(dt: number, lights: number) {
    this.vehicle.transform(this.pos, this.quat);
    // model base = chassis centre − (wheel mount depth + current suspension length + wheel radius)
    const up = new Vec3(0, 1, 0).applyQuaternion(this.quat);
    const susp = [0, 1, 2, 3].reduce((a, i) => a + this.vehicle.wheelSuspension(i), 0) / 4;
    this.rig.root.position.copy(this.pos).addScaledVector(up, -(0.42 - 0.12) - susp - 0.335);
    this.rig.root.quaternion.copy(this.quat);
    const spin = [0, 1, 2, 3].map((i) => this.vehicle.wheelRotation(i));
    updateCarVisual(this.rig, dt, { lights, brake: this.braking, steer: this.vehicle.steer, spin });
  }

  worldPoint(local: Vec3): Vec3 { return local.clone().applyMatrix4(this.rig.root.matrixWorld); }
  /** Camera yaw that places the camera behind the car. */
  heading(): number { const f = new Vec3(0, 0, -1).applyQuaternion(this.quat); return Math.atan2(-f.x, -f.z); }
  /** Signed speed along the car's nose (Rapier reports speed along +Z; the nose is −Z). */
  speed(): number { return -this.vehicle.speed(); }
  position(): Vec3 { return this.pos; }
}

// ---------------------------------------------------------------- traffic
export interface TrafficLane { pts: P2[]; dir: 1 | -1; name: string }

interface TrafficCar { lane: number; s: number; speed: number; rig: CarRig; body: RAPIER.RigidBody; len: number }

export class Traffic {
  cars: TrafficCar[] = [];
  private lanes: { pts: P2[]; L: number; stopS: number[] }[] = [];
  signalNS: 'green' | 'yellow' | 'red' = 'green';
  private t = 0;

  constructor(private phys: Physics, private scene: Node) {}

  async init(lanes: TrafficLane[], count: number) {
    this.lanes = lanes.map((l) => {
      const L = polylineLength(l.pts);
      // stop line: just before the anchor junction (n = ∓12 depending on direction)
      const stopS: number[] = [];
      let s = 0;
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1]!, b = l.pts[i]!, seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const target = l.dir === 1 ? -12 : 12;
        if ((a[1] - target) * (b[1] - target) <= 0 && seg > 0) stopS.push(s + (seg * (target - a[1])) / (b[1] - a[1]));
        s += seg;
      }
      return { pts: l.pts, L, stopS };
    });
    const colors = [0x8c1c13, 0xdedede, 0x2b2d42, 0x6c757d, 0xe9c46a, 0x264653, 0x9b2226, 0x3a5a40];
    for (let i = 0; i < count; i++) {
      const lane = i % this.lanes.length;
      const rig = await makeCarRig(colors[i % colors.length]!, false, true);
      this.scene.add(rig.root);
      const body = this.phys.world.createRigidBody(this.phys.R.RigidBodyDesc.kinematicPositionBased());
      this.phys.world.createCollider(this.phys.R.ColliderDesc.cuboid(0.9, 0.7, 2.25).setTranslation(0, 0.75, 0).setCollisionGroups(groups(GROUP.VEHICLE | GROUP.CAMERA_BLOCK, GROUP.PLAYER | GROUP.NPC | GROUP.VEHICLE)), body);
      const L = this.lanes[lane]!.L;
      this.cars.push({ lane, s: ((i * 0.37) % 1) * L, speed: 10, rig, body, len: 4.6 });
    }
  }

  /** Signal cycle: 26 s green, 4 s yellow, 22 s red for the N–S highway. */
  signal(t: number): 'green' | 'yellow' | 'red' {
    const c = t % 52;
    return c < 26 ? 'green' : c < 30 ? 'yellow' : 'red';
  }

  update(dt: number, lights: number, obstacles: Vec3[]) {
    this.t += dt;
    this.signalNS = this.signal(this.t);
    for (const car of this.cars) {
      const lane = this.lanes[car.lane]!;
      let limit = 13.4; // ~30 mph
      // gap keeping to the car ahead in the same lane
      for (const o of this.cars) {
        if (o === car || o.lane !== car.lane) continue;
        let gap = o.s - car.s; if (gap < 0) gap += lane.L;
        if (gap < 30) limit = Math.min(limit, Math.max(0, (gap - 8) * 0.9));
      }
      if (this.signalNS !== 'green') for (const s of lane.stopS) {
        const d = s - car.s;
        if (d > 0 && d < 45) limit = Math.min(limit, Math.max(0, (d - 3) * 0.6));
      }
      const here = along(lane.pts, car.s / lane.L);
      const [x, z] = toXZ(here.p);
      const fwd = new Vec3(here.dir[0], 0, -here.dir[1]);
      for (const ob of obstacles) {
        const rel = new Vec3(ob.x - x, 0, ob.z - z);
        const ahead = rel.dot(fwd), lateral = Math.abs(rel.clone().addScaledVector(fwd, -ahead).length());
        if (ahead > 0 && ahead < 18 && lateral < 2.2) limit = Math.min(limit, Math.max(0, (ahead - 5) * 0.8));
      }
      car.speed += Math.max(-7 * dt, Math.min(2.5 * dt, limit - car.speed));
      car.s = (car.s + car.speed * dt) % lane.L;
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      car.rig.root.position.set(x, 0.03, z);
      car.rig.root.rotation.set(0, yaw, 0);
      const q = car.rig.root.quaternion;
      car.body.setNextKinematicTranslation({ x, y: 0.03, z });
      car.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      const spin = (car.s / car.rig.wheelRadius) % (Math.PI * 2);
      updateCarVisual(car.rig, dt, { lights, brake: car.speed < 2 && limit < 1, steer: 0, spin: [-spin, -spin, -spin, -spin] });
    }
  }
}
