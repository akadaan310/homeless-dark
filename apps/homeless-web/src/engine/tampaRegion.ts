// The opening region: source-anchored Tampa street with the fictional café, a drivable
// car, signal-aware traffic, Ana and Bo, ambient pedestrians, and the six-division
// wet-night integration wired through one world authority.
import { Vec3, SpotLight, InstancedMesh } from '@astro/core';
import { remember, type MotionAction, type MotionState, type PlanStep } from '@dark/core';
import { motionAdapter, facadeAdapter, signProgramAdapter, lodAdapter, acousticAdapter, clock9SignProposer, motif, schedule, chooseLod, composeFacade } from '@dark/subjects';
import { occlusionCutoff } from '@dark/somatostratum';
import type { Engine } from './engine';
import type { Region, Interactable } from './region';
import { buildTampa, CAFE, type TampaWorld } from './tampa';
import { PlayerCar, Traffic } from './vehicles';
import { NpcSystem, PLACES, type Agent } from './npcs';
import { GROUP } from './physics';
import type { SignView } from './signs';

export async function makeTampaRegion(e: Engine): Promise<Region> {
  const w: TampaWorld = await buildTampa(e.phys, e.signs, e.quality);
  e.setLoading('Parking the car and starting traffic', 0.55);
  const car = await PlayerCar.create(e.phys, w.group, w.carSpawn.pos, w.carSpawn.yaw);
  const traffic = new Traffic(e.phys, w.group);
  await traffic.init(w.trafficLanes, e.quality === 'low' ? 5 : 8);
  e.setLoading('Waking the neighbourhood', 0.7);
  const npcs = new NpcSystem(e.phys, w.group);
  const loops = [
    [new Vec3(-22.8, 0.15, -15), new Vec3(-22.8, 0.15, -85)],
    [new Vec3(6.6, 0.15, -15), new Vec3(6.6, 0.15, -120)],
    [new Vec3(-30, 0.15, 5.4), new Vec3(-85, 0.15, 5.4)],
    [new Vec3(12, 0.15, -5.4), new Vec3(60, 0.15, -5.4)],
  ].slice(0, e.quality === 'low' ? 3 : 4);
  await npcs.init(e.speech, loops);

  // ---------------------------------------------------------------- research adapters (six divisions)
  const knownTargets = new Set(['sign/cafe-sign']);
  const reg = e.research;
  reg.register(motionAdapter(() => realizer)).register(facadeAdapter()).register(lodAdapter()).register(acousticAdapter())
    .register(signProgramAdapter(() => knownTargets, 'npc:bo', () => e.world.inspect('sign/cafe-sign')!.rev));
  const facadeTrace = reg.run('plicastratum', Array.from({ length: 48 }, (_, i) => ({ buildingId: `osm-sample-${i}`, districtId: `tampa-${i % 4}`, frontageM: 14 + (i % 6) * 3, heightM: 6 + (i % 4) * 3, ground: (i % 3 ? 'commercial' : 'residential') as 'commercial' })));
  e.trace('II Relational', `FacadeGrammar composed ${(facadeTrace.candidate as unknown[]).length} façade programs; unfold(fold(p)) = p for all (${facadeTrace.verdict})`);
  void composeFacade;
  const proposeSign = clock9SignProposer('cafe-sign');
  const cafeSign = e.signs.signs.get('cafe-sign')!;

  // ---------------------------------------------------------------- state
  let inCar = false;
  let doorTimer = 0;
  let cafeDoorOpen = 0; // 0..1 slide
  let doorCommitted = false;
  let entering = 0; // seconds of door animation
  let passenger: Agent | null = null;
  let musicNext = 0;
  let motifK = 7;
  let lodTimer = 0;
  let lastLod = '';
  let signalWas = '';
  let rainSignDone = false;

  const realizer = {
    edgeOpen: (edge: string) => {
      if (edge === 'door:cafe') { const h = e.localHour(); return h >= 6 ? { ok: true } : { ok: false, reason: 'café closed (fictional hours 06:00–24:00)' }; }
      if (edge === 'door:car-driver' || edge === 'door:car-passenger') {
        const side = edge.endsWith('driver') ? car.rig.doorPoints.driver : car.rig.doorPoints.passenger;
        const p = car.worldPoint(side);
        const hit = e.phys.ray(new Vec3(p.x, 1, p.z), new Vec3(0, -1, 0), 0.2, GROUP.STATIC);
        return Math.abs(car.speed()) < 1.5 && !hit ? { ok: true } : { ok: false, reason: Math.abs(car.speed()) >= 1.5 ? 'vehicle moving' : 'door obstructed' };
      }
      return { ok: true };
    },
    targetReady: (t: string) => {
      const seats = (e.world.inspect('veh:sedan')!.data.seats as Record<string, string>) ?? {};
      if (t.startsWith('seat:')) { const s = t.slice(5); return seats[s] ? { ok: false, reason: `${s} seat occupied by ${seats[s]}` } : { ok: true }; }
      return { ok: true };
    },
  };
  const plan = (start: MotionState, steps: PlanStep[], label: string) => {
    const t = reg.run('operational-grammar', { start, plan: steps, label });
    e.trace('I Foundations', `${label}: ${t.verdict}${t.reason ? ` — ${t.reason}` : ''}`);
    return t.verdict === 'admitted';
  };

  // ---------------------------------------------------------------- sign programs (Division III)
  const applySignOps = (v: SignView, ops: { op: string; arg: string | number }[]) => {
    for (const o of ops) {
      if (o.op === 'TEXT') v.entity.text = String(o.arg);
      else if (o.op === 'HUE') v.entity.emission.hue = Number(o.arg);
      else if (o.op === 'CHROMA') v.entity.emission.chroma = Number(o.arg);
      else if (o.op === 'LIGHTNESS') v.entity.emission.lightness = Number(o.arg);
      else if (o.op === 'BRIGHTNESS') v.entity.emission.brightness = Number(o.arg);
      else if (o.op === 'PULSE') v.entity.pulseHz = Number(o.arg);
      else if (o.op === 'CHIME') e.audio.chime(v.group.getWorldPosition(new Vec3()), Number(o.arg));
    }
    v.entity.revision++;
    e.signs.apply(v);
  };
  const runSignProgram = (address: string, actor: 'npc:bo' | 'player', consent: string) => {
    const t = reg.run('purl', address);
    if (t.verdict !== 'admitted') { e.trace('III Languages', `program refused before execution: ${t.reason}`); return false; }
    const ev = e.world.journal[e.world.journal.length - 1]!;
    void actor; void consent;
    applySignOps(cafeSign, (ev.payload as { ops: { op: string; arg: string | number }[] }).ops);
    const rev = e.world.inspect('sign/cafe-sign')!.rev;
    const bw = e.borne.set('signRev', rev, ev.id);
    // music follows the sign hue through the interval ring: k = hue/30 (ℤ/12)
    motifK = Math.round(cafeSign.entity.emission.hue / 30) % 12 || 7;
    const mt = reg.run('generative-composition', { eventId: ev.id, type: 'SIGN_LIGHT_SHIFT', tick: e.world.tick, k: motifK, root: 60 });
    e.trace('III Languages', `SIGN_LIGHT_SHIFT ${ev.id} compiled & admitted: ${address}`);
    e.trace('V Acoustic', `café motif now orbit ⟨${motifK}⟩ ⊂ ℤ/12 (${(mt.candidate as { notes: unknown[] }).notes.length} notes); BORNE moved ${bw.moved.join(', ') || 'nothing'}`);
    e.telemetry.log(ev.id, 'image', performance.now() / 1000, 'sign re-layout');
    e.witness.lastSignProgram = { address, eventId: ev.id, text: cafeSign.entity.text, hue: cafeSign.entity.emission.hue };
    return true;
  };
  const boChangesSign = (reason: string) => {
    const p = proposeSign(e.world.tick, knownTargets);
    if (!p) return;
    const bo = npcs.get('npc:bo')!;
    npcs.say(bo, 'socialize');
    e.trace('III Languages', `CLOCK9 slot ${p.proposal.slot} proposed (${p.attempts} attempt${p.attempts > 1 ? 's' : ''}) — Bo (sign owner) consents: ${reason}`);
    runSignProgram(p.address, 'npc:bo', 'owner');
  };
  e.programSign = (address: string) => {
    const bo = npcs.get('npc:bo')!;
    const trust = bo.mind.relationship.player ?? 0;
    if (trust < 0.3) {
      e.world.refusals.push({ ev: { type: 'SIGN_LIGHT_SHIFT', actor: 'player', payload: {} }, reason: `Bo owns the café sign; consent needs trust ≥ 0.30 (now ${trust.toFixed(2)})` });
      npcs.say(bo, 'continue_task');
      return { ok: false, reason: `Bo has not invited you to change his sign yet (trust ${trust.toFixed(2)} < 0.30). Talk to him first.` };
    }
    const ok = runSignProgram(address, 'player', 'invited');
    return ok ? { ok: true, reason: 'admitted' } : { ok: false, reason: reg.traces[reg.traces.length - 1]?.reason ?? 'refused' };
  };

  // ---------------------------------------------------------------- dialogue
  const talkTo = (a: Agent) => {
    e.dialog = { npc: a.mind.id, name: a.mind.name, options: [
      { id: 'greet', label: 'Say hello' }, { id: 'work', label: 'What are you up to?' },
      { id: 'ride', label: 'Offer a ride' }, ...(a.mind.id === 'npc:bo' ? [{ id: 'travel', label: 'I want to travel somewhere' }, { id: 'sign', label: 'Could the café sign change for the rain?' }] : []),
      { id: 'bye', label: 'Goodbye' },
    ] };
  };
  e.onDialogChoice = (npcId: string, choice: string) => {
    const a = npcs.get(npcId);
    if (!a) return;
    const hour = e.localHour();
    e.world.commit({ type: 'CONVERSE', actor: 'player', payload: { npc: npcId, topic: choice } });
    const act = (x: string) => { npcs.say(a, x); e.world.commit({ type: 'NPC_SPEECH', actor: npcId, payload: { act: x } }); };
    if (choice === 'greet') { act(a.mind.memory.some((m) => m.about === 'player' && m.fact === 'talked') ? 'socialize' : 'greeting'); a.mind = remember(a.mind, e.world.tick, 'talked', 'player', 0.12); }
    else if (choice === 'work') { act('work'); a.mind = remember(a.mind, e.world.tick, 'asked about work', 'player', 0.1); }
    else if (choice === 'ride') {
      const r = npcs.rideResponse(a, hour, e.world.worldTime);
      e.world.commit({ type: 'RIDE_OFFER', actor: 'player', payload: { npc: npcId, accepted: r.accepted, reason: r.reason } });
      e.trace('VI Worlds', `${a.mind.name} ${r.accepted ? 'accepts' : 'declines'} the ride: ${r.reason}`);
      if (r.accepted) { act(a.mind.id === 'npc:bo' ? 'accept_ride' : 'socialize'); a.state = 'boarding'; passenger = a; }
      else act(r.speechAct);
    } else if (choice === 'travel') { act('travel'); e.openTravel?.(); }
    else if (choice === 'sign') {
      a.mind = remember(a.mind, e.world.tick, 'asked to change the sign', 'player', 0.2);
      boChangesSign('the player asked kindly');
    } else if (choice === 'bye') { if (a.mind.id === 'npc:bo') act('farewell'); e.dialog = null; }
  };

  // ---------------------------------------------------------------- car entry/exit
  const enterCar = () => {
    const ok = plan('street', [{ action: 'WALK' }, { action: 'OPEN_DOOR', edge: 'door:car-driver' }, { action: 'ENTER_VEHICLE', target: 'seat:driver' }, { action: 'SIT', target: 'seat:driver' }], 'enter car (driver)');
    if (!ok) return;
    const r = e.world.commit({ type: 'ENTER_VEHICLE', actor: 'player', payload: { vehicle: 'veh:sedan', seat: 'driver' } });
    if (!('hash' in r)) return;
    car.rig.doors.LF.target = 1;
    entering = 0.9;
    inCar = true;
    e.onFoot = false;
    e.player.setEnabled(false);
    e.avatar.root.visible = false;
    car.engineOn = true;
    e.world.commit({ type: 'ENGINE_START', actor: 'player', target: 'veh:sedan', payload: {} });
  };
  const exitCar = () => {
    if (Math.abs(car.speed()) > 2) { e.world.refusals.push({ ev: { type: 'EXIT_VEHICLE', actor: 'player', payload: {} }, reason: 'vehicle moving faster than 2 m/s' }); return; }
    const ok = plan('seated', [{ action: 'EXIT_VEHICLE', edge: 'door:car-driver' }], 'exit car');
    let side = car.rig.doorPoints.driver;
    if (!ok) side = car.rig.doorPoints.passenger;
    e.world.commit({ type: 'EXIT_VEHICLE', actor: 'player', payload: { vehicle: 'veh:sedan' } });
    car.rig.doors.LF.target = 1;
    setTimeout(() => { car.rig.doors.LF.target = 0; closeDoor('LF'); }, 700);
    const p = car.worldPoint(side);
    e.player.setEnabled(true);
    e.player.teleport(new Vec3(p.x, Math.max(0.2, p.y + 0.2), p.z));
    e.avatar.root.visible = true;
    e.onFoot = true; inCar = false; car.engineOn = false;
    car.vehicle.park();
    e.audio.setEngine(false, car.position(), 0, 0);
    if (passenger) {
      const pa = passenger; passenger = null;
      setTimeout(() => {
        e.world.commit({ type: 'EXIT_VEHICLE', actor: pa.mind.id, payload: { vehicle: 'veh:sedan' } });
        car.rig.doors.RF.target = 1; setTimeout(() => { car.rig.doors.RF.target = 0; closeDoor('RF'); }, 800);
        const q = car.worldPoint(car.rig.doorPoints.passenger);
        pa.body.setEnabled(true); pa.body.teleport(new Vec3(q.x, 0.25, q.z));
        pa.hiddenInVehicle = false; pa.human.root.visible = true; pa.state = 'idle';
        car.rig.root.remove(pa.human.root); w.group.add(pa.human.root);
        pa.mind = remember(pa.mind, e.world.tick, 'rode with the player', 'player', 0.15);
        e.trace('I Foundations', `${pa.mind.name}: door→street→seat→ride→exit completed (replayable plan)`);
      }, 900);
    }
  };
  const closeDoor = (k: 'LF' | 'RF') => {
    const ev = e.world.commit({ type: 'CAR_DOOR_CLOSE', actor: 'player', payload: { door: k } });
    if ('id' in ev) {
      const pos = car.worldPoint(k === 'LF' ? car.rig.doorPoints.driver : car.rig.doorPoints.passenger);
      e.audio.doorSlam(pos, ev.id);
      const t = performance.now() / 1000;
      e.telemetry.log(ev.id, 'animation', t, 'door latch'); e.telemetry.log(ev.id, 'audio', t, 'slam'); e.telemetry.log(ev.id, 'image', t, 'door closed');
    }
  };

  const npcBoard = (a: Agent) => {
    const ok = plan('street', [{ action: 'WALK' }, { action: 'OPEN_DOOR', edge: 'door:car-passenger' }, { action: 'ENTER_VEHICLE', target: 'seat:passenger' }, { action: 'SIT', target: 'seat:passenger' }], `${a.mind.name} boards (passenger)`);
    if (!ok) return;
    const r = e.world.commit({ type: 'ENTER_VEHICLE', actor: a.mind.id, payload: { vehicle: 'veh:sedan', seat: 'passenger' } });
    if (!('hash' in r)) return;
    car.rig.doors.RF.target = 1;
    setTimeout(() => { car.rig.doors.RF.target = 0; closeDoor('RF'); }, 1000);
    a.state = 'riding'; a.hiddenInVehicle = true; a.body.setEnabled(false); a.path = [];
    w.group.remove(a.human.root); car.rig.root.add(a.human.root);
    a.human.root.position.copy(car.rig.seats.passenger).add(new Vec3(0, -0.15, 0.1));
    a.human.root.rotation.set(0, Math.PI, 0);
    a.human.setPose('seated');
  };

  // ---------------------------------------------------------------- region object
  const region: Region = {
    id: 'tampa', kind: 'street', name: 'Tampa — N Dale Mabry Hwy & W Spruce St', lat: 27.9594638, lon: -82.5054865,
    group: w.group, surfaces: w.surfaces, spawn: w.spawn, spawnYaw: 0.8,
    sourceLabels: w.sourceLabels as Region['sourceLabels'], interiors: [w.cafe.interior],
    controlsPlayer: () => inCar,
    obstacles: () => [e.playerPos(), car.position()],
    fixed(h) {
      const inp = e.lastInput;
      if (inCar && inp && entering <= 0) {
        const throttle = Math.max(0, inp.move.y);
        const fwd = car.speed();
        const reverse = inp.move.y < 0 && fwd < 0.8;
        const brake = (inp.move.y < 0 && fwd > 0.8) || (inp.move.y > 0 && fwd < -0.8) || inp.brake ? 1 : 0;
        car.throttle = reverse ? -0.5 : throttle;
        car.braking = brake > 0;
        car.vehicle.drive(reverse ? -0.45 : throttle, brake, -inp.move.x, h);
      } else car.vehicle.drive(0, 0.3, 0, h);
      traffic.update(h, e.atmo.state.streetLights > 0.3 || e.atmo.state.rain > 0.2 ? 1 : 0, region.obstacles!());
      npcs.update(h, h, { hour: e.localHour(), worldTime: e.world.worldTime, raining: e.atmo.state.rain > 0.2, player: inCar ? car.position() : e.playerPos(), interior: w.cafe.interior, tick: e.world.tick });
      // passenger walks to the car and boards when it is stopped and close
      if (passenger && passenger.state === 'boarding' && !passenger.hiddenInVehicle) {
        const door = car.worldPoint(car.rig.doorPoints.passenger);
        const f = passenger.body.feet();
        if (f.distanceTo(door) > 0.9) passenger.path = [door];
        else if (Math.abs(car.speed()) < 0.5) npcBoard(passenger);
      }
      // café sliding door: opens for anyone near when the grammar admits passage
      const doorPos = w.cafe.doorWorld;
      const near = [e.playerPos(), ...npcs.agents.filter((a) => !a.hiddenInVehicle).map((a) => a.body.feet())].some((p) => Math.hypot(p.x - doorPos.x, p.z - doorPos.z) < 2.4);
      if (near && !doorCommitted) {
        if (plan('street', [{ action: 'OPEN_DOOR', edge: 'door:cafe' }, { action: 'PASS_DOOR', edge: 'door:cafe' }], 'café door')) {
          e.world.commit({ type: 'DOOR_OPEN', actor: 'system', payload: { door: 'cafe' } });
          doorCommitted = true;
        } else doorTimer = -3; // refusal: back off before re-asking
      }
      if (near) doorTimer = 0; else doorTimer += h;
      if (doorCommitted && doorTimer > 2) { e.world.commit({ type: 'DOOR_CLOSE', actor: 'system', payload: { door: 'cafe' } }); doorCommitted = false; }
      cafeDoorOpen += ((doorCommitted ? 1 : 0) - cafeDoorOpen) * Math.min(1, h * 5);
      const dz = cafeDoorOpen * 1.75;
      w.cafe.door.position.z = doorPos.z - dz;
      const body = w.cafe.doorCollider.parent()!;
      body.setNextKinematicTranslation({ x: w.cafe.door.position.x, y: w.cafe.door.position.y, z: w.cafe.door.position.z });
    },
    frame(dt) {
      // car visuals, entry animation and engine sound
      const lights = e.borne.get('headlights') ? 1 : 0;
      car.update(dt, lights);
      if (entering > 0) { entering -= dt; if (entering <= 0) { car.rig.doors.LF.target = 0; closeDoor('LF'); } }
      if (inCar) e.audio.setEngine(true, car.position(), car.speed(), Math.abs(car.throttle));
      npcs.render(dt, (a, pos) => {
        if (a.tier === 'focused' || a.tier === 'active') {
          const s = e.surfaceAt(pos);
          const ev = e.world.commit({ type: 'FOOTSTEP', actor: a.mind.id.startsWith('npc:walker') ? 'npc:bo' : a.mind.id, payload: { surface: s } });
          e.audio.footstep(s, pos, 1.3, e.atmo.state.wet.wetness, 0, 'id' in ev ? ev.id : undefined);
        }
      });
      // traffic signal heads
      const sig = traffic.signalNS;
      if (sig !== signalWas) {
        signalWas = sig;
        w.signalHeads.forEach((hd, i) => {
          const ns = i < 2;
          const col = ns ? (sig === 'green' ? 0x30ff60 : sig === 'yellow' ? 0xffc020 : 0xff2a20) : (sig === 'red' ? 0x30ff60 : 0xff2a20);
          hd.material.emissive.setHex(col);
          hd.material.emissiveIntensity = 2.2;
        });
      }
      // streetlight heads (emissive) follow the BORNE streetlights node, blended by atmosphere
      const heads = w.group.getObjectByName('streetlight-heads');
      if (heads instanceof InstancedMesh) heads.material.emissiveIntensity = e.atmo.state.streetLights * 5;
      poolStreetLights();
      // the rain makes Bo change his sign (wet-night step 7), once per rain
      if (e.atmo.state.rain > 0.2 && !rainSignDone) { rainSignDone = true; boChangesSign('rain started: inviting people inside'); }
      if (e.atmo.state.rain === 0) rainSignDone = false;
      // café music (MusicClock) — positional, occluded by walls when outside
      if (e.audio.unlocked) {
        const now = e.audio.now();
        const listener = e.camera.position;
        const dist = listener.distanceTo(w.cafe.music);
        if (dist < 45 && now > musicNext - 0.2) {
          const dir = w.cafe.music.clone().sub(listener);
          const hit = e.phys.ray(listener, dir.clone().normalize(), dir.length() - 0.3, GROUP.STATIC);
          const cutoff = occlusionCutoff(hit ? 2 : 0, false);
          const tempo = e.localHour() >= 20 ? 72 : 92;
          const notes = schedule(motif(57 + (motifK % 3), motifK, 8), Math.max(now, musicNext), tempo);
          for (const n of notes) e.audio.pluck(w.cafe.music, n.hz, n.t, n.velocity, cutoff);
          musicNext = Math.max(now, musicNext) + (8 * 60) / tempo;
        }
        e.audio.setAmbience(Math.max(0, 1 - Math.abs((inCar ? car.position().x : e.playerPos().x) + 8) / 120));
      }
      // Division IV: perceptual LOD on signs (text legibility is lost at stratum 2)
      lodTimer += dt;
      if (lodTimer > 1) {
        lodTimer = 0;
        const vp = e.renderer.drawingBufferHeight;
        const levels: number[] = [];
        for (const v of e.signs.signs.values()) {
          const d = v.group.getWorldPosition(new Vec3()).distanceTo(e.camera.position);
          const lvl = chooseLod(d, e.camera.fov, vp, 2, 2).level;
          v.text.visible = lvl < 2;
          levels.push(lvl);
        }
        const key = levels.join('');
        if (key !== lastLod) { lastLod = key; reg.run('imagistratum', { distances: [...e.signs.signs.values()].map((v) => v.group.getWorldPosition(new Vec3()).distanceTo(e.camera.position)), fov: e.camera.fov, viewport: vp }); }
      }
    },
    interactables() {
      const list: Interactable[] = [];
      if (!inCar) {
        list.push({ id: 'car', label: 'Get in the car (driver)', pos: car.worldPoint(car.rig.doorPoints.driver), radius: 2.0, key: 'vehicle', action: enterCar });
        for (const a of npcs.agents) if (!a.pedestrian && !a.hiddenInVehicle) list.push({ id: a.mind.id, label: `Talk to ${a.mind.name}`, pos: a.body.feet(), radius: 2.6, action: () => talkTo(a) });
        list.push({ id: 'sign-console', label: 'Café sign programme (owner: Bo)', pos: new Vec3(CAFE.x1 + 1.2, 0.15, -(CAFE.n0 + 3)), radius: 1.8, action: (en) => en.openSignConsole?.() });
      } else list.push({ id: 'car-exit', label: 'Get out', pos: e.playerPos(), radius: 99, key: 'vehicle', action: exitCar });
      return list;
    },
    focus() {
      if (!inCar) return null;
      const p = car.position();
      return { pos: new Vec3(p.x, p.y + 1.1, p.z), heading: car.heading(), mode: 'vehicle' };
    },
    hudExtra: () => ({
      signal: traffic.signalNS, carKmh: Math.round(Math.abs(car.speed()) * 3.6), inCar,
      npcs: npcs.agents.filter((a) => !a.pedestrian).map((a) => ({ name: a.mind.name, activity: a.lastDecision.activity, reason: a.lastDecision.reason, trust: +(a.mind.relationship.player ?? 0).toFixed(2), state: a.state })),
      tiers: npcs.agents.reduce((acc, a) => { acc[a.tier] = (acc[a.tier] ?? 0) + 1; return acc; }, {} as Record<string, number>),
      signText: cafeSign.entity.text, stats: w.stats,
    }),
    dispose() { e.audio.setEngine(false, new Vec3(), 0, 0); },
  };

  // player position follows the car while driving (for interactions/streaming)
  const origFeet = e.playerPos.bind(e);
  e.playerPos = () => (inCar ? car.position().clone().setY(0) : origFeet());
  e.npcMemories = () => npcs.agents.filter((a) => !a.pedestrian).map((a) => ({ id: a.mind.id, memory: a.mind.memory, relationship: a.mind.relationship }));
  e.restoreNpcs = (m) => { for (const r of m) { const a = npcs.get(r.id); if (a) { a.mind.memory = r.memory as never; a.mind.relationship = r.relationship; } } };

  // pool of real lights for the nearest streetlights (emissive heads alone do not light the street)
  const pool: SpotLight[] = [];
  for (let i = 0; i < (e.quality === 'low' ? 4 : 8); i++) {
    const s = new SpotLight(0xffc98f, 0, 32, 0.95, 0.55, 1.4);
    s.castShadow = false;
    w.group.add(s, s.target);
    pool.push(s);
  }
  let poolTimer = 0;
  function poolStreetLights() {
    poolTimer -= 1;
    if (poolTimer > 0) return;
    poolTimer = 15;
    const c = e.camera.position;
    const near = w.streetlights.filter((l) => l.head).sort((a, b) => a.head!.distanceToSquared(c) - b.head!.distanceToSquared(c)).slice(0, pool.length);
    pool.forEach((s, i) => {
      const l = near[i];
      if (!l) { s.intensity = 0; return; }
      s.position.copy(l.head!);
      s.target.position.set(l.head!.x, 0, l.head!.z);
      s.intensity = e.atmo.state.streetLights * 520;
    });
  }
  void PLACES;
  e.debug = { car, traffic, npcs, world: w, enterCar, exitCar, boChangesSign, talkTo };
  return region;
}

export type { MotionAction };
