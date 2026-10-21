// dark-core/clock9: grammar-clocked n-gram PROPOSAL engine.
//
// [K] n-gram language models with add-k smoothing; seeded sampling.
// [C] CLOCK9 discipline (DARK/Substrate University construction): proposals are
//     drawn on a fixed clock of 9 slots per cycle; a proposal is only a candidate
//     — the typed compiler and the world authority decide whether it executes.
// The original CLOCK9 sources (22 recorded checks) are not mounted in this
// repository; this module is a fresh port of the described contract with its own
// tests, not an equivalence proof.

import { mulberry32 } from './util';

export const CLOCK9_SLOTS = 9;

export class NGramModel {
  private counts = new Map<string, Map<string, number>>();
  readonly vocab = new Set<string>();
  constructor(readonly n = 3, readonly k = 0.1) {
    if (n < 1 || n > 6) throw new RangeError('n must be in [1, 6]');
  }

  train(sequences: string[][]): this {
    for (const seq of sequences) {
      const s = [...Array(this.n - 1).fill('<s>'), ...seq, '</s>'];
      for (const t of seq) this.vocab.add(t);
      this.vocab.add('</s>');
      for (let i = this.n - 1; i < s.length; i++) {
        const ctx = s.slice(i - this.n + 1, i).join(' ');
        const m = this.counts.get(ctx) ?? new Map<string, number>();
        m.set(s[i]!, (m.get(s[i]!) ?? 0) + 1);
        this.counts.set(ctx, m);
      }
    }
    return this;
  }

  /** Smoothed conditional distribution P(next | context). */
  distribution(context: string[]): [string, number][] {
    const ctx = [...Array(this.n - 1).fill('<s>'), ...context].slice(-(this.n - 1)).join(' ');
    const m = this.counts.get(ctx) ?? new Map<string, number>();
    const total = [...m.values()].reduce((a, b) => a + b, 0) + this.k * this.vocab.size;
    return [...this.vocab].sort().map((t) => [t, ((m.get(t) ?? 0) + this.k) / total] as [string, number]);
  }

  /** Deterministic proposal for a seed; bounded length. */
  propose(seed: number, maxLen = 12, prefix: string[] = []): string[] {
    const rnd = mulberry32(seed);
    const out = [...prefix];
    while (out.length < maxLen) {
      const dist = this.distribution(out);
      let r = rnd(), pick = dist[dist.length - 1]![0];
      for (const [t, p] of dist) { r -= p; if (r <= 0) { pick = t; break; } }
      if (pick === '</s>') break;
      out.push(pick);
    }
    return out;
  }

  perplexity(seq: string[]): number {
    let logp = 0;
    const s = [...seq, '</s>'];
    for (let i = 0; i < s.length; i++) logp += Math.log(this.distribution(s.slice(0, i)).find(([t]) => t === s[i])?.[1] ?? 1e-12);
    return Math.exp(-logp / s.length);
  }
}

export interface ClockedProposal { slot: number; cycle: number; seed: number; tokens: string[] }

/** Clocked proposer: slot = tick mod 9; the seed derives from (cycle, slot, salt). */
export class Clock9Proposer {
  constructor(private model: NGramModel, private salt = 9) {}
  at(tick: number, prefix: string[] = [], maxLen = 12): ClockedProposal {
    const slot = ((tick % CLOCK9_SLOTS) + CLOCK9_SLOTS) % CLOCK9_SLOTS;
    const cycle = Math.floor(tick / CLOCK9_SLOTS);
    const seed = (cycle * 2654435761 + slot * 40503 + this.salt) >>> 0;
    return { slot, cycle, seed, tokens: this.model.propose(seed, maxLen, prefix) };
  }
}
