# Prepared source contract — HD-047–049 / HD-085

These files are import inputs. Unity import, collision, shader appearance, Android rendering and world integration have **not run** on this ARM64 host. No image in this lane is a native gameplay capture. No human, animation, vehicle or aircraft proxy is supplied as completed art.

## Exact acquired sources

| ID | Source archive | Source size | Maps | Physical tile |
|---|---|---:|---|---|
| Asphalt024A | `Asphalt024A_2K-JPG.zip` | 34,783,694 bytes | Color, NormalGL, Roughness, AmbientOcclusion, Displacement | Unspecified by publisher; proposed 2 m authored lookdev tile, unverified |
| Concrete034 | `Concrete034_2K-JPG.zip` | 10,598,720 bytes | Color, NormalGL, Roughness, Displacement | Approximately 1.1 × 0.55 m |
| Bricks059 | `Bricks059_2K-JPG.zip` | 28,121,140 bytes | Color, NormalGL, Roughness, AmbientOcclusion, Displacement | Approximately 1.05 × 1.05 m |

Unmodified JPGs are under `unity/Assets/HOMELESS/Art/Materials/<ID>/<ID>_2K-JPG_<Map>.jpg`. The full original ZIP remains in ignored `assets/cache/`. Exact archive/member SHA-256, bytes and actual pixel dimensions are locked in `assets/selection.lock.json`; each directory has `maps.json`. These assets are publisher-labeled procedural/approximated PBR, not claimed photogrammetric scans. Publisher raw CC0 redistribution permission and legal text are preserved in `assets/licenses/` with hashes.

## Required importer behavior

Use `Universal Render Pipeline/Lit`, Metallic workflow, opaque material, metallic 0, white base tint. Source albedo `_BaseMap` is sRGB. NormalGL is an imported NormalMap, not an sRGB default texture or a height-to-normal conversion; preserve the OpenGL green channel. Recalculate MikkTSpace tangents when necessary. Roughness, AO, displacement and derived packed maps are linear. Mipmaps enabled, Repeat wrap, trilinear filtering, anisotropy 4 as a **proposed unbenchmarked** initial setting. Source JPGs remain unchanged. Initial Android import can cap max size at 1024 with ASTC 6×6; retain a 2048 close-up profile for comparison, never claim either profile meets the A16 budget before measuring it.

Derive packed PNG from linear maps with `R=0` (dielectric metalness), `G=AO` (or 1 if absent), `B=0`, `A=1-Roughness`. Assign this to `_MetallicGlossMap` and `_OcclusionMap`; set `_Smoothness=1` so its alpha is not unintentionally scaled, `_OcclusionStrength=1`, enable `_METALLICSPECGLOSSMAP`, `_OCCLUSIONMAP` where used and `_NORMALMAP`. Keep smoothness source Metallic Alpha. Avoid using roughness directly as smoothness. Derived mask is linear, alpha source input; retain lossless PNG and importer settings. Base-map RGB stays independent from AO, preserving lighting behavior. Displacement is retained as source only: no mobile tessellation/displacement performance claim. Height scale is not supplied by the publisher; no physical height in meters is inferred from normalized values.

Review material tiling against the listed physical sizes. A missing AO map on Concrete034 is neutral AO, not an acquisition failure. Native tests must compare wet/dry and day/dusk at foot distance, inspect normal orientation, texture seams/mip shimmer and memory/GPU cost, then record raw moving-camera Android footage.

Primary shader documentation: https://docs.unity3d.com/6000.0/Documentation/Manual/urp/lit-shader.html . This specification is the project conversion design, not a claim that an Editor executed it.

## Original fictional café geometry

`Art/Architecture/FictionalCafe/FictionalCafe.obj` and `.mtl` are deterministically authored by `python3 tools/art/author_cafe.py`. Geometry has 6,920 triangles; Y up, meters, front −Z, bounds `(-0.992,-0.31,-3.72)` to `(12.992,4.04,8.12)`. Preserve source normals and calculate tangents. Root scale 1; verify imported axes with bounds/gizmo before scene placement. The piece is a fictional 12 × 8 m café, not a measured reconstruction of Tampa or a completed urban library. Its storefront has framed glazing, brick plinth/piers, cornice, striped curved fabric awning, separate open door leaf, transom, interior tables/chairs/counter, pendant lamps, scored apron and curb/drain geometry. Lower LODs and native appearance remain unverified.

Material names are `Bricks059`, `Concrete034`, `Frame`, `Glass`, `Roof`, `Metal`, `Wood`, `AwningLight`, `AwningDark`, `Lamp`. Remap the first two to acquired PBR materials. Remaining values are original MTL descriptions requiring URP conversion. Glass proposes alpha .22, transparent URP surface, no fake accessible interior substitution. Awning is a single fabric surface: Cull Off/two-sided rendering required. Lamp emission is optional original lookdev. Material labels do not make wood/metal/skin scans exist. Interior wood/metal need close-up PBR refinement before the cinematic gate.

Distinct OBJ group names are in `geometry.json`; preserve them if the importer supports it. Door is authored open around left hinge and is a static group; interactive pivot/rig not asserted. Entry opening is x=5.44..6.60, y=0..2.43, z≈0. Player proposal `(6,0,-2)`, camera `(6,2,-7)` toward +Z; camera floor/near-clip/collision still need native testing. Walkable apron spans z≈−3..0. Do not add a full bounding-box collider that seals the doorway. Author separate floor/shell colliders, exclude glass/awning as walkable surfaces, validate contact and navigation readiness, then mark collision state with executed evidence. Do not claim this single piece satisfies distinct regional building breadth.

## Source reproduction and safety verification

From repository root:

```sh
python3 tools/art/fetch_materials.py
python3 tools/art/fetch_materials.py --verify
python3 tools/art/author_cafe.py
python3 -m unittest discover -s tools/art -p 'test_*.py' -v
python3 tools/art/inspect_megacity.py
```

Downloads require HTTPS, an exact allowed primary host or publisher CDN, locked archive byte sizes, a 40 MiB per-archive cap, 30-second socket/180-second stream deadline, range-checked resumable `.part` files, SHA-256 once acquired, atomic promotion and 350 MiB art-lane budget. ZIP processing rejects traversal/backslashes/symlinks, excessive member counts/expanded sizes and unexpected texture names/dimensions; extraction selects only declared maps. A publisher replacing a file causes hash/size refusal until an intentional provenance review updates the lock. A corrupt `.part` whose final digest fails is kept for inspection; remove that specific partial before refetching. No general asset crawler or unapproved website is used.

Megacity is separately pinned in `assets/evidence/megacity/inspection.json`: Unity 6000.1.0f1 (9ea152932a88), URP 17.1.0, commit `07652ee74a1f322c2c3e607020f07be720175680`. Saved tree, manifest, license notice and LFS pointer inventory are metadata inspection, **not a full clone/LFS checkout**. Companion License is conditional on valid Unity engine licensing, preserves notices and separate third-party rights; no sample raw art is redistributed here. Its sci-fi city is a technical reference, not selected realistic Earth hero art. Never activate metered services from the sample.
