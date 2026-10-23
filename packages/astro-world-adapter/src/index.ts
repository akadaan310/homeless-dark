// ASTRO ↔ world authority boundary (§001–§010, §041, §100–§102). ASTRO observes committed
// state and projects it; it never writes authority. Proposals travel only as events
// through the world's own commit() (the MotionAndEventGrammar admits or refuses them).

export type LensId = 'player' | 'stereo' | 'anaglyph' | 'globe' | 'sky' | 'pixel' | 'glyph';
export const LENSES: readonly LensId[] = ['player', 'stereo', 'anaglyph', 'globe', 'sky', 'pixel', 'glyph'];

/** Read-only, shareable view address: homeless:view/<region>/<lens>@<utc>?lat=…&lon=…&yaw=…&pitch=… */
export interface ViewAddress { region: string; lens: LensId; utc: string; lat: number; lon: number; yaw: number; pitch: number }

export function formatView(v: ViewAddress): string {
  const n = (x: number, d: number) => (Math.round(x * 10 ** d) / 10 ** d).toString();
  return `homeless:view/${encodeURIComponent(v.region)}/${v.lens}@${v.utc}?lat=${n(v.lat, 6)}&lon=${n(v.lon, 6)}&yaw=${n(v.yaw, 4)}&pitch=${n(v.pitch, 4)}`;
}
export function parseView(s: string): { ok: true; view: ViewAddress } | { ok: false; reason: string } {
  const m = /^homeless:view\/([^/]+)\/([a-z]+)@([0-9T:\-.Z]+)\?(.*)$/.exec(s);
  if (!m) return { ok: false, reason: 'not a homeless:view address' };
  const lens = m[2] as LensId;
  if (!LENSES.includes(lens)) return { ok: false, reason: `unknown lens ${m[2]}` };
  if (Number.isNaN(Date.parse(m[3]!))) return { ok: false, reason: 'bad UTC instant' };
  const q = new URLSearchParams(m[4]);
  const num = (k: string) => Number(q.get(k));
  const view: ViewAddress = { region: decodeURIComponent(m[1]!), lens, utc: m[3]!, lat: num('lat'), lon: num('lon'), yaw: num('yaw'), pitch: num('pitch') };
  if (!(Math.abs(view.lat) <= 90 && Math.abs(view.lon) <= 180) || ![view.yaw, view.pitch].every(Number.isFinite)) return { ok: false, reason: 'coordinates out of range' };
  for (const k of q.keys()) if (!['lat', 'lon', 'yaw', 'pitch'].includes(k)) return { ok: false, reason: `view addresses are read-only: parameter ${k} not allowed` };
  return { ok: true, view };
}

/** Minimal shape of the authority ASTRO may observe (dark-core WorldAuthority satisfies it). */
export interface ObservableWorld { journal: readonly { id: string; type: string; actor: string; tick: number; payload: unknown }[]; tick?: number }

export interface Projection { journalLength: number; lastEventId: string | null; digest: string; observedAt: number }
const fnv = (s: string, h = 0x811c9dc5) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h; };

/** Canonical event-log digest (timing-free): type, actor, tick, payload — the replay identity. */
export function journalDigest(j: ObservableWorld['journal'], opts: { ignoreTypes?: string[]; ignorePayloadKeys?: string[] } = {}): string {
  let h = 0x811c9dc5;
  const skip = new Set(opts.ignoreTypes ?? []), pk = new Set(opts.ignorePayloadKeys ?? []);
  for (const e of j) {
    if (skip.has(e.type)) continue;
    const payload = e.payload && typeof e.payload === 'object' ? Object.fromEntries(Object.entries(e.payload as Record<string, unknown>).filter(([k]) => !pk.has(k)).sort(([a], [b]) => (a < b ? -1 : 1))) : e.payload;
    h = fnv(`${e.type}|${e.actor}|${e.tick}|${JSON.stringify(payload)}`, h);
  }
  return h.toString(16).padStart(8, '0');
}

export function observe(w: ObservableWorld, now = 0): Projection {
  const last = w.journal[w.journal.length - 1];
  return { journalLength: w.journal.length, lastEventId: last?.id ?? null, digest: journalDigest(w.journal), observedAt: now };
}

/** Compare two event logs (e.g. legacy Three oracle vs ASTRO build). Returns the first divergence. */
export function compareJournals(a: ObservableWorld['journal'], b: ObservableWorld['journal'], opts: Parameters<typeof journalDigest>[1] = {}) {
  const skip = new Set(opts.ignoreTypes ?? []);
  const fa = a.filter((e) => !skip.has(e.type)), fb = b.filter((e) => !skip.has(e.type));
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) {
    const x = fa[i]!, y = fb[i]!;
    if (journalDigest([x], opts) !== journalDigest([y], opts)) return { equal: false as const, index: i, a: x, b: y, lengths: [fa.length, fb.length] };
  }
  if (fa.length !== fb.length) return { equal: false as const, index: n, a: fa[n] ?? null, b: fb[n] ?? null, lengths: [fa.length, fb.length] };
  return { equal: true as const, digest: journalDigest(fa, opts), length: fa.length };
}

/** A render-side request to change the world must become an event proposal, never a write. */
export interface EventProposal { type: string; actor: string; payload: Record<string, unknown>; source: 'astro-projection' }
export function propose(commit: (ev: Omit<EventProposal, 'source'>) => unknown, p: EventProposal): unknown {
  if (p.source !== 'astro-projection') throw new Error('only ASTRO projections may propose through this adapter');
  return commit({ type: p.type, actor: p.actor, payload: p.payload });
}
