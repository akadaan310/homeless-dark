// dark-physics/rapier: Rapier 3D WASM with an explicit fixed step independent of
// render FPS (60 Hz, bounded catch-up), collision groups, kinematic character
// controller and a raycast vehicle. Physics never decides admissibility: the
// MotionAndEventGrammar admits actions; Rapier realizes them.
import RAPIER from '@dimforge/rapier3d-compat';
import { Vec3, Quat, Mat4, type Geometry } from '@astro/core';

export type R = typeof RAPIER;

// Collision groups: membership << 16 | filter
export const GROUP = { STATIC: 0x0001, PLAYER: 0x0002, NPC: 0x0004, VEHICLE: 0x0008, CAMERA_BLOCK: 0x0010, TRIGGER: 0x0020 } as const;
export const groups = (member: number, filter: number) => (member << 16) | filter;

export class Physics {
  world!: RAPIER.World;
  R!: R;
  readonly step = 1 / 60;
  maxSubsteps = 4;
  private acc = 0;
  steps = 0;
  droppedTime = 0;
  stepMs = 0;

  async init(): Promise<void> {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.step;
  }

  /** Advance with a fixed timestep; returns interpolation alpha for rendering. */
  update(dt: number, beforeStep: (h: number) => void): number {
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    const t0 = performance.now();
    while (this.acc >= this.step && n < this.maxSubsteps) {
      beforeStep(this.step);
      this.world.step();
      this.acc -= this.step;
      this.steps++;
      n++;
    }
    if (n === this.maxSubsteps && this.acc > this.step) { this.droppedTime += this.acc; this.acc = 0; }
    this.stepMs = performance.now() - t0;
    return this.acc / this.step;
  }

  fixedTrimesh(g: Geometry, matrix?: Mat4, member: number = GROUP.STATIC | GROUP.CAMERA_BLOCK): RAPIER.Collider {
    const pos = g.getAttribute('position');
    const v = new Float32Array(pos.count * 3);
    const tmp = new Vec3();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i);
      if (matrix) tmp.applyMatrix4(matrix);
      v[i * 3] = tmp.x; v[i * 3 + 1] = tmp.y; v[i * 3 + 2] = tmp.z;
    }
    const idx = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const desc = this.R.ColliderDesc.trimesh(v, idx).setCollisionGroups(groups(member, 0xffff));
    return this.world.createCollider(desc);
  }

  fixedBox(center: Vec3, half: Vec3, rotY = 0, member: number = GROUP.STATIC | GROUP.CAMERA_BLOCK): RAPIER.Collider {
    const q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), rotY);
    const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setRotation(q).setCollisionGroups(groups(member, 0xffff));
    return this.world.createCollider(desc);
  }

  /** Cast a ray; returns hit distance or null. Excludes a collider (e.g. the player's own). */
  ray(origin: Vec3, dir: Vec3, maxToi: number, mask = 0xffff, exclude?: RAPIER.Collider): { toi: number; collider: RAPIER.Collider } | null {
    const ray = new this.R.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, maxToi, true, undefined, groups(0xffff, mask), exclude, undefined);
    return hit ? { toi: hit.timeOfImpact, collider: hit.collider } : null;
  }
}

export interface CharacterOpts { radius: number; halfHeight: number; member: number }

/** Kinematic capsule character driven by the KinematicCharacterController. */
export class Character {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  ctrl: RAPIER.KinematicCharacterController;
  vy = 0;
  grounded = false;
  readonly opts: CharacterOpts;

  constructor(private p: Physics, pos: Vec3, opts: Partial<CharacterOpts> = {}) {
    this.opts = { radius: 0.3, halfHeight: 0.55, member: GROUP.PLAYER, ...opts };
    const R = p.R;
    this.body = p.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + this.opts.halfHeight + this.opts.radius, pos.z));
    this.collider = p.world.createCollider(
      R.ColliderDesc.capsule(this.opts.halfHeight, this.opts.radius).setCollisionGroups(groups(this.opts.member, GROUP.STATIC | GROUP.VEHICLE | GROUP.NPC | GROUP.PLAYER)),
      this.body,
    );
    this.ctrl = p.world.createCharacterController(0.02);
    this.ctrl.enableAutostep(0.32, 0.15, false);
    this.ctrl.enableSnapToGround(0.35);
    this.ctrl.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.ctrl.setSlideEnabled(true);
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
  }

  /** Move by a horizontal velocity (m/s) for one fixed step; gravity integrated here. */
  move(vx: number, vz: number, h: number, jump = false): void {
    if (this.grounded && jump) this.vy = 4.6;
    this.vy = this.grounded && this.vy < 0 ? -1 : this.vy - 9.81 * h;
    this.ctrl.computeColliderMovement(this.collider, { x: vx * h, y: this.vy * h, z: vz * h }, this.p.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.ctrl.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.grounded = this.ctrl.computedGrounded();
    if (this.grounded && this.vy < 0) this.vy = 0;
    if (t.y < -60) this.teleport(new Vec3(t.x, 5, t.z)); // safety: never fall forever
  }

  feet(out = new Vec3()): Vec3 {
    const t = this.body.translation();
    return out.set(t.x, t.y - this.opts.halfHeight - this.opts.radius, t.z);
  }

  teleport(p: Vec3): void {
    this.body.setTranslation({ x: p.x, y: p.y + this.opts.halfHeight + this.opts.radius, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + this.opts.halfHeight + this.opts.radius, z: p.z });
    this.vy = 0;
  }

  setEnabled(on: boolean) { this.collider.setEnabled(on); }

  dispose(): void {
    this.p.world.removeCharacterController(this.ctrl);
    this.p.world.removeRigidBody(this.body);
  }
}

export interface VehicleSpec { mass: number; halfExtents: Vec3; wheelRadius: number; wheelbase: number; track: number; comY: number; maxEngine: number; maxBrake: number; maxSteer: number }

/** Raycast vehicle on a dynamic chassis (Rapier DynamicRayCastVehicleController). */
export class Vehicle {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  ctrl: RAPIER.DynamicRayCastVehicleController;
  steer = 0;

  constructor(private p: Physics, pos: Vec3, yaw: number, readonly spec: VehicleSpec) {
    const R = p.R;
    const q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), yaw);
    this.body = p.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + spec.halfExtents.y + 0.45, pos.z).setRotation(q).setLinearDamping(0.08).setAngularDamping(0.8).setCanSleep(true));
    this.collider = p.world.createCollider(
      R.ColliderDesc.cuboid(spec.halfExtents.x, spec.halfExtents.y, spec.halfExtents.z).setTranslation(0, spec.comY, 0).setMass(spec.mass)
        .setCollisionGroups(groups(GROUP.VEHICLE | GROUP.CAMERA_BLOCK, GROUP.STATIC | GROUP.PLAYER | GROUP.NPC | GROUP.VEHICLE)).setFriction(0.6),
      this.body,
    );
    this.ctrl = p.world.createVehicleController(this.body);
    // chassis convention: front = −Z (Rapier defaults to X-forward; the setter is named setIndexForwardAxis)
    this.ctrl.setIndexForwardAxis = 2;
    this.ctrl.indexUpAxis = 1;
    const hx = spec.track / 2, hz = spec.wheelbase / 2;
    const y = -spec.halfExtents.y + 0.12;
    // wheel order: FL, FR, RL, RR (front = -Z local)
    for (const [x, z] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]] as const) {
      this.ctrl.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.32, spec.wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.ctrl.setWheelSuspensionStiffness(i, 28);
      this.ctrl.setWheelMaxSuspensionTravel(i, 0.25);
      this.ctrl.setWheelSuspensionCompression(i, 2.4);
      this.ctrl.setWheelSuspensionRelaxation(i, 3.2);
      this.ctrl.setWheelFrictionSlip(i, 2.6);
      this.ctrl.setWheelSideFrictionStiffness(i, 1.2);
    }
  }

  drive(throttle: number, brake: number, steerInput: number, h: number): void {
    this.body.wakeUp();
    const speed = this.ctrl.currentVehicleSpeed();
    const target = steerInput * this.spec.maxSteer * (1 / (1 + Math.abs(speed) * 0.05));
    this.steer += (target - this.steer) * Math.min(1, h * 6);
    const engine = throttle * this.spec.maxEngine;
    for (const i of [0, 1]) this.ctrl.setWheelSteering(i, this.steer);
    for (const i of [2, 3]) this.ctrl.setWheelEngineForce(i, -engine);
    for (let i = 0; i < 4; i++) this.ctrl.setWheelBrake(i, brake * this.spec.maxBrake);
    this.ctrl.updateVehicle(h, this.p.R.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, GROUP.STATIC));
  }

  /** Tyre–road friction from the material law (μ / μ_dry_asphalt scales the wheel friction slip). */
  frictionScale = 1;
  setFrictionScale(k: number) { if (Math.abs(k - this.frictionScale) < 0.01) return; this.frictionScale = k; for (let i = 0; i < 4; i++) this.ctrl.setWheelFrictionSlip(i, 2.6 * k); }
  speed(): number { return this.ctrl.currentVehicleSpeed(); }
  wheelRotation(i: number): number { return this.ctrl.wheelRotation(i) ?? 0; }
  wheelSuspension(i: number): number { return this.ctrl.wheelSuspensionLength(i) ?? 0.3; }

  park(): void { for (let i = 0; i < 4; i++) { this.ctrl.setWheelEngineForce(i, 0); this.ctrl.setWheelBrake(i, this.spec.maxBrake * 0.4); } }

  transform(pos: Vec3, quat: Quat): void {
    const t = this.body.translation(), r = this.body.rotation();
    pos.set(t.x, t.y, t.z);
    quat.set(r.x, r.y, r.z, r.w);
  }

  reset(pos: Vec3, yaw: number): void {
    const q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y + 1.2, z: pos.z }, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
