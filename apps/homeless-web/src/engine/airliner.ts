// Generic unbranded twin-engine airliner, authored procedurally (no free licensed
// airliner master exists in the repository). Lathe fuselage with nose/tail taper,
// swept wings from an airfoil-like extrusion, nacelles, tailplanes, window band.
// Data status: authored. It is not a model of any real aircraft type.
import { Group, Mesh, Material, latheGeometry, cylinderGeometry, circleGeometry, boxGeometry, extrudeOutline } from '@astro/core';

type P = { x: number; y: number };
/** Cubic Bézier sampled into polyline points (the outline helper replaces a Shape type). */
function bezier(a: P, c1: P, c2: P, b: P, n = 12): P[] {
  const out: P[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y });
  }
  return out;
}

export function makeAirliner(livery = 0x1d3557): Group {
  const g = new Group();
  g.name = 'airliner (authored, generic)';
  const L = 38, R = 2.0;
  // fuselage profile along y, lathed, then rotated to lie along z (nose at −z)
  const pts: P[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    let r = R;
    if (t < 0.12) r = R * Math.sqrt(1 - ((0.12 - t) / 0.12) ** 2) * 0.98 + 0.02; // nose
    if (t > 0.78) r = R * (1 - ((t - 0.78) / 0.22) ** 1.6 * 0.82); // tail cone
    pts.push({ x: Math.max(0.05, r), y: t * L });
  }
  const body = latheGeometry(pts, 48).rotateX(Math.PI / 2).translate(0, 0, -L / 2); // nose at −z
  // the tail cone sweeps upward: lift vertices progressively toward the tail
  const p = body.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i) + L / 2; const t = z / L; if (t > 0.78) p.setY(i, p.getY(i) + (t - 0.78) * 7); }
  body.computeVertexNormals();
  const paint = new Material({ color: 0xf2f2f0, roughness: 0.28, metalness: 0.1, clearcoat: 0.6, name: 'airliner-paint' });
  const fus = new Mesh(body, windowBandMaterial(paint, L));
  fus.castShadow = fus.receiveShadow = true;
  g.add(fus);
  // belly stripe and tail livery
  const stripe = new Mesh(cylinderGeometry(R * 1.003, R * 1.003, L * 0.62, 48, true, Math.PI * 0.55, Math.PI * 0.9).rotateX(Math.PI / 2).translate(0, 0, -1), new Material({ color: livery, roughness: 0.3, clearcoat: 0.6, side: 'double', name: 'livery' }));
  g.add(stripe);
  // wings: airfoil section extruded, swept 25°, dihedral 5°
  const af: P[] = [{ x: 0, y: 0 }, ...bezier({ x: 0, y: 0 }, { x: 0.6, y: 0.32 }, { x: 2.6, y: 0.3 }, { x: 5.2, y: 0.02 }), { x: 5.2, y: -0.02 }, ...bezier({ x: 5.2, y: -0.02 }, { x: 2.6, y: -0.08 }, { x: 0.6, y: -0.1 }, { x: 0, y: 0 }).slice(0, -1)];
  const wingMat = new Material({ color: 0xd9dbdf, roughness: 0.35, metalness: 0.35, side: 'double', name: 'wing' });
  for (const s of [-1, 1]) {
    // build in final coordinates: chord runs toward the tail (+z), span along ±x, 25° sweep, 5° dihedral
    const wingGeo = extrudeOutline(af, 16, 8);
    const wp = wingGeo.getAttribute('position');
    for (let i = 0; i < wp.count; i++) {
      const chord = wp.getX(i), thick = wp.getY(i), span = wp.getZ(i) / 16;
      const taper = 1 - 0.62 * span;
      wp.setXYZ(i, s * (1.4 + span * 16), -1.1 + thick * taper + span * 1.3, -2.6 + chord * taper + span * 6.5);
    }
    wingGeo.computeVertexNormals();
    const w = new Mesh(wingGeo, wingMat);
    w.castShadow = true;
    g.add(w);
    // engine nacelle under each wing
    const nac = new Mesh(cylinderGeometry(0.95, 0.8, 3.6, 32, true).rotateX(Math.PI / 2), new Material({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.6, side: 'double', name: 'nacelle' }));
    nac.position.set(s * 5.4, -1.9, -4.2); nac.castShadow = true; g.add(nac);
    const fan = new Mesh(circleGeometry(0.88, 32), new Material({ color: 0x1a1c20, metalness: 0.8, roughness: 0.3, name: 'fan' }));
    fan.position.set(s * 5.4, -1.9, -5.9); fan.rotation.y = Math.PI; fan.name = 'fan'; g.add(fan);
    const pylon = new Mesh(boxGeometry(0.3, 0.9, 2.4), wingMat); pylon.position.set(s * 5.4, -1.2, -3.8); g.add(pylon);
  }
  // vertical and horizontal tail
  const fin: P[] = [{ x: 0, y: 0 }, { x: 4.6, y: 0 }, { x: 5.8, y: 5.6 }, { x: 4.0, y: 5.6 }];
  const finM = new Mesh(extrudeOutline(fin, 0.28).translate(0, 0, -0.14).rotateY(-Math.PI / 2), new Material({ color: livery, roughness: 0.3, clearcoat: 0.6 }));
  finM.position.set(0, 1.7, L / 2 - 6.4); finM.castShadow = true; g.add(finM);
  for (const s of [-1, 1]) {
    const hs = new Mesh(boxGeometry(6, 0.18, 2.2).translate(s * 3.2, 0, 0), wingMat);
    hs.position.set(0, 2.0, L / 2 - 2.6); hs.rotation.y = s * 0.35; hs.castShadow = true; g.add(hs);
  }
  // landing gear
  const gearMat = new Material({ color: 0x222428, roughness: 0.6, name: 'gear' });
  for (const [x, z] of [[0, -L / 2 + 5], [-2.6, 1.2], [2.6, 1.2]] as const) {
    const strut = new Mesh(cylinderGeometry(0.1, 0.1, 1.6, 8), MAT_CHROME); strut.position.set(x, -2.4, z); g.add(strut);
    const tyre = new Mesh(cylinderGeometry(0.55, 0.55, 0.4, 20).rotateZ(Math.PI / 2), gearMat); tyre.position.set(x, -3.15, z); tyre.castShadow = true; g.add(tyre);
  }
  g.position.y = 3.7; // tyres on the ground at y = 0
  const holder = new Group();
  holder.add(g);
  return holder;
}

const MAT_CHROME = new Material({ color: 0xb0b4ba, metalness: 1, roughness: 0.25, name: 'chrome' });

/** Window band + cockpit glazing as a typed shader feature on the fuselage (object-space z = length). */
function windowBandMaterial(base: Material, L: number): Material {
  base.feature = 'windows';
  base.uniforms.uFuselageHalf = L / 2;
  base.uniforms.uFuselageWin = L * 0.76;
  return base;
}
