// Evidence schemas (§006, §051, §111, §120) and the runtime public interfaces of the commission.
export type Epistemic = 'observed' | 'source_derived' | 'measured' | 'simulation' | 'abstract' | 'hypothesis' | 'unknown' | 'rejected';
export type GateStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

export interface PixelFieldWitness {
  x: number; y: number; resolution: [number, number]; t: number; model: string; gridId: string;
  fieldVersion: string; inputEventId: string | null; stateDigest: string; epistemic: Epistemic;
}

export interface SubjectAdapterV4 {
  subjectId: string; division: 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'; sourceSha: string; epistemic: Epistemic; evaluate: (payload: unknown) => unknown;
}

export interface ScreenshotWitness {
  file: string; sha256: string; commit: string; backend: 'webgl2' | 'webgpu' | 'legacy-three';
  device: string; renderer: string; resolution: [number, number]; scene: string; shaderDigest: string; at: string;
}

export interface GateRecord { id: string; section: number; status: GateStatus; evidence: string[]; command?: string; note?: string }

/** Validate a PixelFieldWitness without allocating per-pixel objects (it is a sample record). */
export function validatePixelWitness(w: unknown): string[] {
  const e: string[] = [];
  const o = w as Record<string, unknown>;
  if (typeof o !== 'object' || !o) return ['not an object'];
  for (const k of ['x', 'y', 't']) if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number)) e.push(`${k} must be finite`);
  if (typeof o.x === 'number' && (o.x < 0 || !Number.isInteger(o.x))) e.push('x must be a non-negative integer');
  if (typeof o.y === 'number' && (o.y < 0 || !Number.isInteger(o.y))) e.push('y must be a non-negative integer');
  if (!Array.isArray(o.resolution) || o.resolution.length !== 2) e.push('resolution [w,h] required');
  else if ((o.x as number) >= (o.resolution[0] as number) || (o.y as number) >= (o.resolution[1] as number)) e.push('sample outside resolution');
  for (const k of ['model', 'gridId', 'fieldVersion', 'stateDigest', 'epistemic']) if (typeof o[k] !== 'string') e.push(`${k} must be a string`);
  if (!(o.inputEventId === null || typeof o.inputEventId === 'string')) e.push('inputEventId must be string|null');
  return e;
}
