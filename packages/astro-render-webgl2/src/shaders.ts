// ASTRO GLSL ES 3.00 sources. One forward "uber" program specialised by #defines from a
// finite variant key (§109), a depth program for shadow casters, an analytic sky that
// mirrors skyModel.ts, an equirect environment bake, bloom and the output transform.
// Written for this repository; no engine shader source is copied.

export const ATTR = { position: 0, normal: 1, uv: 2, color: 3, custom: 4, skinIndex: 5, skinWeight: 6, instance: 8 } as const;
export const UNIT = { map: 0, normalMap: 1, roughnessMap: 2, emissiveMap: 3, detailMap: 4, shadowMap: 5, envMap: 6, boneTex: 7 } as const;
export const MAX_POINT = 8, MAX_SPOT = 12;

const VERT_COMMON = /* glsl */ `
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec2 uv;
layout(location=3) in vec4 color;
layout(location=4) in vec4 aCustom;
#ifdef SKIN
layout(location=5) in vec4 skinIndex;
layout(location=6) in vec4 skinWeight;
uniform highp sampler2D boneTex;
mat4 boneAt(float i) { int b = int(i + 0.5) * 4; return mat4(texelFetch(boneTex, ivec2(b, 0), 0), texelFetch(boneTex, ivec2(b + 1, 0), 0), texelFetch(boneTex, ivec2(b + 2, 0), 0), texelFetch(boneTex, ivec2(b + 3, 0), 0)); }
#endif
#ifdef INSTANCED
layout(location=8) in mat4 instanceMatrix;
#endif
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
void localFrame(out vec4 p, out vec3 n) {
  p = vec4(position, 1.0); n = normal;
#ifdef SKIN
  mat4 sk = boneAt(skinIndex.x) * skinWeight.x + boneAt(skinIndex.y) * skinWeight.y + boneAt(skinIndex.z) * skinWeight.z + boneAt(skinIndex.w) * skinWeight.w;
  p = sk * p; n = mat3(sk) * n;
#endif
}
vec4 worldOf(vec4 p) {
#ifdef INSTANCED
  return modelMatrix * (instanceMatrix * p);
#else
  return modelMatrix * p;
#endif
}
vec3 worldNormalOf(vec3 n) {
#ifdef INSTANCED
  return normalize(normalMatrix * (mat3(instanceMatrix) * n));
#else
  return normalize(normalMatrix * n);
#endif
}
`;

export const FORWARD_VS = /* glsl */ `
${VERT_COMMON}
uniform vec2 uvRepeat;
uniform vec2 uvOffset;
uniform float uvScale;
uniform mat4 shadowMatrix;
uniform float shadowNormalBias;
uniform float pointSize;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec2 vRawUv;
out vec4 vColor;
out vec4 vCustom;
out vec3 vLocal;
out vec4 vShadow;
out float vViewDepth;
void main() {
  vec4 p; vec3 n;
  localFrame(p, n);
  vec4 wp = worldOf(p);
  vec3 wn = worldNormalOf(n);
  vWorld = wp.xyz; vNormal = wn; vLocal = position;
  vRawUv = uv;
  vUv = uv * uvScale * uvRepeat + uvOffset;
  vColor = color; vCustom = aCustom;
  vShadow = shadowMatrix * vec4(wp.xyz + wn * shadowNormalBias, 1.0);
  vec4 mv = viewMatrix * wp;
  vViewDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
#ifdef POINTS
  gl_PointSize = pointSize;
#endif
}
`;

const BRDF = /* glsl */ `
#define PI 3.141592653589793
float D_GGX(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float V_SmithCorrelated(float NoV, float NoL, float a) { float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-5); }
vec3 F_Schlick(vec3 f0, float VoH) { float f = pow(1.0 - VoH, 5.0); return f0 + (1.0 - f0) * f; }
vec2 envBRDFApprox(float NoV, float r) { const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022); const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04); vec4 rr = r * c0 + c1; float a004 = min(rr.x * rr.x, exp2(-9.28 * NoV)) * rr.x + rr.y; return vec2(-1.04, 1.04) * a004 + rr.zw; }
vec2 dirToEquirect(vec3 d) { return vec2(atan(d.x, -d.z) / (2.0 * PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }
`;

const TONEMAP = /* glsl */ `
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04; const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, newPeak * vec3(1.0), g);
}
vec3 acesFit(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toneMap(vec3 c, int op) { return op == 1 ? acesFit(c) : op == 2 ? clamp(c, 0.0, 1.0) : pbrNeutral(max(c, 0.0)); }
vec3 linearToSrgb(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
`;

export const FORWARD_FS = /* glsl */ `
${BRDF}
${TONEMAP}
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec2 vRawUv;
in vec4 vColor;
in vec4 vCustom;
in vec3 vLocal;
in vec4 vShadow;
in float vViewDepth;
out vec4 fragColor;
uniform vec3 baseColor;
uniform float opacity;
uniform float roughness;
uniform float metalness;
uniform vec3 emissive;
uniform float emissiveIntensity;
uniform float normalScale;
uniform float clearcoat;
uniform float clearcoatRoughness;
uniform float envIntensity;
uniform float alphaTest;
uniform sampler2D map;
uniform sampler2D normalMap;
uniform sampler2D roughnessMap;
uniform sampler2D emissiveMap;
uniform sampler2D detailMap;
uniform vec3 cameraPosition;
uniform vec3 sunDir; uniform vec3 sunRadiance;
uniform vec3 moonDir; uniform vec3 moonRadiance;
uniform vec3 hemiSky; uniform vec3 hemiGround;
uniform int numPoint;
uniform vec4 pointPos[${MAX_POINT}];
uniform vec4 pointColor[${MAX_POINT}];
uniform int numSpot;
uniform vec4 spotPos[${MAX_SPOT}];
uniform vec4 spotDir[${MAX_SPOT}];
uniform vec4 spotColor[${MAX_SPOT}];
uniform vec4 spotParams[${MAX_SPOT}];
uniform highp sampler2DShadow shadowMap;
uniform float shadowOn;
uniform vec2 shadowTexel;
uniform float shadowBias;
uniform sampler2D envMap;
uniform float envMaxLod;
uniform float envScale;
uniform vec3 sh[9];
uniform float sceneEnvIntensity;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float exposure;
uniform int toneOp;
uniform float uWetness; uniform float uPuddle; uniform float uNight; uniform float uTime;
uniform float uPuddles;
uniform float uFuselageHalf; uniform float uFuselageWin;

float darkHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float darkNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(darkHash(i), darkHash(i + vec2(1, 0)), f.x), mix(darkHash(i + vec2(0, 1)), darkHash(i + vec2(1, 1)), f.x), f.y); }
float darkDepression(vec2 p) { return 0.55 * darkNoise(p * 0.18) + 0.3 * darkNoise(p * 0.61 + 3.1) + 0.15 * darkNoise(p * 1.7 + 7.3); }
float facHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 shIrradiance(vec3 n) {
  return sh[0] * 0.886227 + sh[1] * 1.023328 * n.y + sh[2] * 1.023328 * n.z + sh[3] * 1.023328 * n.x
    + sh[4] * 0.858086 * n.x * n.y + sh[5] * 0.858086 * n.y * n.z + sh[6] * 0.247708 * (3.0 * n.z * n.z - 1.0)
    + sh[7] * 0.858086 * n.x * n.z + sh[8] * 0.429043 * (n.x * n.x - n.y * n.y);
}
float shadowFactor() {
  if (shadowOn < 0.5) return 1.0;
  vec3 p = vShadow.xyz / vShadow.w;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float z = p.z + shadowBias;
  vec2 t = shadowTexel;
  float s = texture(shadowMap, vec3(p.xy, z)) * 0.25;
  s += texture(shadowMap, vec3(p.xy + vec2(-t.x, -t.y) * 1.2, z)) * 0.125;
  s += texture(shadowMap, vec3(p.xy + vec2(t.x, -t.y) * 1.2, z)) * 0.125;
  s += texture(shadowMap, vec3(p.xy + vec2(-t.x, t.y) * 1.2, z)) * 0.125;
  s += texture(shadowMap, vec3(p.xy + vec2(t.x, t.y) * 1.2, z)) * 0.125;
  s += texture(shadowMap, vec3(p.xy + vec2(2.0 * t.x, 0.0), z)) * 0.0625;
  s += texture(shadowMap, vec3(p.xy + vec2(-2.0 * t.x, 0.0), z)) * 0.0625;
  s += texture(shadowMap, vec3(p.xy + vec2(0.0, 2.0 * t.y), z)) * 0.0625;
  s += texture(shadowMap, vec3(p.xy + vec2(0.0, -2.0 * t.y), z)) * 0.0625;
  return s;
}
// cotangent frame from screen-space derivatives (no stored tangents)
vec3 perturb(vec3 N, vec3 mapN, vec2 uvc) {
  vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
  vec2 duv1 = dFdx(uvc), duv2 = dFdy(uvc);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float det = max(dot(T, T), dot(B, B));
  float invmax = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(mat3(T * invmax, B * invmax, N) * mapN);
}
void direct(vec3 L, vec3 radiance, vec3 N, vec3 V, vec3 albedo, vec3 f0, float a, float cc, float ccA, inout vec3 diff, inout vec3 spec) {
  float NoL = clamp(dot(N, L), 0.0, 1.0);
  if (NoL <= 0.0) return;
  vec3 H = normalize(L + V);
  float NoV = clamp(abs(dot(N, V)), 1e-4, 1.0), NoH = clamp(dot(N, H), 0.0, 1.0), VoH = clamp(dot(V, H), 0.0, 1.0);
  vec3 irr = radiance * NoL;
  diff += irr * albedo * (1.0 / PI);
  spec += irr * F_Schlick(f0, VoH) * D_GGX(NoH, a) * V_SmithCorrelated(NoV, NoL, a);
  if (cc > 0.0) { float Fc = 0.04 + 0.96 * pow(1.0 - VoH, 5.0); spec += irr * cc * Fc * D_GGX(NoH, ccA) * V_SmithCorrelated(NoV, NoL, ccA); }
}
float distanceAtten(float d, float cutoff, float decay) {
  float a = 1.0 / max(pow(d, decay), 0.01);
  if (cutoff > 0.0) { float r = d / cutoff; a *= pow(clamp(1.0 - r * r * r * r, 0.0, 1.0), 2.0); }
  return a;
}
vec3 envSample(vec3 r, float rough) {
  return textureLod(envMap, dirToEquirect(r), rough * envMaxLod).rgb * envScale;
}
vec3 finish(vec3 c) {
#ifdef INLINE_TONEMAP
  return linearToSrgb(toneMap(c * exposure, toneOp));
#else
  return c;
#endif
}

void main() {
  vec4 albedo4 = vec4(baseColor, opacity);
  vec2 uvc = vUv;
#ifdef MAP
  vec4 tex = texture(map, uvc);
  albedo4 *= tex;
#endif
#ifdef VCOLOR
  albedo4.rgb *= vColor.rgb;
#endif
#ifdef FEATURE_TEXT
  float sd = texture(map, vUv).r;
  float w = max(fwidth(sd) * 0.7, 1e-4);
  float cover = smoothstep(0.5 - w, 0.5 + w, sd);
  albedo4 = vec4(baseColor, opacity * cover);
  if (albedo4.a < 0.01) discard;
#endif
#ifdef ALPHATEST
  if (albedo4.a < alphaTest) discard;
#endif
  vec3 albedo = albedo4.rgb;
  float alpha = albedo4.a;
  vec3 emission = emissive * emissiveIntensity;
#ifdef EMISSIVEMAP
  emission *= texture(emissiveMap, uvc).rgb;
#endif

#ifdef FEATURE_UNLIT
  vec3 c = albedo + emission;
#ifdef POINTS
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float pr = dot(pc, pc);
  if (pr > 1.0) discard;
  alpha *= 1.0 - pr;
#endif
  if (fogDensity > 0.0) { float f = 1.0 - exp(-fogDensity * fogDensity * vViewDepth * vViewDepth); c = mix(c, fogColor, clamp(f, 0.0, 1.0)); }
  fragColor = vec4(finish(c), alpha);
  return;
#else
  float rough = roughness;
#ifdef ROUGHMAP
  rough *= texture(roughnessMap, uvc).g;
#endif
  float metal = metalness;
  vec3 Ng = normalize(vNormal);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 N = Ng;
#ifdef FEATURE_WATER
  vec3 n1 = texture(normalMap, uvc + vec2(uTime * 0.004, uTime * 0.002)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(normalMap, uvc * 1.7 - vec2(uTime * 0.003, -uTime * 0.005)).xyz * 2.0 - 1.0;
  N = perturb(Ng, normalize(vec3((n1.xy + n2.xy) * normalScale, n1.z * n2.z)), uvc);
#else
#ifdef NORMALMAP
  vec3 mapN = texture(normalMap, uvc).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  N = perturb(Ng, normalize(mapN), uvc);
#endif
#endif
  float glass = 0.0;
#ifdef FEATURE_WET
  float darkDep = darkDepression(vWorld.xz);
  float darkFilm = uWetness * (0.65 + 0.35 * darkDep);
  float darkCover = clamp((darkDep - 0.55) * 3.0, 0.0, 1.0) * uPuddle * uPuddles;
  albedo *= (1.0 - 0.35 * darkFilm) * (1.0 - 0.25 * darkCover);
  rough = max(0.04, rough * (1.0 - 0.75 * darkFilm) * (1.0 - darkCover) + 0.04 * darkCover);
  N = normalize(mix(N, Ng, clamp(darkCover * 1.2 + darkFilm * 0.3, 0.0, 1.0)));
#endif
#ifdef FEATURE_FACADE
  {
    float bay = max(2.0, vCustom.x), flo = max(2.6, vCustom.y);
    vec2 cell = vec2(floor(vRawUv.x / bay), floor(vRawUv.y / flo));
    vec2 f = vec2(fract(vRawUv.x / bay), fract(vRawUv.y / flo));
    bool ground = vRawUv.y < flo;
    bool roofline = vRawUv.y < 0.0;
    float wx = ground && vCustom.w > 0.5 ? step(0.08, f.x) * step(f.x, 0.92) * step(0.08, f.y) * step(f.y, 0.82)
                                        : step(0.28, f.x) * step(f.x, 0.72) * step(0.32, f.y) * step(f.y, 0.82);
    float frame = ground && vCustom.w > 0.5 ? 0.0 : (step(0.25, f.x) * step(f.x, 0.75) * step(0.29, f.y) * step(f.y, 0.85)) - wx;
    glass = roofline ? 0.0 : wx;
    float lit = step(0.52, facHash(cell + vCustom.z)) * uNight;
    albedo = mix(albedo, vec3(0.018, 0.022, 0.03), glass);
    albedo = mix(albedo, vec3(0.06, 0.055, 0.05), clamp(frame, 0.0, 1.0));
    rough = mix(rough * (1.0 - 0.5 * uWetness), 0.06, glass);
    emission += glass * lit * vec3(1.0, 0.6, 0.28) * (ground ? 0.5 : 0.22) * (0.6 + 0.4 * facHash(cell * 1.7 + vCustom.z));
  }
#endif
#ifdef FEATURE_TERRAIN
  {
    vec3 sandC = texture(detailMap, uvc).rgb;
    albedo = mix(albedo * vec3(0.78, 0.86, 0.7), sandC, clamp(vCustom.x, 0.0, 1.0));
    albedo = mix(albedo, vec3(0.32, 0.3, 0.28) * (0.8 + 0.4 * sandC.r), clamp(vCustom.y, 0.0, 1.0));
    albedo = mix(albedo, vec3(0.86, 0.89, 0.93), clamp(vCustom.z, 0.0, 1.0));
  }
#endif
#ifdef FEATURE_WINDOWS
  {
    float zz = vLocal.z + uFuselageHalf;
    float side = abs(vLocal.x);
    float band = step(1.55, side) * step(abs(vLocal.y - 0.45), 0.24) * step(5.0, zz) * step(zz, uFuselageWin);
    float win = band * step(0.42, fract(zz / 0.82)) * step(fract(zz / 0.82), 0.82);
    float cockpit = step(zz, 2.6) * step(1.6, zz) * step(0.35, vLocal.y) * step(vLocal.y, 0.85);
    albedo = mix(albedo, vec3(0.03, 0.05, 0.07), clamp(win + cockpit, 0.0, 1.0));
  }
#endif
  rough = clamp(rough, 0.0525, 1.0);
  float a = rough * rough;
  vec3 diffColor = albedo * (1.0 - metal);
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 V = normalize(cameraPosition - vWorld);
  float ccA = max(0.0525, clearcoatRoughness); ccA *= ccA;
  vec3 diff = vec3(0.0), spec = vec3(0.0);
  float sh0 = shadowFactor();
  direct(sunDir, sunRadiance * sh0, N, V, diffColor, f0, a, clearcoat, ccA, diff, spec);
  direct(moonDir, moonRadiance, N, V, diffColor, f0, a, clearcoat, ccA, diff, spec);
  for (int i = 0; i < ${MAX_POINT}; i++) {
    if (i >= numPoint) break;
    vec3 Lv = pointPos[i].xyz - vWorld; float d = length(Lv);
    direct(Lv / max(d, 1e-4), pointColor[i].rgb * distanceAtten(d, pointPos[i].w, pointColor[i].w), N, V, diffColor, f0, a, clearcoat, ccA, diff, spec);
  }
  for (int i = 0; i < ${MAX_SPOT}; i++) {
    if (i >= numSpot) break;
    vec3 Lv = spotPos[i].xyz - vWorld; float d = length(Lv); vec3 L = Lv / max(d, 1e-4);
    float cd = dot(-L, spotDir[i].xyz);
    float cone = smoothstep(spotParams[i].z, spotParams[i].w, cd);
    if (cone <= 0.0) continue;
    direct(L, spotColor[i].rgb * cone * distanceAtten(d, spotParams[i].x, spotParams[i].y), N, V, diffColor, f0, a, clearcoat, ccA, diff, spec);
  }
  // ambient: hemisphere + SH sky irradiance; specular from the prefiltered equirect sky
  vec3 irr = mix(hemiGround, hemiSky, 0.5 + 0.5 * N.y) + shIrradiance(N) * sceneEnvIntensity * envIntensity;
  diff += irr * diffColor * (1.0 / PI);
  float NoV = clamp(abs(dot(N, V)), 1e-4, 1.0);
  vec3 R = reflect(-V, N);
  vec2 ab = envBRDFApprox(NoV, rough);
  vec3 envSpec = envSample(R, rough) * sceneEnvIntensity * envIntensity;
  // horizon occlusion: reflections below the geometric horizon are darkened
  float ho = clamp(1.0 + 1.3 * dot(R, Ng), 0.0, 1.0);
  spec += envSpec * (f0 * ab.x + ab.y) * ho * ho;
  if (clearcoat > 0.0) { float Fc = 0.04 + 0.96 * pow(1.0 - NoV, 5.0); spec += envSample(reflect(-V, Ng), sqrt(ccA)) * sceneEnvIntensity * envIntensity * clearcoat * Fc; }
  vec3 c = diff + spec + emission;
  if (fogDensity > 0.0) { float f = 1.0 - exp(-fogDensity * fogDensity * vViewDepth * vViewDepth); c = mix(c, fogColor, clamp(f, 0.0, 1.0)); }
  fragColor = vec4(finish(c), alpha);
#endif
}
`;

export const DEPTH_VS = /* glsl */ `
${VERT_COMMON}
out vec2 vUv;
void main() { vec4 p; vec3 n; localFrame(p, n); vUv = uv; gl_Position = projectionMatrix * viewMatrix * worldOf(p); }
`;
export const DEPTH_FS = /* glsl */ `
in vec2 vUv;
uniform sampler2D map;
uniform float alphaTest;
out vec4 fragColor;
void main() {
#ifdef ALPHATEST
  if (texture(map, vUv).a < alphaTest) discard;
#endif
  fragColor = vec4(1.0);
}
`;

export const FULLSCREEN_VS = /* glsl */ `
out vec2 vUv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0); }
`;

/** Sky radiance — the GLSL twin of skyModel.ts (keep in lock-step; unit tests cover the CPU side). */
const SKY_FN = /* glsl */ `
uniform vec3 skySunDir; uniform float skySunE; uniform float skyRayleigh; uniform float skyTurbidity; uniform float skyG;
uniform float skyCloud; uniform vec3 skyCloudColor; uniform float skyNight; uniform float skySunClamp;
const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
float airMass(float c) { c = max(0.0, c); float zDeg = degrees(acos(c)); return 1.0 / (c + 0.50572 * pow(max(0.0001, 96.07995 - zDeg), -1.6364)); }
vec3 skyRadiance(vec3 d, bool disc) {
  float dy = max(0.0, d.y);
  float mu = dot(d, skySunDir);
  float mView = airMass(dy), mSun = airMass(skySunDir.y);
  float sunUp = clamp((skySunDir.y + 0.1) / 0.16, 0.0, 1.0);
  float E = skySunE * sunUp * sunUp;
  float pr = (3.0 / (16.0 * PI)) * (1.0 + mu * mu);
  float g = skyG;
  float pm = ((1.0 - g * g) / (4.0 * PI)) / pow(max(1e-4, 1.0 + g * g - 2.0 * g * mu), 1.5);
  float bm = 21e-6 * (skyTurbidity / 6.0);
  vec3 br = BETA_R * skyRayleigh;
  vec3 tauView = br * 8000.0 * mView + bm * 1200.0 * mView;
  vec3 tauSun = br * 8000.0 * mSun + bm * 1200.0 * mSun;
  vec3 scatter = (br * pr + bm * pm) / (br + bm);
  vec3 L = E * scatter * (1.0 - exp(-tauView)) * exp(-0.5 * tauSun);
  if (disc) {
    float c0 = cos(0.00465 * 1.6), c1 = cos(0.00465);
    float k = clamp((mu - c0) / (c1 - c0), 0.0, 1.0);
    L += min(vec3(skySunClamp), E * 400.0 * k * exp(-tauView));
  }
  L += vec3(0.00025, 0.0004, 0.0009) * skyNight;
  L = L * (1.0 - skyCloud) + skyCloudColor * skyCloud;
  if (d.y < 0.0) L *= max(0.15, 1.0 + d.y * 3.0);
  return L;
}
`;

export const SKY_FS = /* glsl */ `
${BRDF}
${TONEMAP}
${SKY_FN}
in vec2 vUv;
out vec4 fragColor;
uniform mat4 invViewProj;
uniform vec3 fogColor; uniform float fogHorizon;
uniform float exposure; uniform int toneOp;
void main() {
  vec4 p = invViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(p.xyz / p.w);
  vec3 c = skyRadiance(d, true);
  // aerial perspective at the horizon follows the scene fog (rain thickens it)
  c = mix(c, fogColor, fogHorizon * exp(-max(d.y, 0.0) * 18.0));
#ifdef INLINE_TONEMAP
  fragColor = vec4(linearToSrgb(toneMap(c * exposure, toneOp)), 1.0);
#else
  fragColor = vec4(c, 1.0);
#endif
}
`;

/** Bake the sky into an equirect map (v = 0 zenith) for specular IBL; sun disc softened. */
export const ENV_FS = /* glsl */ `
${BRDF}
${SKY_FN}
in vec2 vUv;
out vec4 fragColor;
uniform float envEncode;
void main() {
  float phi = (vUv.x - 0.5) * 2.0 * PI, th = vUv.y * PI;
  vec3 d = vec3(sin(th) * sin(phi), cos(th), -sin(th) * cos(phi));
  vec3 c = skyRadiance(d, false);
  // ground below the horizon reflects a dim neutral (no geometry is baked)
  if (d.y < 0.0) c = mix(c, vec3(0.05, 0.048, 0.045) * skySunE * 0.004 + c * 0.2, clamp(-d.y * 8.0, 0.0, 1.0));
  fragColor = vec4(c * envEncode, 1.0);
}
`;

export const BLOOM_PREFILTER_FS = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D src; uniform vec2 texel; uniform float exposure; uniform float threshold; uniform float knee;
void main() {
  vec3 c = (texture(src, vUv + texel * vec2(-1.0, -1.0)).rgb + texture(src, vUv + texel * vec2(1.0, -1.0)).rgb + texture(src, vUv + texel * vec2(-1.0, 1.0)).rgb + texture(src, vUv + texel * vec2(1.0, 1.0)).rgb) * 0.25 * exposure;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  c *= max(soft, br - threshold) / max(br, 1e-5);
  fragColor = vec4(min(c, vec3(64.0)), 1.0);
}
`;
export const BLOOM_DOWN_FS = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D src; uniform vec2 texel;
void main() {
  vec3 c = texture(src, vUv).rgb * 0.5;
  c += (texture(src, vUv + texel * vec2(-1.0, -1.0)).rgb + texture(src, vUv + texel * vec2(1.0, -1.0)).rgb + texture(src, vUv + texel * vec2(-1.0, 1.0)).rgb + texture(src, vUv + texel * vec2(1.0, 1.0)).rgb) * 0.125;
  fragColor = vec4(c, 1.0);
}
`;
export const BLOOM_UP_FS = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D src; uniform vec2 texel; uniform float radius;
void main() {
  vec2 t = texel * radius;
  vec3 c = texture(src, vUv).rgb * 4.0;
  c += (texture(src, vUv + vec2(-t.x, 0.0)).rgb + texture(src, vUv + vec2(t.x, 0.0)).rgb + texture(src, vUv + vec2(0.0, -t.y)).rgb + texture(src, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  c += texture(src, vUv - t).rgb + texture(src, vUv + t).rgb + texture(src, vUv + vec2(-t.x, t.y)).rgb + texture(src, vUv + vec2(t.x, -t.y)).rgb;
  fragColor = vec4(c / 16.0, 1.0);
}
`;

/** Output transform + lens composites (§057–§060, §116): normal, anaglyph fusion, pixel-field overlay. */
export const OUTPUT_FS = /* glsl */ `
${TONEMAP}
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D hdr; uniform sampler2D bloom; uniform sampler2D field;
uniform float exposure; uniform float bloomStrength; uniform int toneOp; uniform int lensMode; uniform float fieldGain; uniform float fieldOn;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 graded(vec2 uv) { return toneMap(texture(hdr, uv).rgb * exposure + texture(bloom, uv).rgb * bloomStrength, toneOp); }
void main() {
  vec3 c;
  if (lensMode == 1) {
    // red–cyan anaglyph of a side-by-side stereo target (left half = left eye)
    vec3 l = graded(vec2(vUv.x * 0.5, vUv.y)), r = graded(vec2(0.5 + vUv.x * 0.5, vUv.y));
    c = vec3(dot(l, vec3(0.299, 0.587, 0.114)), r.g, r.b);
  } else c = graded(vUv);
  if (fieldOn > 0.5) {
    float h = texture(field, vUv).r * fieldGain;
    vec3 fc = h > 0.0 ? vec3(1.0, 0.45, 0.15) : vec3(0.15, 0.55, 1.0);
    c = mix(c, fc, clamp(abs(h), 0.0, 0.85));
  }
  vec3 o = linearToSrgb(c);
  o += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(o, 1.0);
}
`;

export const BLIT_FS = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D src;
void main() { fragColor = texture(src, vUv); }
`;

export function withDefines(src: string, defines: string[]): string {
  return `#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n${defines.map((d) => `#define ${d}`).join('\n')}\n${src}`;
}
