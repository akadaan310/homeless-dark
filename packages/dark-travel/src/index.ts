// TravelProgram: Earth-to-experience travel grammar (constitution v3 §II-D).
//
// Everything here is FICTIONAL GAME PERMISSION: in-game offers, tickets, seats and
// flights. No real booking, boarding right, airline schedule or operational
// procedure is represented. Airport locations come from OurAirports (public
// domain, no accuracy guarantee); schedules are generated and labelled fictional.

import { geodesicDistance, initialBearing, intermediatePoint } from '@dark/geo';
import { mulberry32, fnv1a } from '@dark/core';

export interface AirportRecord { icao: string; iata: string | null; name: string; lat: number; lon: number; elevation: number | null; country: string; municipality: string | null; type: 'large' | 'medium' }

export function parseAirports(json: { airports: (string | number | null)[][] }): AirportRecord[] {
  return json.airports.map((r) => ({
    icao: r[0] as string, iata: (r[1] as string) ?? null, name: r[2] as string, lat: r[3] as number, lon: r[4] as number,
    elevation: (r[5] as number) ?? null, country: r[6] as string, municipality: (r[7] as string) ?? null, type: r[8] === 'l' ? 'large' : 'medium',
  }));
}

export function nearestAirport(list: AirportRecord[], lat: number, lon: number, largeOnly = true): { airport: AirportRecord; distanceM: number } | null {
  let best: AirportRecord | null = null, bd = Infinity;
  for (const a of list) {
    if (largeOnly && a.type !== 'large') continue;
    const d = geodesicDistance(lat, lon, a.lat, a.lon);
    if (d < bd) { bd = d; best = a; }
  }
  return best ? { airport: best, distanceM: bd } : null;
}

// ---------------------------------------------------------------- state machine
export type TravelState = 'OFFERED' | 'ACCEPTED' | 'CHECKED_IN' | 'LOUNGE' | 'BOARDING' | 'SEATED' | 'TAXI' | 'TAKEOFF' | 'CRUISE' | 'DESCENT' | 'LANDED' | 'DISEMBARKED' | 'ARRIVED' | 'DECLINED' | 'CANCELLED' | 'HOLD';
export type TravelEvent = 'accept' | 'decline' | 'check_in' | 'enter_lounge' | 'call_boarding' | 'take_seat' | 'pushback' | 'rotate' | 'level_off' | 'begin_descent' | 'touchdown' | 'disembark' | 'arrive' | 'cancel' | 'hold' | 'resume' | 'reroute';

const T: Partial<Record<TravelState, Partial<Record<TravelEvent, TravelState>>>> = {
  OFFERED: { accept: 'ACCEPTED', decline: 'DECLINED' },
  ACCEPTED: { check_in: 'CHECKED_IN', cancel: 'CANCELLED' },
  CHECKED_IN: { enter_lounge: 'LOUNGE', call_boarding: 'BOARDING', cancel: 'CANCELLED', hold: 'HOLD' },
  LOUNGE: { call_boarding: 'BOARDING', cancel: 'CANCELLED', hold: 'HOLD' },
  BOARDING: { take_seat: 'SEATED', cancel: 'CANCELLED', hold: 'HOLD' },
  SEATED: { pushback: 'TAXI', hold: 'HOLD' },
  TAXI: { rotate: 'TAKEOFF', hold: 'HOLD' },
  TAKEOFF: { level_off: 'CRUISE' },
  CRUISE: { begin_descent: 'DESCENT', reroute: 'CRUISE' },
  DESCENT: { touchdown: 'LANDED' },
  LANDED: { disembark: 'DISEMBARKED' },
  DISEMBARKED: { arrive: 'ARRIVED' },
};

export interface Seat { id: string; row: number; letter: string; cls: 'first' | 'business' | 'economy'; window: boolean; holder: string | null }
export interface Ticket { id: string; holder: string; flight: string; seat: string | null; cls: Seat['cls']; fictional: true }
export interface Leg { flight: string; from: AirportRecord; to: AirportRecord; aircraft: AircraftType; departUtc: number; scheduledDurationS: number; assumptions: string[] }

export interface TravelProgram {
  id: string;
  actor: string;
  leg: Leg;
  state: TravelState;
  heldFrom?: TravelState;
  ticket: Ticket | null;
  history: { state: TravelState; event: TravelEvent; worldTime: number }[];
  sourceEvidence: { airports: 'OurAirports (public domain, no accuracy guarantee)'; schedule: 'fictional, generated'; interior: 'author-composed' };
}

export function transition(p: TravelProgram, ev: TravelEvent, worldTime: number): { ok: true; program: TravelProgram } | { ok: false; reason: string } {
  if (p.state === 'HOLD') {
    if (ev === 'resume' && p.heldFrom) return { ok: true, program: { ...p, state: p.heldFrom, heldFrom: undefined, history: [...p.history, { state: p.heldFrom, event: ev, worldTime }] } };
    if (ev === 'cancel') return { ok: true, program: { ...p, state: 'CANCELLED', history: [...p.history, { state: 'CANCELLED', event: ev, worldTime }] } };
    return { ok: false, reason: 'on hold: only resume or cancel' };
  }
  const next = T[p.state]?.[ev];
  if (!next) return { ok: false, reason: `${ev} not admissible in ${p.state}` };
  if (ev === 'take_seat' && !p.ticket?.seat) return { ok: false, reason: 'no seat assigned on ticket' };
  return { ok: true, program: { ...p, state: next, heldFrom: next === 'HOLD' ? p.state : undefined, history: [...p.history, { state: next, event: ev, worldTime }] } };
}

// ---------------------------------------------------------------- cabin inventory
export function makeCabin(rows: number, layout: string[] = ['A', 'B', 'C', 'D', 'E', 'F'], firstRows = 2): Seat[] {
  const seats: Seat[] = [];
  for (let r = 1; r <= rows; r++) for (const l of layout) seats.push({ id: `${r}${l}`, row: r, letter: l, cls: r <= firstRows ? 'business' : 'economy', window: l === layout[0] || l === layout[layout.length - 1], holder: null });
  return seats;
}

/** Assign a seat atomically; a holder can never hold two seats, a seat never two holders. */
export function assignSeat(seats: Seat[], seatId: string, holder: string): { ok: true; seats: Seat[] } | { ok: false; reason: string } {
  const s = seats.find((x) => x.id === seatId);
  if (!s) return { ok: false, reason: `no seat ${seatId}` };
  if (s.holder && s.holder !== holder) return { ok: false, reason: `${seatId} is taken` };
  return { ok: true, seats: seats.map((x) => (x.holder === holder && x.id !== seatId ? { ...x, holder: null } : x.id === seatId ? { ...x, holder } : x)) };
}

// ---------------------------------------------------------------- aircraft and duration
export type AircraftType = 'widebody' | 'narrowbody' | 'regional' | 'prop' | 'helicopter';
export const CRUISE_MPS: Record<AircraftType, number> = { widebody: 250, narrowbody: 235, regional: 200, prop: 80, helicopter: 65 };

/**
 * Scheduled block time = taxi + climb/descent overhead + great-circle distance ×
 * route factor / nominal cruise speed. Winds are NOT modelled (no licensed live
 * feed); the assumptions are returned for display.
 */
export function estimateDuration(from: AirportRecord, to: AirportRecord, aircraft: AircraftType): { seconds: number; distanceM: number; bearing: number; assumptions: string[] } {
  const d = geodesicDistance(from.lat, from.lon, to.lat, to.lon);
  const routeFactor = 1.05;
  const overhead = aircraft === 'helicopter' ? 300 : 1800;
  const seconds = overhead + (d * routeFactor) / CRUISE_MPS[aircraft];
  return {
    seconds, distanceM: d, bearing: initialBearing(from.lat, from.lon, to.lat, to.lon),
    assumptions: [`great-circle ${(d / 1000).toFixed(0)} km (WGS84 geodesic)`, `route factor ${routeFactor}`, `nominal cruise ${CRUISE_MPS[aircraft]} m/s`, `${overhead / 60} min taxi/climb/descent`, 'no winds (no licensed live feed)', 'fictional schedule'],
  };
}

export type FlightPhase = 'TAXI' | 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCENT' | 'APPROACH' | 'LANDED';

export function phaseAt(elapsed: number, total: number): { phase: FlightPhase; altitudeM: number; progress: number } {
  const taxi = 420, takeoff = 60, climb = 1200, descent = 1500, approach = 420;
  const cruiseAlt = 11000;
  if (elapsed < taxi) return { phase: 'TAXI', altitudeM: 0, progress: 0 };
  if (elapsed < taxi + takeoff) return { phase: 'TAKEOFF', altitudeM: ((elapsed - taxi) / takeoff) * 300, progress: 0 };
  const flyTotal = Math.max(1, total - taxi - takeoff - 120);
  const fe = elapsed - taxi - takeoff;
  const progress = Math.min(1, fe / flyTotal);
  if (elapsed >= total - 120) return { phase: 'LANDED', altitudeM: 0, progress: 1 };
  if (fe < climb) return { phase: 'CLIMB', altitudeM: 300 + (fe / climb) * (cruiseAlt - 300), progress };
  if (fe > flyTotal - approach) return { phase: 'APPROACH', altitudeM: Math.max(0, ((flyTotal - fe) / approach) * 900), progress };
  if (fe > flyTotal - approach - descent) return { phase: 'DESCENT', altitudeM: 900 + ((flyTotal - approach - fe) / descent) * (cruiseAlt - 900), progress };
  return { phase: 'CRUISE', altitudeM: cruiseAlt, progress };
}

export function positionAt(leg: Leg, elapsed: number) {
  const ph = phaseAt(elapsed, leg.scheduledDurationS);
  const p = intermediatePoint(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon, ph.progress);
  return { ...p, ...ph };
}

// ---------------------------------------------------------------- journey clock
export interface ScaleChange { atRealMs: number; atJourneyS: number; scale: number; reason: string }

/**
 * Journey clock anchored to absolute real time. Elapsed journey time is a
 * piecewise-linear function of real time with user-chosen scales; it survives
 * suspension (closed-form progress from wall time, no frames required) and never
 * exceeds the scheduled duration (arrival cannot precede the travel clock).
 */
export class JourneyClock {
  readonly changes: ScaleChange[];
  constructor(readonly startRealMs: number, readonly durationS: number, scale = 1) {
    this.changes = [{ atRealMs: startRealMs, atJourneyS: 0, scale, reason: 'start' }];
  }
  elapsed(nowRealMs: number): number {
    const c = this.changes[this.changes.length - 1]!;
    return Math.min(this.durationS, c.atJourneyS + ((nowRealMs - c.atRealMs) / 1000) * c.scale);
  }
  setScale(nowRealMs: number, scale: number, reason = 'user'): void {
    if (!(scale >= 1 && scale <= 3600)) throw new RangeError('scale must be in [1, 3600]');
    this.changes.push({ atRealMs: nowRealMs, atJourneyS: this.elapsed(nowRealMs), scale, reason });
  }
  get scale(): number { return this.changes[this.changes.length - 1]!.scale; }
  done(nowRealMs: number): boolean { return this.elapsed(nowRealMs) >= this.durationS; }
  toJSON() { return { startRealMs: this.startRealMs, durationS: this.durationS, changes: this.changes }; }
  static fromJSON(j: ReturnType<JourneyClock['toJSON']>): JourneyClock {
    const c = new JourneyClock(j.startRealMs, j.durationS, j.changes[0]!.scale);
    c.changes.splice(0, 1, ...j.changes);
    return c;
  }
}

// ---------------------------------------------------------------- fictional departures
export interface Departure { flight: string; to: AirportRecord; departUtc: number; gate: string; status: 'ON TIME' | 'BOARDING' | 'DELAYED' | 'GATE CLOSED' | 'DEPARTED'; aircraft: AircraftType; fictional: true }

/** Deterministic fictional departures for an airport and UTC day. */
export function departuresFor(from: AirportRecord, all: AirportRecord[], dayUtcMs: number, count = 8, nowUtc = dayUtcMs): Departure[] {
  const rnd = mulberry32(fnv1a(`${from.icao}:${Math.floor(dayUtcMs / 86400000)}`));
  const large = all.filter((a) => a.type === 'large' && a.icao !== from.icao);
  const featured = ['EGLL', 'OMDB', 'RJTT', 'YSSY', 'SBGR', 'FAOR', 'KLAX', 'LFPG'].map((i) => large.find((a) => a.icao === i)).filter(Boolean) as AirportRecord[];
  const out: Departure[] = [];
  const start = nowUtc - 20 * 60000;
  for (let i = 0; i < count; i++) {
    const to = i < featured.length && rnd() < 0.8 ? featured[i]! : large[Math.floor(rnd() * large.length)]!;
    const d = geodesicDistance(from.lat, from.lon, to.lat, to.lon);
    const aircraft: AircraftType = d > 4_000_000 ? 'widebody' : d > 1_200_000 ? 'narrowbody' : 'regional';
    const departUtc = Math.round((start + i * (14 + Math.floor(rnd() * 16)) * 60000) / 60000) * 60000;
    const mins = (departUtc - nowUtc) / 60000;
    const delayed = rnd() < 0.15;
    const status: Departure['status'] = mins < -5 ? 'DEPARTED' : mins < 8 ? 'GATE CLOSED' : mins < 40 ? 'BOARDING' : delayed ? 'DELAYED' : 'ON TIME';
    out.push({ flight: `HD ${100 + Math.floor(rnd() * 800)}`, to, departUtc, gate: `${'ABC'[Math.floor(rnd() * 3)]}${1 + Math.floor(rnd() * 12)}`, status, aircraft, fictional: true });
  }
  return out.sort((a, b) => a.departUtc - b.departUtc);
}

export function makeProgram(actor: string, dep: Departure, from: AirportRecord): TravelProgram {
  const est = estimateDuration(from, dep.to, dep.aircraft);
  return {
    id: `trip:${actor}:${dep.flight.replace(' ', '')}:${dep.departUtc}`, actor, state: 'OFFERED', ticket: null, history: [],
    leg: { flight: dep.flight, from, to: dep.to, aircraft: dep.aircraft, departUtc: dep.departUtc, scheduledDurationS: est.seconds, assumptions: est.assumptions },
    sourceEvidence: { airports: 'OurAirports (public domain, no accuracy guarantee)', schedule: 'fictional, generated', interior: 'author-composed' },
  };
}

export function issueTicket(p: TravelProgram, cls: Seat['cls'] = 'economy'): TravelProgram {
  if (p.ticket) return p; // idempotent: never duplicate tickets
  return { ...p, ticket: { id: `TKT-${fnv1a(p.id).toString(36).toUpperCase()}`, holder: p.actor, flight: p.leg.flight, seat: null, cls, fictional: true } };
}
