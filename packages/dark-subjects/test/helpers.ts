// Test helpers: re-export core primitives and a DARK-side formulation of the
// university Bridge Grammar check (two layers: realizability, then DFA admissibility).
export { WorldAuthority, BorneGraph, startFold, foldAll, unfoldAll, grammarSize } from '@dark/core';

const BRIDGES: [string, string, 'stone' | 'gold'][] = [['F', 'R', 'stone'], ['R', 'P', 'gold'], ['P', 'G', 'stone'], ['G', 'A', 'stone'], ['A', 'W', 'gold'], ['W', 'F', 'stone']];

export function evaluateBridgeWordForTest(word: string) {
  const L = word.toUpperCase().replace(/[^FRPGAW]/g, '').split('');
  let q = 0, realizable = true;
  for (let i = 1; i < L.length; i++) {
    const b = BRIDGES.find(([a, c]) => (a === L[i - 1] && c === L[i]) || (c === L[i - 1] && a === L[i]));
    if (!b) { realizable = false; continue; }
    q = q === 2 ? 2 : b[2] === 'gold' ? (q === 1 ? 2 : 1) : 0;
  }
  return { realizable, admissible: q !== 2 };
}
