import type { Vec3, Group, Box3, Quat } from '@astro/core';
import type { SurfaceKind } from '@dark/somatostratum';
import type { Engine } from './engine';

export type RegionKind = 'street' | 'coarse' | 'airport' | 'cabin' | 'harbor' | 'pilot';

export interface Interactable {
  id: string;
  label: string;
  pos: Vec3;
  radius: number;
  key?: 'interact' | 'vehicle';
  action(e: Engine): void;
}

export interface SourceLabel { id: string; status: 'verified' | 'derived' | 'authored' | 'unavailable'; note: string }

/** A loaded place. The engine owns one at a time; switching rebuilds physics. */
export interface Region {
  id: string;
  kind: RegionKind;
  name: string;
  lat: number;
  lon: number;
  group: Group;
  surfaces: Map<number, SurfaceKind>;
  spawn: Vec3;
  spawnYaw: number;
  sourceLabels: SourceLabel[];
  interiors: Box3[];
  /** When the player is not on foot the region can own control (car, aircraft, boat). */
  controlsPlayer?(): boolean;
  fixed?(h: number, e: Engine): void;
  frame?(dt: number, e: Engine): void;
  interactables(e: Engine): Interactable[];
  obstacles?(): Vec3[];
  focus?(): { pos: Vec3; heading?: number; eye?: Vec3; quat?: Quat; mode: 'vehicle' | 'cabin' | 'cockpit' | 'follow' } | null;
  hudExtra?(): Record<string, unknown>;
  /** v4.1 fields: non-grass blockers for the grass mask and the humans whose soles touch the ground. */
  grass?: { blockers: import('@astro/core').Geometry[]; origin: [number, number]; size: number };
  contactHumans?(): import('./characters').Human[];
  dispose(): void;
}
