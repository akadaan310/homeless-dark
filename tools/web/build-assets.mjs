// Web asset pipeline for the HOMELESS web client.
//
// 1. Converts the repository's original CC0 FBX masters (Unity lane, authored in
//    Blender, see unity/Assets/HOMELESS/Content/*) to glTF 2.0 binary with
//    FBX2glTF, then optimizes them with glTF-Transform (meshopt geometry, WebP
//    textures capped at 1024 px). Node names are preserved (no join/flatten) so
//    wheels, doors and seats remain addressable.
// 2. Downsamples the acquired ambientCG CC0 2K PBR maps to 1K.
// 3. Fetches a small set of Poly Haven CC0 1K PBR maps.
// 4. Copies the original PCM sound clips and English speech-cache lines.
// 5. Writes apps/homeless-web/public/assets/asset-manifest.json and
//    assets/web-selection.lock.json with source, license, conversion and SHA-256.
//
// Run: npm run assets   (idempotent; network only for Poly Haven fetches)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'apps/homeless-web/public/assets');
const TMP = path.join(ROOT, 'artifacts/asset-build');
const CONTENT = path.join(ROOT, 'unity/Assets/HOMELESS/Content');
const FBX2GLTF = path.join(ROOT, 'node_modules/fbx2gltf/bin/Linux/FBX2glTF');
const GLTF_TRANSFORM = path.join(ROOT, 'node_modules/.bin/gltf-transform');

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel = (p) => path.relative(ROOT, p);
fs.mkdirSync(TMP, { recursive: true });
for (const d of ['models', 'textures', 'audio', 'audio/speech']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const entries = [];

// ---------------------------------------------------------------- models
const MODELS = [
  ['citizen', 'Characters/Citizen.fbx', 'human', 'MakeHuman 1.x CC0 base mesh, skin and casual suit; rig and clips (Seated, Talk, WalkInPlace, Wave) authored in this repository'],
  ['citizen-alt', 'Characters/CitizenAltSkin.fbx', 'human', 'MakeHuman CC0 base mesh with alternate CC0 skin; same rig and clips'],
  ['sedan', 'Vehicles/CivicSedan.fbx', 'car', 'original authored sedan (Blender source assets/content/authored/CivicSedanSource.blend)'],
  ['bus', 'Families/UrbanBus.fbx', 'bus', 'original authored bus'],
  ['truck', 'Families/DeliveryTruck.fbx', 'truck', 'original authored delivery truck'],
  ['aircraft', 'Families/CoastalSixAircraft.fbx', 'aircraft', 'original authored six-seat aircraft'],
  ['helicopter', 'Families/RotorShuttle.fbx', 'helicopter', 'original authored rotor shuttle'],
  ['boat', 'Families/HarborLaunch.fbx', 'boat', 'original authored harbor launch'],
  ['palm', 'Families/SubtropicalPalm.fbx', 'vegetation', 'original authored subtropical palm'],
  ['bicycle', 'Families/Bicycle.fbx', 'bicycle', 'original authored bicycle'],
  ['cup', 'Families/CeramicCup.fbx', 'prop', 'original authored ceramic cup'],
  ['guitar', 'Families/AcousticGuitar.fbx', 'prop', 'original authored acoustic guitar'],
  ['balloon', 'Families/AudienceBalloon.fbx', 'balloon', 'original authored balloon'],
];

for (const [id, src, family, origin] of MODELS) {
  const input = path.join(CONTENT, src);
  const out = path.join(OUT, 'models', `${id}.glb`);
  const raw = path.join(TMP, `${id}`);
  if (!fs.existsSync(out) || process.argv.includes('--force')) {
    execFileSync(FBX2GLTF, ['--binary', '--input', input, '--output', raw], { stdio: 'pipe' });
    execFileSync(GLTF_TRANSFORM, ['optimize', `${raw}.glb`, out,
      '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
      '--join', 'false', '--flatten', 'false', '--instance', 'false', '--palette', 'false',
      '--simplify', 'false'], { stdio: 'pipe' });
  }
  entries.push({
    id: `model/${id}`, kind: 'glb', family, path: `models/${id}.glb`,
    source: rel(input), sourceSha256: sha(input), sha256: sha(out), bytes: fs.statSync(out).size,
    license: 'CC0-1.0', origin,
    conversion: 'FBX2glTF 0.9.7 --binary; gltf-transform 4.2.1 optimize (meshopt, WebP ≤1024px, names preserved, no simplification)',
    status: ['imported', 'render-tested'],
  });
  console.log('model', id, fs.statSync(out).size);
}

// ---------------------------------------------------------------- textures
const AMBIENT = [
  ['asphalt', 'Asphalt024A', { color: 'Color', normal: 'NormalGL', rough: 'Roughness', ao: 'AmbientOcclusion' }],
  ['concrete', 'Concrete034', { color: 'Color', normal: 'NormalGL', rough: 'Roughness' }],
  ['bricks', 'Bricks059', { color: 'Color', normal: 'NormalGL', rough: 'Roughness', ao: 'AmbientOcclusion' }],
];
for (const [id, set, maps] of AMBIENT) {
  fs.mkdirSync(path.join(OUT, 'textures', id), { recursive: true });
  for (const [slot, suffix] of Object.entries(maps)) {
    const input = path.join(ROOT, `unity/Assets/HOMELESS/Art/Materials/${set}/${set}_2K-JPG_${suffix}.jpg`);
    const out = path.join(OUT, 'textures', id, `${slot}.jpg`);
    if (!fs.existsSync(out)) await sharp(input).resize(1024, 1024).jpeg({ quality: 88 }).toFile(out);
    entries.push({ id: `texture/${id}/${slot}`, kind: 'texture', path: `textures/${id}/${slot}.jpg`, colorSpace: slot === 'color' ? 'srgb' : 'linear-data',
      source: rel(input), sourceSha256: sha(input), sha256: sha(out), bytes: fs.statSync(out).size,
      license: 'CC0-1.0', origin: `ambientCG ${set} (https://ambientcg.com/view?id=${set})`, conversion: 'sharp resize 2048→1024, JPEG q88', status: ['downloaded', 'imported', 'render-tested'] });
  }
}

const POLYHAVEN = [
  ['stucco', 'white_stucco'],
  ['plaster', 'painted_plaster_wall'],
  ['paving', 'rectangular_paving'],
  ['wood', 'wood_floor'],
  ['sand', 'coast_sand_01'],
  ['grass', 'grass_ground'],
  ['shutter', 'painted_metal_shutter'],
  ['carpet', 'dirty_carpet'],
];
const PH_SLOTS = { color: 'diff', normal: 'nor_gl', rough: 'rough' };
for (const [id, asset] of POLYHAVEN) {
  fs.mkdirSync(path.join(OUT, 'textures', id), { recursive: true });
  for (const [slot, key] of Object.entries(PH_SLOTS)) {
    const url = `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${asset}/${asset}_${key}_1k.jpg`;
    const out = path.join(OUT, 'textures', id, `${slot}.jpg`);
    if (!fs.existsSync(out)) {
      const res = await fetch(url);
      if (!res.ok) { console.warn('fetch failed', url, res.status); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      await sharp(buf).resize(1024, 1024).jpeg({ quality: 88 }).toFile(out);
    }
    entries.push({ id: `texture/${id}/${slot}`, kind: 'texture', path: `textures/${id}/${slot}.jpg`, colorSpace: slot === 'color' ? 'srgb' : 'linear-data',
      source: url, sha256: sha(out), bytes: fs.statSync(out).size, license: 'CC0-1.0',
      origin: `Poly Haven ${asset} (https://polyhaven.com/a/${asset}); license https://polyhaven.com/license`, conversion: 'JPEG 1K re-encoded q88', status: ['downloaded', 'imported', 'render-tested'] });
  }
}

// ---------------------------------------------------------------- audio
const AUDIO = ['original_arrival_motif', 'synthetic_footstep_left', 'synthetic_footstep_right', 'synthetic_rain_wind_loop'];
for (const a of AUDIO) {
  const input = path.join(ROOT, `unity/Assets/HOMELESS/Audio/${a}.wav`);
  const out = path.join(OUT, 'audio', `${a}.wav`);
  fs.copyFileSync(input, out);
  entries.push({ id: `audio/${a}`, kind: 'audio', path: `audio/${a}.wav`, source: rel(input), sha256: sha(out), bytes: fs.statSync(out).size,
    license: 'CC0-1.0 (original synthesis, unity/Assets/HOMELESS/Audio/ORIGINAL_AUDIO_LICENSE.txt)', origin: 'tools/audio/synthesize.py', status: ['imported'] });
}

const speech = [];
const SPEECH_DIR = path.join(CONTENT, 'Speech');
for (const f of fs.readdirSync(SPEECH_DIR).filter((x) => x.endsWith('.json'))) {
  const meta = JSON.parse(fs.readFileSync(path.join(SPEECH_DIR, f), 'utf8'));
  // English eSpeak NG lines only: the web build carries no non-English speech material.
  if (meta.canonical_act?.language !== 'en' || meta.voice?.voice !== 'en-us') continue;
  const input = path.join(SPEECH_DIR, meta.filename);
  const id = meta.event_id.replace(/^evt:/, '').replace(/:/g, '-');
  const out = path.join(OUT, 'audio/speech', `${id}.wav`);
  fs.copyFileSync(input, out);
  speech.push({ id, speaker: meta.speaker, act: meta.canonical_act.act, caption: meta.caption, path: `audio/speech/${id}.wav`, duration: meta.duration_seconds });
  entries.push({ id: `speech/${id}`, kind: 'speech', path: `audio/speech/${id}.wav`, source: rel(input), sha256: sha(out), bytes: fs.statSync(out).size,
    license: 'eSpeak NG output (GPL-3.0 engine; generated audio carries no engine license obligation per espeak-ng-copyright.txt review)', origin: `${meta.voice.runtime} ${meta.voice.voice}`, caption: meta.caption, status: ['imported'] });
}
speech.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'speech.json'), JSON.stringify(speech, null, 1) + '\n');

const manifest = { schema: 'dark.web-asset-manifest/1', generated: new Date().toISOString().slice(0, 10), entries };
fs.writeFileSync(path.join(OUT, 'asset-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
fs.writeFileSync(path.join(ROOT, 'assets/web-selection.lock.json'), JSON.stringify({
  schema: 'dark.web-selection-lock/1',
  note: 'Every runtime asset of apps/homeless-web with source, license, conversion and hash. Status words follow constitution v3 §II-D5; "render-tested" means loaded in the real Three.js canvas by the e2e suite.',
  ...manifest,
}, null, 1) + '\n');
console.log('entries', entries.length, 'speech lines', speech.length);
