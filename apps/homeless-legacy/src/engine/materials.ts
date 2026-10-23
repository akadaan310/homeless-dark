// Chromastratum material library. Scene-linear PBR (MeshStandard/Physical), licensed
// CC0 maps with explicit colour spaces, and two shader patches:
//  1. wetness/puddles: same formulas as @dark/visual-grammar wetMaterial(), driven by
//     the BORNE wetness node; puddles only where an authored depression field is high.
//  2. façade windows: a typed bay/floor grid (FacadeGrammar parameters per vertex) that
//     yields glass (low roughness, env reflections) and night-lit windows from the
//     World Loom weave pattern. A projection of the façade program, not a texture photo.
import * as THREE from 'three';
import { pbrSet } from './assets';

export const weather = {
  uWetness: { value: 0 },
  uPuddle: { value: 0 },
  uNight: { value: 0 }, // 0 day … 1 night (window lights)
  uTime: { value: 0 },
};

const DEPRESSION_GLSL = /* glsl */ `
float darkHash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float darkNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(darkHash(i),darkHash(i+vec2(1,0)),f.x), mix(darkHash(i+vec2(0,1)),darkHash(i+vec2(1,1)),f.x), f.y); }
float darkDepression(vec2 p){ return 0.55*darkNoise(p*0.18) + 0.3*darkNoise(p*0.61+3.1) + 0.15*darkNoise(p*1.7+7.3); }
`;

function patchWorldPos(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDarkWorld;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 darkWp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        darkWp = instanceMatrix * darkWp;
      #endif
      vDarkWorld = (modelMatrix * darkWp).xyz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vDarkWorld;\n${DEPRESSION_GLSL}`);
}

/** Wet-capable ground material (asphalt, concrete, paving). `puddles` false for raised sidewalks. */
export function wetSurface(id: string, opts: { repeat?: number; tint?: THREE.ColorRepresentation; roughness?: number; puddles?: boolean } = {}): THREE.MeshStandardMaterial {
  const set = pbrSet(id, { repeat: opts.repeat ?? 1, ao: false, anisotropy: 8 });
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, color: opts.tint ?? 0xffffff, roughness: opts.roughness ?? 1, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9) });
  const puddles = opts.puddles !== false;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, weather);
    patchWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWetness; uniform float uPuddle;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float darkDep = darkDepression(vDarkWorld.xz);
        float darkFilm = uWetness * (0.65 + 0.35 * darkDep);
        float darkCover = ${puddles ? 'clamp((darkDep - 0.55) * 3.0, 0.0, 1.0) * uPuddle' : '0.0'};
        diffuseColor.rgb *= (1.0 - 0.35 * darkFilm) * (1.0 - 0.25 * darkCover);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = max(0.04, roughnessFactor * (1.0 - 0.75 * darkFilm) * (1.0 - darkCover) + 0.04 * darkCover);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, clamp(darkCover * 1.2 + darkFilm * 0.3, 0.0, 1.0)));`);
  };
  m.customProgramCacheKey = () => `wet-${id}-${puddles}`;
  return m;
}

export interface FacadeMaterialOpts { id: 'stucco' | 'plaster' | 'bricks' | 'concrete'; repeatM: number }

/**
 * Façade material: per-vertex attributes aFacade = (bayWidth, floorHeight, seed, commercial)
 * and UVs in metres (u along wall, v up). Windows are glass (roughness 0.06, env
 * reflections); lit windows at night follow a weave bit pattern supplied by seed.
 */
export function facadeMaterial(o: FacadeMaterialOpts): THREE.MeshStandardMaterial {
  const set = pbrSet(o.id, { repeat: 1, anisotropy: 8 });
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, weather, { uRepeat: { value: 1 / o.repeatM } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFacade; varying vec4 vFacade; varying vec2 vWallUv; uniform float uRepeat;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacade = aFacade; vWallUv = uv;\n#ifdef USE_MAP\nvMapUv = uv * uRepeat;\n#endif\n#ifdef USE_NORMALMAP\nvNormalMapUv = uv * uRepeat;\n#endif\n#ifdef USE_ROUGHNESSMAP\nvRoughnessMapUv = uv * uRepeat;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uWetness; varying vec4 vFacade; varying vec2 vWallUv;
        float facHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float bay = max(2.0, vFacade.x), flo = max(2.6, vFacade.y);
        vec2 cell = vec2(floor(vWallUv.x / bay), floor(vWallUv.y / flo));
        vec2 f = vec2(fract(vWallUv.x / bay), fract(vWallUv.y / flo));
        bool ground = vWallUv.y < flo;
        bool roofline = vWallUv.y < 0.0;
        float wx = ground && vFacade.w > 0.5 ? step(0.08, f.x) * step(f.x, 0.92) * step(0.08, f.y) * step(f.y, 0.82)
                                            : step(0.28, f.x) * step(f.x, 0.72) * step(0.32, f.y) * step(f.y, 0.82);
        float frame = ground && vFacade.w > 0.5 ? 0.0 : (step(0.25, f.x) * step(f.x, 0.75) * step(0.29, f.y) * step(f.y, 0.85)) - wx;
        float isGlass = roofline ? 0.0 : wx;
        float lit = step(0.52, facHash(cell + vFacade.z)) * uNight;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.022, 0.03), isGlass);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.05), clamp(frame, 0.0, 1.0));
        float darkGlass = isGlass;
        float darkLit = isGlass * lit;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * (1.0 - 0.5 * uWetness), 0.06, darkGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += darkLit * vec3(1.0, 0.6, 0.28) * (ground ? 0.5 : 0.22) * (0.6 + 0.4 * facHash(cell * 1.7 + vFacade.z));`);
  };
  m.customProgramCacheKey = () => `facade-${o.id}`;
  return m;
}

export const MAT = {
  curb: () => new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.85 }),
  laneWhite: () => new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }),
  laneYellow: () => new THREE.MeshStandardMaterial({ color: 0xd9a92e, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 }),
  metal: (c = 0x2d3035) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: 0.85 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0x9fb4c0, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.2 }),
  fabric: (c: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, side: THREE.DoubleSide }),
  emissive: (c: THREE.ColorRepresentation, i = 2) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: i, roughness: 0.5 }),
};
