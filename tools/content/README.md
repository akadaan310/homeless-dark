# Source content and offline speech

These are source assets and executable authoring/evaluation tools. They do not
mark Unity import, native visuals, retargeting, vehicle physics or device quality
as passed. The governing requirements remain the repository constitution.

`Citizen.fbx` and `CitizenAltSkin.fbx` use the pinned MakeHuman CC0 topology,
163-bone rig, source skin weights and full-resolution licensed texture masters.
The two appearances share an outfit and topology. MHCLO barycentric fitting,
source body masks and a four-influence weight profile are applied explicitly.
Eight original keyframed actions are included: Idle, WalkInPlace, JogInPlace,
Wave, Talk, Listen, Seated, EnterVehicle. They are authored source motions, not
motion capture or verified Unity humanoid retargets. Native foot contacts,
facial speech, hands on controls, cloth deformation and diverse bodies remain
acceptance work.

`CivicSedan.fbx` is an original fictional unbranded source car with a modeled
interior, four articulated doors, wheel pivots, steering and four seat anchors.
Ten further original source families include a bus, cargo truck, small
aircraft, harbor launch, palm, guitar, balloon, hollow ceramic cup, bicycle and
four-seat rotor shuttle. The bicycle has wheel/crank pivots, a saddle and hand
grips. The rotor shuttle has fitted opening cabin doors, seats, local rotor
pivots and fixed landing skids. Their attachment metadata
does not implement driving, buoyancy, flight or boarding. Several forms remain
visually preliminary. Their per-asset JSON files retain the unpassed gates.

The source `.blend` masters live under `assets/content/authored`, outside Unity
Assets so a future Unity import does not silently require a Blender installation.
Actual native files are under `unity/Assets/HOMELESS/Content`. Character texture
bindings are explicit in `Characters/materials.json`; original resolutions are
preserved. Source master hashes and legal notices are under `assets/content`.

Reproduce on a machine with Blender, Xvfb and eSpeak NG:

```sh
python3 tools/content/acquire_character.py
blender -b --threads 2 --python-exit-code 1 --python tools/content/build_characters.py
blender -b --threads 2 --python-exit-code 1 --python tools/content/build_vehicle.py
blender -b --threads 2 --python-exit-code 1 --python tools/content/build_families.py
blender -b --threads 2 --python-exit-code 1 --python tools/content/build_opening_transport.py
python3 tools/content/prepare_materials.py
xvfb-run -a blender -b --threads 2 --python-exit-code 1 --python tools/content/preview_content.py
blender -b --threads 2 --python-exit-code 1 --python tools/content/validate_fbx.py
xvfb-run -a blender -b --threads 2 --python-exit-code 1 --python tools/content/validate_seated.py
python3 tools/content/speech.py
python3 -m unittest discover -s tests/content -v
```

`--python-exit-code 1` is required: Blender otherwise returns success even if a
Python authoring script failed. This ARM64 Blender lacks OpenColorIO. The
geometry/UV previews use Workbench under Xvfb; they are not PBR or Unity captures.
The FBX roundtrip importer uses a documented Non-Color-to-Linear enum shim for
that environment. Geometry, weights and motions are independently re-imported
from actual FBX bytes and their digests are recorded.
The seated source check caught and corrected a bone-local translation that
moved sideways; it now measures a vertical0.38m root offset and forward knees.
The cup roundtrip ray reaches the inner base through the open top. Sedan wheel
arches, boat end caps, aircraft glazing/window openings and the guitar soundhole
are actual source geometry. These checks do not substitute for native contacts.

`speech.py` writes real decoded PCM WAV, captions, canonical acts, source event
identities, voice/dictionary hashes and cache keys. Its scheduler tests distinguish
predicted, synthesized, fetched, committed, playing, interrupted, ignored and
canceled. It does not claim that scheduled audio was physically heard. The Unity
client must bind the current committed event/speaker and match the caption
exactly; a static authoring event ID never becomes the live world's authority.

Thirty English/Arabic eSpeak NG utterances currently total about 94.8 seconds.
This is explicitly synthetic fallback speech. The separately installed GPL
runtime is not embedded or linked into Unity. No real-person reference voice,
private corpus, microphone recording or network synthesis service is used.

Actual whisper.cpp ARM64 recognition was built and exercised on 12 synthetic
clips. English mean WER was 0.140, Arabic 0.958. A second controlled Arabic
experiment compares six lines with/without full vowel marks against tiny and
base-q5_1. The best mean normalized WER remains 0.925, so Arabic quality fails;
tokenization/diacritics are not an adequate explanation for the wrong words.
All hypotheses and failed cases are retained. No recognized text executes an
action or host command. Live noisy speech and human intelligibility remain
unmeasured.

```sh
python3 tools/content/asr.py --prepare
python3 tools/content/asr.py
python3 tools/content/arabic_probe.py
```

SILMA's separately pinned Apache-2.0 ONNX export runs actual neural synthesis
on the ARM CPU. Its larger model stays in `/tmp/homeless-silma-models`, outside git,
with source hashes and a download/reproduction harness. The harness preserves a
2 GiB disk reserve and conditions only on our own synthetic speech. Its output
is measured per clip with independent ASR. `select_neural_speech.py` only replaces
individual exact-caption fixtures with normalized WER<=0.25, retaining fallback
files and explicitly unreviewed human/native quality. This diagnostic threshold
does not establish acceptable pronunciation or naturalness. Initial selected
clips include a café ride offer (WER0.10) and coffee reply (WER0.00); several
other lines still fail. See the current per-clip reports and selection result.

```sh
python3 tools/content/silma_probe.py --prepare
python3 tools/content/silma_probe.py --act welcome_member
python3 tools/content/silma_probe.py --all --unvowelled
python3 tools/content/select_neural_speech.py
python3 tools/content/content_inventory.py
```

`packages/dark_server/decisions.py` is a pure NPC proposal module. Content-bound
home/work/social schedules, actual-activity needs, integer decision budgets and
fresh local access observations produce a candidate state and World precondition
digest. Its2x2 strategic solver enumerates exact rational pure/mixed equilibrium
witnesses and reports regret against uniform/myopic baselines. World admission,
travel execution and durable state commit remain the caller's responsibility.
Twelve tests include128 seeded games with independently checked deviations.
