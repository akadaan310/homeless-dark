// Division V: interval geometry and MusicClock.
// Port of Substrate University src/math/music.ts ([K] Tymoczko 2011; Lewin 1987):
// stepping by k semitones visits the cyclic subgroup ⟨k⟩ ⊆ ℤ/12 of size 12/gcd(12,k).
// [C] MusicClock: deterministic motif scheduling from an orbit on a fixed beat grid.

const mod = (a: number, n: number) => ((a % n) + n) % n;
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export function orbit(start: number, k: number, n = 12): number[] {
  const out: number[] = [];
  let x = mod(start, n);
  do { out.push(x); x = mod(x + k, n); } while (x !== mod(start, n) && out.length <= n);
  return out;
}
export function orbitLength(k: number, n = 12): number { const g = gcd(mod(k, n), n); return n / (g === 0 ? n : g); }
export const frequency = (midi: number, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const cents = (ratio: number) => 1200 * Math.log2(ratio);
export const intervalHue = (k: number) => (mod(k, 12) * 30) % 360;

export interface MotifNote { beat: number; midi: number; hz: number; velocity: number }

/** A motif: walk the orbit ⟨k⟩ from a root, one note per beat, folded into a two-octave window. */
export function motif(rootMidi: number, k: number, beats = 8): MotifNote[] {
  const o = orbit(0, k);
  return Array.from({ length: beats }, (_, i) => {
    const pc = o[i % o.length]!;
    const midi = rootMidi + pc + (i % (o.length * 2) >= o.length ? 12 : 0);
    return { beat: i, midi, hz: frequency(midi), velocity: i % 4 === 0 ? 0.9 : 0.6 };
  });
}

/** Schedule motif notes on an absolute timebase (e.g. AudioContext.currentTime). */
export function schedule(notes: MotifNote[], startTime: number, tempoBpm: number): { t: number; hz: number; velocity: number }[] {
  const spb = 60 / tempoBpm;
  return notes.map((n) => ({ t: startTime + n.beat * spb, hz: n.hz, velocity: n.velocity }));
}
