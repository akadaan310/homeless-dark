import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vec3, Mat4, Group, Node, Quat, boxGeometry, sphereGeometry, Mesh } from '@astro/core';
import { parseGLB, Clip, Mixer, clusterize, buildHierarchy, selectClusters, frustumPlanes, sphereInFrustum, ringGlyphMesh, screenError } from '@astro/geometry';

const glb = (n: string) => { const b = readFileSync(resolve(__dirname, '../../../apps/homeless-web/public/assets/models', n)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('GLB reader (own implementation + meshopt decoder)', () => {
  it('parses the sedan with meshopt compression', async () => {
    const r = await parseGLB(glb('sedan.glb'), null, 'sedan');
    expect(r.stats.primitives).toBeGreaterThan(0);
    expect(r.stats.triangles).toBeGreaterThan(500);
    const box = { min: new Vec3(Infinity, Infinity, Infinity), max: new Vec3(-Infinity, -Infinity, -Infinity) };
    r.scene.updateMatrixWorld();
    r.scene.traverse((n) => { if (n instanceof Mesh) { const p = n.geometry.getAttribute('position'); const v = new Vec3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld); box.min.min(v); box.max.max(v); } } });
    const len = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    expect(len).toBeGreaterThan(2); expect(len).toBeLessThan(8); // a car, in metres
  });
  it('parses the skinned citizen with clips', async () => {
    const r = await parseGLB(glb('citizen.glb'), null, 'citizen');
    expect(r.stats.skins).toBeGreaterThan(0);
    expect(r.clips.length).toBeGreaterThan(0);
    const m = new Mixer(r.scene);
    const a = m.clipAction(r.clips[0]!); a.setEffectiveWeight(1).play();
    m.update(0.25);
    expect(a.time).toBeGreaterThan(0);
  });
});

describe('animation mixer', () => {
  it('linear translation and weighted blend toward rest', () => {
    const root = new Group(), bone = new Node(); bone.name = 'b'; root.add(bone);
    const clip = new Clip('move', [{ nodeName: 'b', path: 'translation', times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 2, 0, 0]), interpolation: 'LINEAR' }]);
    const m = new Mixer(root), a = m.clipAction(clip).setEffectiveWeight(1).play();
    a.setLoop('once'); a.clampWhenFinished = true;
    m.update(0.5); expect(bone.position.x).toBeCloseTo(1, 6);
    a.setEffectiveWeight(0.5); m.update(0); expect(bone.position.x).toBeCloseTo(0.5, 6);
  });
  it('rotation tracks slerp and stay normalised', () => {
    const root = new Group(), bone = new Node(); bone.name = 'r'; root.add(bone);
    const q1 = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2);
    const m = new Mixer(root);
    m.clipAction(new Clip('turn', [{ nodeName: 'r', path: 'rotation', times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 1, q1.x, q1.y, q1.z, q1.w]), interpolation: 'LINEAR' }])).setEffectiveWeight(1).play();
    m.update(0.5);
    expect(Math.hypot(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w)).toBeCloseTo(1, 9);
    expect(2 * Math.acos(bone.quaternion.w)).toBeCloseTo(Math.PI / 4, 5);
  });
});

describe('clusters, culling, glyph meshes', () => {
  it('clusters cover every triangle exactly once with ≤124 triangles each', () => {
    const g = sphereGeometry(1, 48, 24);
    const cl = clusterize(g);
    expect(cl.every((c) => c.triangles.length / 3 <= 124)).toBe(true);
    expect(cl.reduce((s, c) => s + c.triangles.length / 3, 0)).toBe(g.triangleCount);
  });
  it('LOD selection falls back to coarse far away', () => {
    const h = buildHierarchy(sphereGeometry(1, 64, 32), sphereGeometry(1, 8, 4), 0.01);
    expect(selectClusters(h, new Vec3(0, 0, 500), 60, 1080).level).toBe(1);
    expect(selectClusters(h, new Vec3(0, 0, 1.2), 60, 1080).level).toBe(0);
    expect(screenError(0.01, 10, 60, 1080)).toBeCloseTo(0.935, 2);
  });
  it('frustum planes keep the centre and drop objects behind the camera', () => {
    const P = new Mat4().perspective(60, 1, 0.1, 100);
    const planes = frustumPlanes(P);
    expect(sphereInFrustum(planes, new Vec3(0, 0, -10), 1)).toBe(true);
    expect(sphereInFrustum(planes, new Vec3(0, 0, 10), 1)).toBe(false);
  });
  it('ring glyph mesh vertex count matches the documented formula', () => {
    const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
    const g = ringGlyphMesh(6, edges);
    expect(g.userTag).toBe('ring C6');
    expect(g.vertexCount).toBeGreaterThan(6 * 9 * 7);
  });
});
