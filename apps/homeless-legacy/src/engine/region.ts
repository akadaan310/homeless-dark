import type * as THREE from 'three';
import type { SurfaceKind } from '@dark/somatostratum';
import type { Engine } from './engine';

export type RegionKind = 'street' | 'coarse' | 'airport' | 'cabin' | 'harbor' | 'pilot';

export interface Interactable {
  id: string;
  label: string;
  pos: THREE.Vector3;
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
  group: THREE.Group;
  surfaces: Map<number, SurfaceKind>;
  spawn: THREE.Vector3;
  spawnYaw: number;
  sourceLabels: SourceLabel[];
  interiors: THREE.Box3[];
  /** When the player is not on foot the region can own control (car, aircraft, boat). */
  controlsPlayer?(): boolean;
  fixed?(h: number, e: Engine): void;
  frame?(dt: number, e: Engine): void;
  interactables(e: Engine): Interactable[];
  obstacles?(): THREE.Vector3[];
  focus?(): { pos: THREE.Vector3; heading?: number; eye?: THREE.Vector3; quat?: THREE.Quaternion; mode: 'vehicle' | 'cabin' | 'cockpit' | 'follow' } | null;
  hudExtra?(): Record<string, unknown>;
  dispose(): void;
}
