// ASTRO math: independently authored vector/quaternion/matrix types (column-major mat4,
// right-handed, y-up). The method surface intentionally matches common conventions so
// game logic ports mechanically; nothing here is copied from any engine source.

export class Vec2 {
  constructor(public x = 0, public y = 0) {}
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  clone() { return new Vec2(this.x, this.y); }
  copy(v: Vec2) { this.x = v.x; this.y = v.y; return this; }
}

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s: number) { this.x = this.y = this.z = s; return this; }
  setX(v: number) { this.x = v; return this; }
  setY(v: number) { this.y = v; return this; }
  setZ(v: number) { this.z = v; return this; }
  setComponent(i: number, v: number) { if (i === 0) this.x = v; else if (i === 1) this.y = v; else if (i === 2) this.z = v; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  copy(v: Vec3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v: Vec3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: Vec3) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addVectors(a: Vec3, b: Vec3) { return this.set(a.x + b.x, a.y + b.y, a.z + b.z); }
  subVectors(a: Vec3, b: Vec3) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addScaledVector(v: Vec3, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  multiply(v: Vec3) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  negate() { return this.multiplyScalar(-1); }
  dot(v: Vec3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v: Vec3) { return this.crossVectors(this, v); }
  crossVectors(a: Vec3, b: Vec3) { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; return this.set(x, y, z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceToSquared(v: Vec3) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  distanceTo(v: Vec3) { return Math.sqrt(this.distanceToSquared(v)); }
  lerp(v: Vec3, t: number) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  lerpVectors(a: Vec3, b: Vec3, t: number) { return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
  applyQuaternion(q: Quat) {
    const { x, y, z } = this, { x: qx, y: qy, z: qz, w: qw } = q;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return this.set(x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx);
  }
  applyMatrix4(m: Mat4) {
    const e = m.elements, { x, y, z } = this;
    const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]! || 1);
    return this.set((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w, (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w, (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w);
  }
  transformDirection(m: Mat4) { const e = m.elements, { x, y, z } = this; return this.set(e[0]! * x + e[4]! * y + e[8]! * z, e[1]! * x + e[5]! * y + e[9]! * z, e[2]! * x + e[6]! * y + e[10]! * z).normalize(); }
  setFromMatrixPosition(m: Mat4) { const e = m.elements; return this.set(e[12]!, e[13]!, e[14]!); }
  fromArray(a: ArrayLike<number>, o = 0) { return this.set(a[o]!, a[o + 1]!, a[o + 2]!); }
  toArray(a: number[] | Float32Array = [], o = 0) { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a; }
  fromBufferAttribute(attr: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number) { return this.set(attr.getX(i), attr.getY(i), attr.getZ(i)); }
  min(v: Vec3) { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this; }
  max(v: Vec3) { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this; }
  equals(v: Vec3) { return this.x === v.x && this.y === v.y && this.z === v.z; }
}

export class Quat {
  _onChange: (() => void) | null = null;
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  private changed() { this._onChange?.(); return this; }
  set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this.changed(); }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  copy(q: Quat) { return this.set(q.x, q.y, q.z, q.w); }
  identity() { return this.set(0, 0, 0, 1); }
  setFromAxisAngle(axis: Vec3, angle: number) { const s = Math.sin(angle / 2); return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(angle / 2)); }
  setFromEuler(e: Euler, update = true) {
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2), s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2);
    let x: number, y: number, z: number, w: number;
    if (e.order === 'YXZ') { x = s1 * c2 * c3 + c1 * s2 * s3; y = c1 * s2 * c3 - s1 * c2 * s3; z = c1 * c2 * s3 - s1 * s2 * c3; w = c1 * c2 * c3 + s1 * s2 * s3; }
    else { x = s1 * c2 * c3 + c1 * s2 * s3; y = c1 * s2 * c3 - s1 * c2 * s3; z = c1 * c2 * s3 + s1 * s2 * c3; w = c1 * c2 * c3 - s1 * s2 * s3; } // XYZ
    this.x = x; this.y = y; this.z = z; this.w = w;
    if (update) this.changed();
    return this;
  }
  multiply(q: Quat) { return this.multiplyQuaternions(this, q); }
  premultiply(q: Quat) { return this.multiplyQuaternions(q, this); }
  multiplyQuaternions(a: Quat, b: Quat) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    return this.set(ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz);
  }
  invert() { return this.set(-this.x, -this.y, -this.z, this.w); } // unit quaternions
  normalize() { const l = Math.hypot(this.x, this.y, this.z, this.w) || 1; return this.set(this.x / l, this.y / l, this.z / l, this.w / l); }
  dot(q: Quat) { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w; }
  slerp(q: Quat, t: number) {
    let cos = this.dot(q);
    let bx = q.x, by = q.y, bz = q.z, bw = q.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (cos > 0.9995) return this.set(this.x + (bx - this.x) * t, this.y + (by - this.y) * t, this.z + (bz - this.z) * t, this.w + (bw - this.w) * t).normalize();
    const th = Math.acos(cos), s = Math.sin(th), a = Math.sin((1 - t) * th) / s, b = Math.sin(t * th) / s;
    return this.set(this.x * a + bx * b, this.y * a + by * b, this.z * a + bz * b, this.w * a + bw * b);
  }
  setFromRotationMatrix(m: Mat4) {
    const e = m.elements, m11 = e[0]!, m12 = e[4]!, m13 = e[8]!, m21 = e[1]!, m22 = e[5]!, m23 = e[9]!, m31 = e[2]!, m32 = e[6]!, m33 = e[10]!;
    const tr = m11 + m22 + m33;
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return this.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s); }
    if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); return this.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s); }
    if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); return this.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s); }
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22); return this.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
  }
  fromArray(a: ArrayLike<number>, o = 0) { return this.set(a[o]!, a[o + 1]!, a[o + 2]!, a[o + 3]!); }
}

export class Euler {
  _onChange: (() => void) | null = null;
  constructor(private _x = 0, private _y = 0, private _z = 0, public order: 'XYZ' | 'YXZ' = 'XYZ') {}
  get x() { return this._x; } set x(v) { this._x = v; this._onChange?.(); }
  get y() { return this._y; } set y(v) { this._y = v; this._onChange?.(); }
  get z() { return this._z; } set z(v) { this._z = v; this._onChange?.(); }
  set(x: number, y: number, z: number, order?: 'XYZ' | 'YXZ') { this._x = x; this._y = y; this._z = z; if (order) this.order = order; this._onChange?.(); return this; }
  setSilently(x: number, y: number, z: number) { this._x = x; this._y = y; this._z = z; }
}

export class Mat4 {
  elements = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  identity() { this.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); return this; }
  clone() { const m = new Mat4(); m.elements.set(this.elements); return m; }
  copy(m: Mat4) { this.elements.set(m.elements); return this; }
  fromArray(a: ArrayLike<number>, o = 0) { for (let i = 0; i < 16; i++) this.elements[i] = a[o + i]!; return this; }
  multiply(m: Mat4) { return this.multiplyMatrices(this, m); }
  premultiply(m: Mat4) { return this.multiplyMatrices(m, this); }
  multiplyMatrices(a: Mat4, b: Mat4) {
    const ae = a.elements, be = b.elements, te = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) te[c * 4 + r] = ae[r]! * be[c * 4]! + ae[4 + r]! * be[c * 4 + 1]! + ae[8 + r]! * be[c * 4 + 2]! + ae[12 + r]! * be[c * 4 + 3]!;
    this.elements.set(te);
    return this;
  }
  compose(p: Vec3, q: Quat, s: Vec3) {
    const e = this.elements, { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    e[0] = (1 - (yy + zz)) * s.x; e[1] = (xy + wz) * s.x; e[2] = (xz - wy) * s.x; e[3] = 0;
    e[4] = (xy - wz) * s.y; e[5] = (1 - (xx + zz)) * s.y; e[6] = (yz + wx) * s.y; e[7] = 0;
    e[8] = (xz + wy) * s.z; e[9] = (yz - wx) * s.z; e[10] = (1 - (xx + yy)) * s.z; e[11] = 0;
    e[12] = p.x; e[13] = p.y; e[14] = p.z; e[15] = 1;
    return this;
  }
  decompose(p: Vec3, q: Quat, s: Vec3) {
    const e = this.elements;
    let sx = Math.hypot(e[0]!, e[1]!, e[2]!);
    const sy = Math.hypot(e[4]!, e[5]!, e[6]!), sz = Math.hypot(e[8]!, e[9]!, e[10]!);
    if (this.determinant() < 0) sx = -sx;
    p.set(e[12]!, e[13]!, e[14]!);
    const m = this.clone(), me = m.elements;
    me[0] = me[0]! / sx; me[1] = me[1]! / sx; me[2] = me[2]! / sx;
    me[4] = me[4]! / sy; me[5] = me[5]! / sy; me[6] = me[6]! / sy;
    me[8] = me[8]! / sz; me[9] = me[9]! / sz; me[10] = me[10]! / sz;
    q.setFromRotationMatrix(m);
    s.set(sx, sy, sz);
    return this;
  }
  determinant() {
    const m = this.elements; // column-major: m[c*4+r]
    const a = (r: number, c: number) => m[c * 4 + r]!;
    const s0 = a(0, 0) * a(1, 1) - a(1, 0) * a(0, 1), s1 = a(0, 0) * a(1, 2) - a(1, 0) * a(0, 2), s2 = a(0, 0) * a(1, 3) - a(1, 0) * a(0, 3);
    const s3 = a(0, 1) * a(1, 2) - a(1, 1) * a(0, 2), s4 = a(0, 1) * a(1, 3) - a(1, 1) * a(0, 3), s5 = a(0, 2) * a(1, 3) - a(1, 2) * a(0, 3);
    const c5 = a(2, 2) * a(3, 3) - a(3, 2) * a(2, 3), c4 = a(2, 1) * a(3, 3) - a(3, 1) * a(2, 3), c3 = a(2, 1) * a(3, 2) - a(3, 1) * a(2, 2);
    const c2 = a(2, 0) * a(3, 3) - a(3, 0) * a(2, 3), c1 = a(2, 0) * a(3, 2) - a(3, 0) * a(2, 2), c0 = a(2, 0) * a(3, 1) - a(3, 0) * a(2, 1);
    return s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
  }
  invert() {
    const m = this.elements, inv = new Float64Array(16);
    inv[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]! + m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!;
    inv[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]! - m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!;
    inv[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]! + m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!;
    inv[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]! - m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!;
    inv[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]! - m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!;
    inv[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]! + m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!;
    inv[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]! - m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!;
    inv[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]! + m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!;
    inv[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]! + m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!;
    inv[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]! - m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!;
    inv[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]! + m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!;
    inv[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]! - m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!;
    inv[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]! - m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!;
    inv[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]! + m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!;
    inv[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]! - m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!;
    inv[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]! + m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!;
    const det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!;
    if (det === 0) return this.identity();
    for (let i = 0; i < 16; i++) m[i] = inv[i]! / det;
    return this;
  }
  makeTranslation(x: number, y: number, z: number) { this.identity(); this.elements[12] = x; this.elements[13] = y; this.elements[14] = z; return this; }
  makeScale(x: number, y: number, z: number) { this.identity(); this.elements[0] = x; this.elements[5] = y; this.elements[10] = z; return this; }
  makeRotationFromQuaternion(q: Quat) { return this.compose(new Vec3(), q, new Vec3(1, 1, 1)); }
  perspective(fovYDeg: number, aspect: number, near: number, far: number) {
    const f = 1 / Math.tan((fovYDeg * Math.PI) / 360), e = this.elements;
    e.fill(0); e[0] = f / aspect; e[5] = f; e[10] = (far + near) / (near - far); e[11] = -1; e[14] = (2 * far * near) / (near - far);
    return this;
  }
  orthographic(l: number, r: number, b: number, t: number, n: number, f: number) {
    const e = this.elements; e.fill(0);
    e[0] = 2 / (r - l); e[5] = 2 / (t - b); e[10] = -2 / (f - n); e[12] = -(r + l) / (r - l); e[13] = -(t + b) / (t - b); e[14] = -(f + n) / (f - n); e[15] = 1;
    return this;
  }
  lookAt(eye: Vec3, target: Vec3, up: Vec3) {
    const z = eye.clone().sub(target).normalize();
    if (z.lengthSq() === 0) z.z = 1;
    const x = up.clone().cross(z);
    if (x.lengthSq() < 1e-12) { z.x += 1e-4; z.normalize(); x.copy(up).cross(z); }
    x.normalize();
    const y = z.clone().cross(x);
    const e = this.elements;
    e[0] = x.x; e[1] = x.y; e[2] = x.z; e[3] = 0; e[4] = y.x; e[5] = y.y; e[6] = y.z; e[7] = 0; e[8] = z.x; e[9] = z.y; e[10] = z.z; e[11] = 0;
    return this;
  }
  toFloat32(out: Float32Array<ArrayBufferLike> = new Float32Array(16), o = 0) { for (let i = 0; i < 16; i++) out[o + i] = this.elements[i]!; return out; }
}

export class Box3 {
  constructor(public min = new Vec3(Infinity, Infinity, Infinity), public max = new Vec3(-Infinity, -Infinity, -Infinity)) {}
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  isEmpty() { return this.max.x < this.min.x; }
  expandByPoint(p: Vec3) { this.min.min(p); this.max.max(p); return this; }
  union(b: Box3) { this.min.min(b.min); this.max.max(b.max); return this; }
  getCenter(out = new Vec3()) { return out.addVectors(this.min, this.max).multiplyScalar(0.5); }
  getSize(out = new Vec3()) { return this.isEmpty() ? out.set(0, 0, 0) : out.subVectors(this.max, this.min); }
  containsPoint(p: Vec3) { return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y && p.z >= this.min.z && p.z <= this.max.z; }
  clone() { return new Box3(this.min.clone(), this.max.clone()); }
  applyMatrix4(m: Mat4) {
    if (this.isEmpty()) return this;
    const pts: Vec3[] = [];
    for (const x of [this.min.x, this.max.x]) for (const y of [this.min.y, this.max.y]) for (const z of [this.min.z, this.max.z]) pts.push(new Vec3(x, y, z).applyMatrix4(m));
    this.makeEmpty();
    for (const p of pts) this.expandByPoint(p);
    return this;
  }
  /** World-space bounds of a node subtree (geometry bounds × world matrices). */
  setFromObject(o: { updateMatrixWorld(force?: boolean): void; traverse(cb: (n: any) => void): void }) {
    this.makeEmpty();
    o.updateMatrixWorld(true);
    o.traverse((n: any) => {
      if (!n.geometry) return;
      const gb: Box3 = n.geometry.computeBoundingBox();
      if (n.instanceCount) return; // instanced bounds are per-instance; not needed here
      this.union(gb.clone().applyMatrix4(n.matrixWorld));
    });
    return this;
  }
}

export class Color {
  constructor(public r = 1, public g = 1, public b = 1) {}
  /** Hex is interpreted as sRGB-encoded (like CSS) and stored linear. */
  setHex(hex: number) { this.r = srgbToLinear(((hex >> 16) & 255) / 255); this.g = srgbToLinear(((hex >> 8) & 255) / 255); this.b = srgbToLinear((hex & 255) / 255); return this; }
  setRGB(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; return this; } // linear
  setHSL(h: number, s: number, l: number) {
    const f = (n: number) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return this.setRGB(srgbToLinear(f(0)), srgbToLinear(f(8)), srgbToLinear(f(4)));
  }
  copy(c: Color) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color(this.r, this.g, this.b); }
  multiplyScalar(s: number) { this.r *= s; this.g *= s; this.b *= s; return this; }
  lerp(c: Color, t: number) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  getHexString() { return [this.r, this.g, this.b].map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255).toString(16).padStart(2, '0')).join(''); }
  static hex(h: number) { return new Color().setHex(h); }
}
export type ColorLike = number | Color;
export const toColor = (c: ColorLike | undefined, fallback = 0xffffff) => (c instanceof Color ? c.clone() : new Color().setHex(c ?? fallback));

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
