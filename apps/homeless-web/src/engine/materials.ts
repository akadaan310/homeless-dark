// Chromastratum material library on ASTRO. Scene-linear PBR materials, licensed CC0 maps
// with explicit colour spaces, and two typed renderer features (no shader string patching):
//  1. 'wet': wetness/puddles with the same formulas as @dark/visual-grammar wetMaterial(),
//     driven by the BORNE wetness node; puddles only where the depression field is high.
//  2. 'facade': a typed bay/floor grid (FacadeGrammar parameters per vertex) that yields glass
//     (low roughness, sky reflections) and night-lit windows from the World Loom weave
//     pattern. A projection of the façade program, not a texture photo.
import { Material, type ColorLike } from '@astro/core';
import { pbrSet } from './assets';

/** Feature uniforms shared by every program; the renderer uploads them once per frame. */
export const weather = {
  uWetness: { value: 0 },
  uPuddle: { value: 0 },
  uNight: { value: 0 }, // 0 day … 1 night (window lights)
  uTime: { value: 0 },
};

/** Wet-capable ground material (asphalt, concrete, paving). `puddles` false for raised sidewalks. */
export function wetSurface(id: string, opts: { repeat?: number; tint?: ColorLike; roughness?: number; puddles?: boolean } = {}): Material {
  const set = pbrSet(id, { repeat: opts.repeat ?? 1, ao: false, anisotropy: 8 });
  const m = new Material({ feature: 'wet', map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, color: opts.tint ?? 0xffffff, roughness: opts.roughness ?? 1, metalness: 0, normalScale: 0.9, name: `wet-${id}` });
  m.uniforms.uPuddles = opts.puddles !== false ? 1 : 0;
  return m;
}

export interface FacadeMaterialOpts { id: 'stucco' | 'plaster' | 'bricks' | 'concrete'; repeatM: number }

/**
 * Façade material: per-vertex attributes aFacade = (bayWidth, floorHeight, seed, commercial)
 * and UVs in metres (u along wall, v up). Windows are glass (roughness 0.06, sky
 * reflections); lit windows at night follow a weave bit pattern supplied by seed.
 */
export function facadeMaterial(o: FacadeMaterialOpts): Material {
  const set = pbrSet(o.id, { repeat: 1, anisotropy: 8 });
  return new Material({ feature: 'facade', map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, vertexColors: true, roughness: 1, metalness: 0, uvScale: 1 / o.repeatM, name: `facade-${o.id}` });
}

export const MAT = {
  curb: () => new Material({ color: 0xb9b4aa, roughness: 0.85, name: 'curb' }),
  laneWhite: () => new Material({ color: 0xe8e6df, roughness: 0.6, polygonOffset: -4, name: 'lane-white' }),
  laneYellow: () => new Material({ color: 0xd9a92e, roughness: 0.6, polygonOffset: -4, name: 'lane-yellow' }),
  metal: (c: ColorLike = 0x2d3035) => new Material({ color: c, roughness: 0.38, metalness: 0.85, name: 'metal' }),
  glass: () => new Material({ color: 0x9fb4c0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, envIntensity: 1.2, name: 'glass' }),
  fabric: (c: ColorLike) => new Material({ color: c, roughness: 0.92, side: 'double', name: 'fabric' }),
  emissive: (c: ColorLike, i = 2) => new Material({ color: 0x111111, emissive: c, emissiveIntensity: i, roughness: 0.5, name: 'emissive' }),
};

/** Copy the shared feature uniforms into the renderer (called once per frame). */
export function applyWeather(globals: Record<string, number>) {
  globals.uWetness = weather.uWetness.value;
  globals.uPuddle = weather.uPuddle.value;
  globals.uNight = weather.uNight.value;
  globals.uTime = weather.uTime.value;
}
