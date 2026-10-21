// Deterministic keyed randomness and canonical hashing.

/** mulberry32 PRNG (public-domain, Tommy Ettinger). Deterministic for a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit over a UTF-16 string. Integrity fingerprint, NOT a cryptographic hash. */
export function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64-bit-ish fingerprint as 16 hex chars from two independent FNV lanes. */
export function fingerprint(s: string): string {
  return fnv1a(s).toString(16).padStart(8, '0') + fnv1a(s, 0x9747b28c).toString(16).padStart(8, '0');
}

/** Keyed random stream: same (key, n) always yields the same number. */
export function keyedRandom(key: string): () => number {
  return mulberry32(fnv1a(key));
}

/** Canonical JSON: sorted keys, no whitespace; used for event hashing and signatures. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
