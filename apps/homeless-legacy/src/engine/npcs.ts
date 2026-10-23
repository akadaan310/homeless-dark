// Living NPCs. Minds are @dark/core NpcMind (deterministic decide/respondToRide);
// bodies are Rapier kinematic capsules with MakeHuman models; speech uses the
// repository's English eSpeak NG lines with captions. Names and roles are fictional.
import * as THREE from 'three';
import { decide, respondToRide, remember, assignTiers, type NpcMind, type Tier } from '@dark/core';
import type { SpeechLine } from './audio';
import { makeHuman, type Human } from './characters';
import { Character, GROUP, type Physics } from './physics';
import { CAFE } from './tampa';

export type NpcState = 'walking' | 'idle' | 'talking' | 'sheltering' | 'boarding' | 'riding' | 'working';

export interface Agent {
  mind: NpcMind;
  human: Human;
  body: Character;
  state: NpcState;
  path: THREE.Vector3[];
  facing: number;
  tier: Tier;
  lastDecision: { activity: string; reason: string };
  speechCooldown: number;
  pedestrian?: { loop: THREE.Vector3[]; i: number };
  hiddenInVehicle: boolean;
}

/** Speech acts each fictional speaker can voice (recorded lines); others are caption-only. */
const ACT_LINES: Record<string, Record<string, string>> = {
  'npc:ana': { greeting: 'arrival-en-greeting', socialize: 'arrival-en-greeting', work: 'arrival-en-describe_work_work', decline_ride: 'arrival-en-decline_ride', refuse_ride: 'arrival-en-refuse_ride', continue_task: 'arrival-en-continue_task', rest: 'arrival-en-rest', pair: 'arrival-en-pair_coffee', back_to_work: 'arrival-en-work' },
  'npc:bo': { greeting: 'arrival-en-welcome_member', socialize: 'arrival-en-socialize', work: 'arrival-en-describe_work_talk', accept_ride: 'arrival-en-socialize', continue_task: 'arrival-en-pair_reply', pair: 'arrival-en-pair_reply', farewell: 'arrival-en-farewell', travel: 'arrival-en-server_offer_ride', offer_ride: 'arrival-en-offer_ride' },
};

// Authored places (three coordinates: x = east, z = −north)
export const PLACES: Record<string, THREE.Vector3> = {
  corner: new THREE.Vector3(-22.9, 0.15, -9.2),
  corner2: new THREE.Vector3(-23.3, 0.15, -10.6),
  awning: new THREE.Vector3(-22.6, 0.15, -26.5),
  awning2: new THREE.Vector3(-22.6, 0.15, -29.2),
  cafeDoorOut: new THREE.Vector3(CAFE.x1 + 1.3, 0.15, -CAFE.doorN),
  cafeDoorIn: new THREE.Vector3(CAFE.x1 - 1.3, 0.16, -CAFE.doorN),
  counterBehind: new THREE.Vector3(CAFE.x0 + 0.9, 0.16, -(CAFE.n0 + CAFE.n1) / 2 - 2.5),
  cafeSeat: new THREE.Vector3(CAFE.x0 + 5.2, 0.16, -CAFE.n1 + 3),
  home: new THREE.Vector3(-22.8, 0.15, -60),
};

export class NpcSystem {
  agents: Agent[] = [];
  lines = new Map<string, SpeechLine>();
  speak: ((a: Agent, act: string, line: SpeechLine | null, caption: string) => void) | null = null;
  private pairTimer = 6;

  constructor(private phys: Physics, private scene: THREE.Object3D) {}

  async init(lines: SpeechLine[], pedestrians: THREE.Vector3[][]) {
    for (const l of lines) this.lines.set(l.id, l);
    const ana: NpcMind = {
      id: 'npc:ana', name: 'Ana', role: 'courier', fictional: true, busyUntil: 0, memory: [], relationship: {},
      schedule: [{ from: 7, to: 15, activity: 'work', place: 'cafe' }, { from: 15, to: 21, activity: 'talk', place: 'corner' }, { from: 21, to: 7, activity: 'rest', place: 'home' }],
    };
    const bo: NpcMind = {
      id: 'npc:bo', name: 'Bo', role: 'neighbourhood regular', fictional: true, busyUntil: 0, memory: [], relationship: { player: 0.1 },
      schedule: [{ from: 6, to: 15, activity: 'coffee', place: 'cafe' }, { from: 15, to: 22, activity: 'talk', place: 'corner2' }, { from: 22, to: 6, activity: 'rest', place: 'home' }],
    };
    this.agents.push(await this.spawn(ana, 'citizen', 0xd9b8a0, PLACES.corner!));
    this.agents.push(await this.spawn(bo, 'citizen-alt', 0xa9c2cf, PLACES.corner2!));
    let i = 0;
    for (const loop of pedestrians) {
      const m: NpcMind = { id: `npc:walker-${i}`, name: `Walker ${i + 1}`, role: 'pedestrian', fictional: true, busyUntil: 0, memory: [], relationship: {}, schedule: [{ from: 0, to: 24, activity: 'walk', place: 'loop' }] };
      const a = await this.spawn(m, i % 2 ? 'citizen-lod' : 'citizen-alt-lod', [0xc9b79c, 0xb5c7a3, 0xd8a7a0, 0xa3b5d8][i % 4]!, loop[0]!);
      a.pedestrian = { loop, i: 1 };
      this.agents.push(a);
      i++;
    }
  }

  private async spawn(mind: NpcMind, model: 'citizen' | 'citizen-alt' | 'citizen-lod' | 'citizen-alt-lod', tint: number, at: THREE.Vector3): Promise<Agent> {
    const human = await makeHuman(model, tint);
    this.scene.add(human.root);
    const body = new Character(this.phys, at, { member: GROUP.NPC });
    return { mind, human, body, state: 'idle', path: [], facing: 0, tier: 'active', lastDecision: { activity: 'idle', reason: 'spawn' }, speechCooldown: 0, hiddenInVehicle: false };
  }

  get(id: string) { return this.agents.find((a) => a.mind.id === id); }

  lineFor(a: Agent, act: string): SpeechLine | null {
    const id = ACT_LINES[a.mind.id]?.[act];
    return id ? this.lines.get(id) ?? null : null;
  }

  say(a: Agent, act: string, fallbackCaption = '') {
    const line = this.lineFor(a, act);
    this.speak?.(a, act, line, line?.caption ?? fallbackCaption);
    a.speechCooldown = (line?.duration ?? 2) + 2;
  }

  /** Route through the café door when entering/leaving the interior. */
  routeTo(a: Agent, dest: THREE.Vector3, interior: THREE.Box3) {
    const p = a.body.feet();
    const inside = (v: THREE.Vector3) => v.x > interior.min.x && v.x < interior.max.x && v.z > interior.min.z && v.z < interior.max.z;
    const path: THREE.Vector3[] = [];
    if (inside(p) && !inside(dest)) path.push(PLACES.cafeDoorIn!.clone(), PLACES.cafeDoorOut!.clone());
    if (!inside(p) && inside(dest)) path.push(PLACES.cafeDoorOut!.clone(), PLACES.cafeDoorIn!.clone());
    path.push(dest.clone());
    a.path = path;
  }

  update(dt: number, h: number, ctx: { hour: number; worldTime: number; raining: boolean; player: THREE.Vector3; interior: THREE.Box3; tick: number }) {
    const tiers = assignTiers(this.agents.map((a) => { const f = a.body.feet(); return { id: a.mind.id, x: f.x, z: f.z, causallyRelevant: a.state === 'boarding' || a.state === 'riding' || !a.pedestrian }; }), ctx.player.x, ctx.player.z, { focusedRadius: 8, activeRadius: 90, cohortRadius: 300, maxActive: 10 });
    for (const a of this.agents) {
      a.tier = tiers.get(a.mind.id) ?? 'virtual';
      a.speechCooldown = Math.max(0, a.speechCooldown - dt);
      if (a.hiddenInVehicle) continue;
      const feet = a.body.feet();
      const dPlayer = feet.distanceTo(ctx.player);
      if (a.pedestrian) {
        if (a.tier === 'virtual') { a.human.root.visible = false; continue; }
        a.human.root.visible = true;
        const tgt = a.pedestrian.loop[a.pedestrian.i]!;
        if (feet.distanceTo(tgt) < 1.2) a.pedestrian.i = (a.pedestrian.i + 1) % a.pedestrian.loop.length;
        a.path = [tgt];
      } else if (a.state !== 'boarding' && a.state !== 'riding' && Math.floor(ctx.worldTime * 2) % 2 === 0) {
        const intent = decide(a.mind, { hour: ctx.hour, worldTime: ctx.worldTime, raining: ctx.raining, playerDistance: dPlayer, playerId: 'player' });
        a.lastDecision = { activity: intent.activity, reason: intent.reason };
        const place = intent.activity === 'shelter' ? (a.mind.id === 'npc:ana' ? 'awning' : 'awning2') : intent.activity === 'work' ? (a.mind.id === 'npc:ana' ? 'counterBehind' : 'cafeSeat') : intent.activity === 'coffee' ? 'cafeSeat' : intent.place;
        const dest = PLACES[place] ?? PLACES.home!;
        const last = a.path[a.path.length - 1];
        if (!last || last.distanceTo(dest) > 0.5) { if (feet.distanceTo(dest) > 0.8) this.routeTo(a, dest, ctx.interior); }
        a.state = intent.activity === 'shelter' ? 'sheltering' : intent.activity === 'talk' ? 'talking' : intent.activity === 'work' ? 'working' : 'idle';
        if (intent.speechAct === 'greeting' && a.speechCooldown <= 0 && !a.mind.memory.some((m) => m.fact === 'greeted player')) {
          this.say(a, 'greeting');
          a.mind = remember(a.mind, ctx.tick, 'greeted player', 'player', 0.05);
        }
      }
      // locomotion
      let vx = 0, vz = 0;
      const next = a.path[0];
      if (next) {
        const d = new THREE.Vector3(next.x - feet.x, 0, next.z - feet.z);
        const dist = d.length();
        if (dist < 0.45) a.path.shift();
        else {
          const sp = a.pedestrian ? 1.25 : a.state === 'boarding' ? 1.6 : 1.35;
          d.normalize().multiplyScalar(sp);
          vx = d.x; vz = d.z;
          a.facing = Math.atan2(d.x, d.z);
        }
      }
      a.body.move(vx, vz, h);
      const moving = Math.hypot(vx, vz) > 0.1;
      if (moving) a.human.setPose('walk', Math.hypot(vx, vz));
      else if (a.state === 'talking') a.human.setPose(a.speechCooldown > 0 ? 'talk' : 'listen');
      else a.human.setPose('idle');
      if (!moving && a.state === 'talking') {
        // face the conversation partner or the player when close
        const partner = this.agents.find((o) => o !== a && !o.pedestrian && o.state === 'talking');
        const look = dPlayer < 4 ? ctx.player : partner ? partner.body.feet() : null;
        if (look) a.facing = Math.atan2(look.x - feet.x, look.z - feet.z);
      }
    }
    // the pair's own conversation, audible only nearby (spatial + occluded by the café walls)
    this.pairTimer -= dt;
    const [ana, bo] = [this.get('npc:ana'), this.get('npc:bo')];
    if (this.pairTimer <= 0 && ana && bo && ana.state === 'talking' && bo.state === 'talking' && ana.body.feet().distanceTo(bo.body.feet()) < 3.5) {
      const speaker = Math.random() < 0.5 ? ana : bo;
      if (speaker.speechCooldown <= 0 && speaker.body.feet().distanceTo(ctx.player) < 30) this.say(speaker, ctx.raining ? 'pair' : 'pair');
      this.pairTimer = 9 + Math.random() * 6;
    }
  }

  /** Post-physics: copy capsule positions into the rendered models and advance animation. */
  render(dt: number, onStep: (a: Agent, pos: THREE.Vector3) => void) {
    for (const a of this.agents) {
      if (a.hiddenInVehicle || !a.human.root.visible) { a.human.mixer.update(dt); continue; }
      const f = a.body.feet();
      a.human.root.position.copy(f);
      const cur = a.human.root.rotation.y;
      let d = a.facing - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
      a.human.root.rotation.y = cur + d * (1 - Math.exp(-dt * 8));
      const { stepped } = a.human.update(a.tier === 'focused' || a.tier === 'active' ? dt : dt);
      if (stepped && a.tier !== 'cohort') onStep(a, f);
    }
  }

  rideResponse(a: Agent, hour: number, worldTime: number) {
    return respondToRide(a.mind, { hour, worldTime, raining: false, playerDistance: 1, playerId: 'player' });
  }
}
