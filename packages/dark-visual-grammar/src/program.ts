// Chromastratum VisualProgram DSL: a typed line parser (no string evaluation) and verifier.
//
//   SCENE geography=TAMPA.source-anchored mode=NIGHT weather=RAIN
//   ILLUMINANT class=streetlight temperature=warm intensity=calibrated source=authored
//   SURFACE class=asphalt wetness=0.65 roughness=wet_profile source=licensed_pbr
//   SIGN subject=shopfront locale=en payload=validated_grammar emission=limited
//   CAMERA mode=third_person adaptation=smooth filmic=AgX
//   PERCEPTION target=walkable_path legibility=verified comfort=reduced_flash
//
// [C] DARK construction. The verifier enforces budgets and safety; a program that
// fails verification yields no render recipe.

export type Directive = 'SCENE' | 'ILLUMINANT' | 'SURFACE' | 'SIGN' | 'CAMERA' | 'PERCEPTION';

const SCHEMA: Record<Directive, Record<string, RegExp>> = {
  SCENE: { geography: /^[A-Z_]+(\.[a-z-]+)?$/, mode: /^(DAY|GOLDEN|TWILIGHT|NIGHT|INDOOR|CABIN)$/, weather: /^(CLEAR|CLOUD|RAIN|STORM|FOG)$/ },
  ILLUMINANT: { class: /^(sun|moon|sky|streetlight|shopfront|neon|headlamp|taillamp|cabin|terminal|lantern|screen)$/, temperature: /^(warm|neutral|cool|\d{4,5}K)$/, intensity: /^(calibrated|low|medium|high)$/, source: /^(municipal_or_authored|authored|measured|derived)$/ },
  SURFACE: { class: /^(asphalt|concrete|brick|paving|wood|carpet|metal|glass|water|sand|grass|car_paint|skin)$/, wetness: /^(0(\.\d+)?|1(\.0+)?)$/, roughness: /^(dry_profile|wet_profile|\d?\.\d+)$/, source: /^(licensed_pbr|authored|procedural)$/ },
  SIGN: { subject: /^(traffic_sign|building_name|shopfront|transit_departures|flight_board|digital_ad|wayfinding|museum|artist_mural|diegetic_interface)$/, locale: /^[a-z]{2}(-[A-Z]{2})?$/, payload: /^(validated_grammar|authored|source_label)$/, emission: /^(off|limited|full)$/ },
  CAMERA: { mode: /^(third_person|first_person|cockpit|cabin|cinematic)$/, adaptation: /^(smooth|fixed|off)$/, filmic: /^(AgX|ACESFilmic|Neutral)$/ },
  PERCEPTION: { target: /^(walkable_path|door|crossing|vehicle|sign|gate)$/, legibility: /^(verified|required|ambient)$/, comfort: /^(reduced_flash|reduced_motion|standard)$/ },
};

const REQUIRED: Partial<Record<Directive, string[]>> = { SCENE: ['geography', 'mode', 'weather'], CAMERA: ['mode', 'filmic'], SURFACE: ['class', 'source'] };

export interface DirectiveNode { directive: Directive; attrs: Record<string, string>; line: number }

export interface VisualProgram {
  ok: boolean;
  nodes: DirectiveNode[];
  errors: string[];
  recipe: null | {
    mode: string; weather: string; toneMapping: string; wetness: number; illuminants: string[]; surfaces: string[]; signs: string[];
    emissiveBudget: number; dynamicLights: number; comfort: string;
  };
}

export function parseVisualProgram(src: string, budget = { maxDynamicLights: 12, maxEmissiveSigns: 8 }): VisualProgram {
  const nodes: DirectiveNode[] = [];
  const errors: string[] = [];
  src.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [head, ...rest] = line.split(/\s+/);
    const d = head as Directive;
    const schema = SCHEMA[d];
    if (!schema) { errors.push(`line ${i + 1}: unknown directive ${head}`); return; }
    const attrs: Record<string, string> = {};
    for (const tok of rest) {
      const m = /^([a-z_]+)=([^\s=]+)$/.exec(tok);
      if (!m) { errors.push(`line ${i + 1}: malformed attribute ${tok}`); continue; }
      const [, k, v] = m as unknown as [string, string, string];
      if (!schema[k]) { errors.push(`line ${i + 1}: ${d} has no attribute ${k}`); continue; }
      if (!schema[k]!.test(v)) { errors.push(`line ${i + 1}: ${d}.${k}=${v} is not admissible`); continue; }
      attrs[k] = v;
    }
    for (const r of REQUIRED[d] ?? []) if (!(r in attrs)) errors.push(`line ${i + 1}: ${d} requires ${r}`);
    nodes.push({ directive: d, attrs, line: i + 1 });
  });
  const scene = nodes.filter((n) => n.directive === 'SCENE');
  if (scene.length !== 1) errors.push(`exactly one SCENE required (found ${scene.length})`);
  const cams = nodes.filter((n) => n.directive === 'CAMERA');
  if (cams.length !== 1) errors.push('exactly one CAMERA (one declared output transform) required');
  const dyn = nodes.filter((n) => n.directive === 'ILLUMINANT' && n.attrs.class !== 'sun' && n.attrs.class !== 'moon' && n.attrs.class !== 'sky').length;
  if (dyn > budget.maxDynamicLights) errors.push(`dynamic light budget ${dyn} > ${budget.maxDynamicLights}`);
  const emissive = nodes.filter((n) => n.directive === 'SIGN' && n.attrs.emission !== 'off').length;
  if (emissive > budget.maxEmissiveSigns) errors.push(`emissive sign budget ${emissive} > ${budget.maxEmissiveSigns}`);
  const perception = nodes.find((n) => n.directive === 'PERCEPTION');
  if (scene[0]?.attrs.weather === 'STORM' && perception?.attrs.comfort !== 'reduced_flash') errors.push('STORM requires PERCEPTION comfort=reduced_flash (lightning flashes)');
  const ok = errors.length === 0;
  return {
    ok, nodes, errors,
    recipe: ok ? {
      mode: scene[0]!.attrs.mode!, weather: scene[0]!.attrs.weather!, toneMapping: cams[0]!.attrs.filmic!,
      wetness: Math.max(0, ...nodes.filter((n) => n.directive === 'SURFACE' && n.attrs.wetness).map((n) => Number(n.attrs.wetness))),
      illuminants: nodes.filter((n) => n.directive === 'ILLUMINANT').map((n) => n.attrs.class!),
      surfaces: nodes.filter((n) => n.directive === 'SURFACE').map((n) => n.attrs.class!),
      signs: nodes.filter((n) => n.directive === 'SIGN').map((n) => n.attrs.subject!),
      emissiveBudget: emissive, dynamicLights: dyn, comfort: perception?.attrs.comfort ?? 'standard',
    } : null,
  };
}
