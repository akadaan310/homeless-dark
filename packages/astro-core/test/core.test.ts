import { describe, it, expect } from 'vitest';
import { Vec3, Quat, Mat4, Euler, Color, boxGeometry, sphereGeometry, cylinderGeometry, mergeGeometries, Node, Group, Mesh, Material, FrameGraph, CommandList, CompileCache, validate, toGLSL, toWGSL, shaderDigest, num, ref, bin, call, sample, ctor, swz } from '@astro/core';

describe('math', () => {
  it('compose/decompose round-trips', () => {
    const p = new Vec3(1, 2, 3), q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), 0.7), s = new Vec3(2, 2, 2);
    const m = new Mat4().compose(p, q, s);
    const p2 = new Vec3(), q2 = new Quat(), s2 = new Vec3();
    m.decompose(p2, q2, s2);
    expect(p2.distanceTo(p)).toBeLessThan(1e-9);
    expect(Math.abs(q2.w - q.w) + Math.abs(q2.y - q.y)).toBeLessThan(1e-9);
    expect(s2.x).toBeCloseTo(2, 9);
  });
  it('inverse times matrix is identity', () => {
    const m = new Mat4().compose(new Vec3(4, -1, 2), new Quat().setFromEuler(new Euler(0.3, 1.1, -0.4)), new Vec3(1, 3, 0.5));
    const id = m.clone().multiply(m.clone().invert());
    const e = id.elements;
    for (let i = 0; i < 16; i++) expect(e[i]!).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
  });
  it('perspective maps near/far to NDC -1/+1', () => {
    const P = new Mat4().perspective(60, 1.5, 0.1, 100);
    const near = new Vec3(0, 0, -0.1).applyMatrix4(P), far = new Vec3(0, 0, -100).applyMatrix4(P);
    expect(near.z).toBeCloseTo(-1, 6); expect(far.z).toBeCloseTo(1, 6);
  });
  it('quaternion rotates +X to -Z about +Y by 90°', () => {
    const v = new Vec3(1, 0, 0).applyQuaternion(new Quat().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2));
    expect(v.z).toBeCloseTo(-1, 9);
  });
  it('sRGB hex converts to linear', () => {
    const c = new Color().setHex(0x808080);
    expect(c.r).toBeCloseTo(0.2158, 3);
    expect(c.getHexString()).toBe('808080');
  });
});

describe('geometry and scene', () => {
  it('builders produce consistent indexed meshes', () => {
    const b = boxGeometry(1, 2, 3);
    expect(b.triangleCount).toBe(12);
    const bb = b.computeBoundingBox();
    expect(bb.max.y - bb.min.y).toBeCloseTo(2);
    expect(sphereGeometry(1, 16, 8).triangleCount).toBeGreaterThan(200);
    const m = mergeGeometries([b, cylinderGeometry(1, 1, 1, 8)])!;
    expect(m.triangleCount).toBe(12 + cylinderGeometry(1, 1, 1, 8).triangleCount);
  });
  it('negative-determinant transforms keep outward winding', () => {
    const g = boxGeometry(1, 1, 1);
    const before = Array.from(g.index!.array.slice(0, 3));
    g.applyMatrix4(new Mat4().makeScale(-1, 1, 1));
    const after = Array.from(g.index!.array.slice(0, 3));
    expect(after).not.toEqual(before);
  });
  it('world matrices propagate and clone is independent', () => {
    const root = new Group(), child = new Mesh(boxGeometry(1, 1, 1), new Material());
    root.position.set(10, 0, 0); child.position.set(1, 0, 0); root.add(child);
    root.updateMatrixWorld();
    expect(child.getWorldPosition(new Vec3()).x).toBeCloseTo(11);
    const c = root.clone(); c.position.set(0, 0, 0); c.updateMatrixWorld();
    expect(child.getWorldPosition(new Vec3()).x).toBeCloseTo(11);
    expect(c.children.length).toBe(1);
    expect(root.getObjectByName('nope')).toBeUndefined();
    expect(new Node().epistemic).toBeDefined();
  });
});

describe('framegraph and command IR', () => {
  const g = () => new FrameGraph()
    .attachment({ name: 'shadow', format: 'depth32f', scale: 1 })
    .attachment({ name: 'hdr', format: 'rgba16f', scale: 1 })
    .attachment({ name: 'bloomA', format: 'rgba16f', scale: 0.5 })
    .attachment({ name: 'bloomB', format: 'rgba16f', scale: 0.5 })
    .attachment({ name: 'debug', format: 'rgba8', scale: 1 });
  it('sorts, culls dead passes and finds aliases', () => {
    const fg = g()
      .pass({ name: 'tonemap', reads: ['hdr', 'bloomB'], writes: ['backbuffer'] })
      .pass({ name: 'bloomBlur', reads: ['bloomA'], writes: ['bloomB'] })
      .pass({ name: 'bloomDown', reads: ['hdr'], writes: ['bloomA'] })
      .pass({ name: 'forward', reads: ['shadow'], writes: ['hdr'] })
      .pass({ name: 'shadow', reads: [], writes: ['shadow'] })
      .pass({ name: 'debugView', reads: ['hdr'], writes: ['debug'] });
    const c = fg.compile();
    expect(c.order).toEqual(['shadow', 'forward', 'bloomDown', 'bloomBlur', 'tonemap']);
    expect(c.culled).toEqual(['debugView']);
    expect(c.lifetimes.hdr).toEqual({ first: 1, last: 4 });
  });
  it('rejects cycles and undeclared attachments', () => {
    const fg = g().pass({ name: 'a', reads: ['bloomB'], writes: ['bloomA'] }).pass({ name: 'b', reads: ['bloomA'], writes: ['bloomB'] }).pass({ name: 'out', reads: ['bloomA'], writes: ['backbuffer'] });
    expect(() => fg.compile()).toThrow(/cycle/);
    expect(() => g().pass({ name: 'x', reads: ['ghost'], writes: ['backbuffer'] })).toThrow(/undeclared/);
  });
  it('render commands cannot carry world effects', () => {
    const cl = new CommandList();
    const base = { op: 'draw' as const, inputs: [], preconditions: [], provenance: 'test', budget: { cpuMs: 0, gpuMs: 0, bytes: 64 } };
    cl.push({ ...base, effects: 'projection_only' });
    expect(() => cl.push({ ...base, effects: 'propose_world_event' })).toThrow(/cannot mutate/);
    expect(cl.stats().total).toBe(1);
  });
  it('compile cache hits on same key', () => {
    const cc = new CompileCache<number>(); let built = 0;
    cc.get('k', () => ++built); cc.get('k', () => ++built); cc.get('j', () => ++built);
    expect([cc.hits, cc.misses, built]).toEqual([1, 2, 2]);
  });
});

describe('shader DSL', () => {
  const prog = {
    name: 'wave', uniforms: [{ name: 'k', t: 'f32' as const }], samplers: ['state'],
    body: [
      { k: 'let' as const, name: 'h', t: 'vec4' as const, e: sample('state', ref('uv')) },
      { k: 'let' as const, name: 'acc', t: 'f32' as const, e: num(0) },
      { k: 'for' as const, v: 'i', from: 0, to: 4, body: [{ k: 'set' as const, name: 'acc', e: bin('+', ref('acc'), call('sin', ref('time'))) }] },
      { k: 'out' as const, e: ctor('vec4', bin('*', swz(ref('h'), 'x'), ref('k')), ref('acc'), num(0), num(1)) },
    ],
  };
  it('validates and emits both targets deterministically', () => {
    expect(validate(prog)).toEqual({ ok: true, errors: [] });
    const glsl = toGLSL(prog), wgsl = toWGSL(prog);
    expect(glsl).toMatch(/#version 300 es/);
    expect(glsl).toMatch(/texture\(state/);
    expect(wgsl).toMatch(/@fragment/);
    expect(shaderDigest(glsl)).toBe(shaderDigest(toGLSL(prog)));
    expect(shaderDigest(glsl)).not.toBe(shaderDigest(wgsl));
  });
  it('rejects undeclared names, unbounded loops and forbidden calls', () => {
    const bad = { ...prog, body: [
      { k: 'for' as const, v: 'i', from: 0, to: 1000, body: [] },
      { k: 'out' as const, e: call('eval' as never, ref('ghost')) },
      { k: 'out' as const, e: sample('nope', ref('uv')) },
    ] };
    const r = validate(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ghost/);
    expect(r.errors.join(' ')).toMatch(/eval/);
    expect(r.errors.join(' ')).toMatch(/nope/);
    expect(r.errors.join(' ')).toMatch(/loop|64/);
  });
});
