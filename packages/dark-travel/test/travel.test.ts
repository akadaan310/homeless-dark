import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseAirports, nearestAirport, transition, makeCabin, assignSeat, estimateDuration, phaseAt, JourneyClock, departuresFor, makeProgram, issueTicket, type TravelEvent } from '../src';

const airports = parseAirports(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../apps/homeless-web/public/data/airports.json'), 'utf8')));
const by = (icao: string) => airports.find((a) => a.icao === icao)!;

describe('airport source data [M]', () => {
  it('Tampa anchor resolves to KTPA as nearest large airport', () => {
    const n = nearestAirport(airports, 27.9594638, -82.5054865)!;
    expect(n.airport.icao).toBe('KTPA');
    expect(n.distanceM).toBeLessThan(5000);
  });
  it('six continents have large airports (global addressability of travel)', () => {
    for (const icao of ['EGLL', 'OMDB', 'RJTT', 'YSSY', 'SBGR', 'FAOR', 'KLAX']) expect(by(icao)).toBeTruthy();
  });
});

describe('TravelProgram grammar [M]', () => {
  const dep = departuresFor(by('KTPA'), airports, Date.UTC(2026, 9, 21), 8, Date.UTC(2026, 9, 21, 20))[0]!;
  it('walks the full grammar OFFERED → ARRIVED with a held boarding', () => {
    let p = issueTicket(makeProgram('player', dep, by('KTPA')));
    expect(issueTicket(p).ticket!.id).toBe(p.ticket!.id); // no duplicate tickets
    const seq: TravelEvent[] = ['accept', 'check_in', 'enter_lounge', 'call_boarding', 'hold', 'resume'];
    for (const e of seq) { const r = transition(p, e, 0); expect(r.ok).toBe(true); if (r.ok) p = r.program; }
    expect(transition(p, 'take_seat', 0).ok).toBe(false); // seat not assigned
    p = { ...p, ticket: { ...p.ticket!, seat: '14A' } };
    for (const e of ['take_seat', 'pushback', 'rotate', 'level_off', 'begin_descent', 'touchdown', 'disembark', 'arrive'] as TravelEvent[]) {
      const r = transition(p, e, 0); expect(r.ok).toBe(true); if (r.ok) p = r.program;
    }
    expect(p.state).toBe('ARRIVED');
    expect(transition(p, 'rotate', 0).ok).toBe(false);
  });
  it('declines and cancellations are valid world responses', () => {
    const p = makeProgram('player', dep, by('KTPA'));
    const d = transition(p, 'decline', 0);
    expect(d.ok && d.program.state).toBe('DECLINED');
  });
  it('seats are exclusive and a holder keeps at most one seat', () => {
    let seats = makeCabin(30);
    let r = assignSeat(seats, '14A', 'player'); expect(r.ok).toBe(true); if (r.ok) seats = r.seats;
    expect(assignSeat(seats, '14A', 'npc:bo').ok).toBe(false);
    r = assignSeat(seats, '20F', 'player'); if (r.ok) seats = r.seats;
    expect(seats.filter((s) => s.holder === 'player').map((s) => s.id)).toEqual(['20F']);
    expect(seats.find((s) => s.id === '14A')!.window).toBe(true);
  });
});

describe('journey clock and durations [M]', () => {
  it('LAX→DXB estimate is long-haul (~16 h band) and shows assumptions', () => {
    const e = estimateDuration(by('KLAX'), by('OMDB'), 'widebody');
    expect(e.seconds / 3600).toBeGreaterThan(14);
    expect(e.seconds / 3600).toBeLessThan(17.5);
    expect(e.assumptions.join(' ')).toMatch(/no winds/);
  });
  it('16-hour clock: 1× segment, 10× and 60× skips, suspension recovery, never exceeds duration', () => {
    const dur = 16 * 3600;
    const c = new JourneyClock(0, dur, 1);
    expect(c.elapsed(60_000)).toBeCloseTo(60, 6); // 1 min at 1×
    c.setScale(60_000, 10);
    expect(c.elapsed(120_000)).toBeCloseTo(660, 6);
    c.setScale(120_000, 60);
    // app backgrounded for 2 real hours: closed-form progress, no frames
    const resumed = JourneyClock.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(resumed.elapsed(120_000 + 2 * 3600_000)).toBe(dur); // capped: arrival not before clock allows
    expect(resumed.elapsed(120_000 + 600_000)).toBeCloseTo(660 + 600 * 60, 6);
    expect(() => c.setScale(0, 0.5)).toThrow();
    expect(c.changes.map((x) => x.scale)).toEqual([1, 10, 60]);
  });
  it('phases progress monotonically TAXI→…→LANDED', () => {
    const order = ['TAXI', 'TAKEOFF', 'CLIMB', 'CRUISE', 'DESCENT', 'APPROACH', 'LANDED'];
    let last = 0;
    for (let t = 0; t <= 20000; t += 30) { const i = order.indexOf(phaseAt(t, 20000).phase); expect(i).toBeGreaterThanOrEqual(last); last = i; }
    expect(last).toBe(6);
  });
  it('departures are deterministic per airport-day and fictional', () => {
    const a = departuresFor(by('KTPA'), airports, Date.UTC(2026, 9, 21));
    const b = departuresFor(by('KTPA'), airports, Date.UTC(2026, 9, 21));
    expect(a.map((d) => d.flight)).toEqual(b.map((d) => d.flight));
    expect(a.every((d) => d.fictional)).toBe(true);
  });
});
