// HOMELESS world rules: every mutation is a typed event with roles, schema validation
// and (where relevant) budgets. Projections (render/audio/haptics) subscribe; they never write.
import { WorldAuthority, compileProgram, type EventRule } from '@dark/core';

const obj = (p: unknown): p is Record<string, unknown> => typeof p === 'object' && p !== null;
const num = (p: Record<string, unknown>, k: string, lo: number, hi: number) => typeof p[k] === 'number' && (p[k] as number) >= lo && (p[k] as number) <= hi;
const str = (p: Record<string, unknown>, k: string, max = 64) => typeof p[k] === 'string' && (p[k] as string).length <= max;

const rules: EventRule[] = [
  { type: 'RAIN_START', roles: ['system'], validate: (p) => (obj(p) && num(p, 'intensity', 0.05, 1) ? null : 'intensity ∈ [0.05,1]'),
    apply: (m, ev) => m.patch('env', { rain: (ev.payload as { intensity: number }).intensity, rainSince: ev.worldTime }) },
  { type: 'RAIN_STOP', roles: ['system'], validate: () => null, apply: (m) => m.patch('env', { rain: 0 }) },
  { type: 'THUNDER_FAR', roles: ['system'], validate: (p) => (obj(p) && num(p, 'distanceM', 300, 20000) ? null : 'distanceM'), apply: () => {} },
  { type: 'FOOTSTEP', roles: ['player', 'npc'], validate: (p) => (obj(p) && str(p, 'surface') ? null : 'surface'), apply: () => {} },
  { type: 'NPC_SPEECH', roles: ['npc'], validate: (p) => (obj(p) && str(p, 'act') ? null : 'act'), apply: (m, ev) => {
    const e = m.get(ev.actor); if (e) m.patch(ev.actor, { lastAct: (ev.payload as { act: string }).act });
  } },
  { type: 'CONVERSE', roles: ['player'], budgetPerMinute: 30, validate: (p) => (obj(p) && str(p, 'topic') && str(p, 'npc') ? null : 'topic/npc'), apply: () => {} },
  { type: 'RIDE_OFFER', roles: ['player'], validate: (p) => (obj(p) && str(p, 'npc') && typeof (p as Record<string, unknown>).accepted === 'boolean' ? null : 'npc/accepted'), apply: () => {} },
  { type: 'DOOR_OPEN', roles: ['player', 'npc', 'system'], validate: (p) => (obj(p) && str(p, 'door') ? null : 'door'), apply: (m, ev) => m.patch(`door/${(ev.payload as { door: string }).door}`, { open: true }) },
  { type: 'DOOR_CLOSE', roles: ['player', 'npc', 'system'], validate: (p) => (obj(p) && str(p, 'door') ? null : 'door'), apply: (m, ev) => m.patch(`door/${(ev.payload as { door: string }).door}`, { open: false }) },
  { type: 'ENTER_VEHICLE', roles: ['player', 'npc'], validate: (p) => (obj(p) && str(p, 'vehicle') && str(p, 'seat') ? null : 'vehicle/seat'), apply: (m, ev) => {
    const p = ev.payload as { vehicle: string; seat: string };
    const v = m.get(p.vehicle);
    const seats = { ...((v?.data.seats as Record<string, string>) ?? {}) };
    seats[p.seat] = ev.actor;
    m.patch(p.vehicle, { seats });
  }, admit: (w, ev) => {
    const p = ev.payload as { vehicle: string; seat: string };
    const seats = (w.inspect(p.vehicle)?.data.seats as Record<string, string>) ?? {};
    return seats[p.seat] && seats[p.seat] !== ev.actor ? `seat ${p.seat} is occupied by ${seats[p.seat]}` : null;
  } },
  { type: 'EXIT_VEHICLE', roles: ['player', 'npc'], validate: (p) => (obj(p) && str(p, 'vehicle') ? null : 'vehicle'), apply: (m, ev) => {
    const p = ev.payload as { vehicle: string };
    const v = m.get(p.vehicle);
    const seats = Object.fromEntries(Object.entries((v?.data.seats as Record<string, string>) ?? {}).filter(([, a]) => a !== ev.actor));
    m.patch(p.vehicle, { seats });
  } },
  { type: 'CAR_DOOR_CLOSE', roles: ['player', 'npc'], validate: () => null, apply: () => {} },
  { type: 'ENGINE_START', roles: ['player'], validate: () => null, apply: (m, ev) => m.patch((ev.target as string) ?? 'veh:sedan', { engine: true }) },
  { type: 'SIGN_LIGHT_SHIFT', roles: ['npc', 'player'], budgetPerMinute: 6,
    validate: (p) => (obj(p) && Array.isArray((p as Record<string, unknown>).ops) ? null : 'ops[]'),
    admit: (w, ev) => (w.inspect(ev.target ?? '') ? null : `unknown sign ${ev.target}`),
    apply: (m, ev) => {
      const cur = m.get(ev.target!);
      m.patch(ev.target!, { ops: (ev.payload as { ops: unknown[] }).ops, by: ev.actor, consent: (ev.payload as { consent?: string }).consent ?? 'owner' });
      void cur;
    } },
  { type: 'PLAN_ADMITTED', roles: ['player', 'npc', 'system'], validate: () => null, apply: () => {} },
  { type: 'DISTRICT_COMPOSED', roles: ['system'], validate: () => null, apply: () => {} },
  { type: 'LOD_ASSIGNED', roles: ['system'], validate: () => null, apply: () => {} },
  { type: 'MUSIC_PROGRAM', roles: ['system', 'npc'], validate: () => null, apply: (m, ev) => m.patch('cafe', { music: (ev.payload as { notes: number[] }).notes }) },
  { type: 'BORNE_PROPAGATED', roles: ['system'], validate: () => null, apply: () => {} },
  { type: 'TRAVEL', roles: ['player'], validate: (p) => (obj(p) && num(p, 'lat', -90, 90) && num(p, 'lon', -180, 180) ? null : 'lat/lon'), apply: (m, ev) => m.patch('player', { lat: (ev.payload as { lat: number }).lat, lon: (ev.payload as { lon: number }).lon, location: (ev.payload as { name?: string }).name ?? null }) },
  { type: 'TICKET_ISSUED', roles: ['npc'], validate: (p) => (obj(p) && str(p, 'ticket') ? null : 'ticket'), apply: (m, ev) => m.patch('player', { ticket: (ev.payload as { ticket: string }).ticket }),
    admit: (w) => (w.inspect('player')?.data.ticket ? 'a ticket is already held (no duplicates)' : null) },
  { type: 'TRAVEL_STATE', roles: ['player', 'system', 'npc'], validate: (p) => (obj(p) && str(p, 'state') ? null : 'state'), apply: (m, ev) => m.patch('player', { travelState: (ev.payload as { state: string }).state }) },
  { type: 'SEAT_ASSIGNED', roles: ['player', 'npc'], validate: (p) => (obj(p) && str(p, 'seat', 4) ? null : 'seat'), apply: (m, ev) => m.patch('player', { seat: (ev.payload as { seat: string }).seat }) },
  { type: 'TIME_SCALE', roles: ['player'], validate: (p) => (obj(p) && num(p, 'scale', 1, 3600) ? null : 'scale ∈ [1,3600]'), apply: (m, ev) => m.patch('player', { journeyScale: (ev.payload as { scale: number }).scale }) },
  { type: 'ARRIVED', roles: ['system'], validate: () => null, apply: (m) => m.patch('player', { ticket: null, travelState: 'ARRIVED', seat: null }) },
  { type: 'AIRCRAFT_TAKEOFF', roles: ['system', 'player'], validate: () => null, apply: () => {} },
  { type: 'WAVE_HULL', roles: ['system'], validate: () => null, apply: () => {} },
];

export function createWorld(): WorldAuthority {
  const w = new WorldAuthority();
  w.addActor({ id: 'player', role: 'player', displayName: 'You' })
    .addActor({ id: 'system', role: 'system' })
    .addActor({ id: 'npc:ana', role: 'npc', displayName: 'Ana' })
    .addActor({ id: 'npc:bo', role: 'npc', displayName: 'Bo' })
    .addActor({ id: 'npc:desk', role: 'npc', displayName: 'Desk attendant' })
    .addActor({ id: 'npc:crew', role: 'npc', displayName: 'Cabin crew' })
    .addActor({ id: 'visitor', role: 'visitor' });
  for (const r of rules) w.register(r);
  w.seed({ id: 'env', kind: 'environment', rev: 1, data: { rain: 0, weatherSource: 'fictional (seeded offline approximation)' }, source: 'authored' });
  w.seed({ id: 'player', kind: 'actor', rev: 1, data: { lat: 27.9594638, lon: -82.5054865, location: 'Tampa', ticket: null }, source: 'authored' });
  w.seed({ id: 'veh:sedan', kind: 'vehicle', rev: 1, data: { seats: {}, engine: false, owner: 'player' }, source: 'authored' });
  w.seed({ id: 'sign/cafe-sign', kind: 'sign', rev: 1, data: { owner: 'npc:bo', text: 'SPRUCE CORNER CAFÉ', consentPolicy: 'owner or invited' }, source: 'authored' });
  w.seed({ id: 'cafe', kind: 'place', rev: 1, data: { open: [6, 24], fictional: true }, source: 'authored' });
  w.seed({ id: 'door/cafe', kind: 'door', rev: 1, data: { open: false }, source: 'authored' });
  for (const n of ['npc:ana', 'npc:bo']) w.seed({ id: n, kind: 'npc', rev: 1, data: { fictional: true }, source: 'authored' });
  return w;
}

export { compileProgram };
