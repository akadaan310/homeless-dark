// Generic unbranded twin-engine airliner, authored procedurally (no free licensed
// airliner master exists in the repository). Lathe fuselage with nose/tail taper,
// swept wings from an airfoil-like extrusion, nacelles, tailplanes, window band.
// Data status: authored. It is not a model of any real aircraft type.
import * as THREE from 'three';

export function makeAirliner(livery = 0x1d3557): THREE.Group {
  const g = new THREE.Group();
  g.name = 'airliner (authored, generic)';
  const L = 38, R = 2.0;
  // fuselage profile along y, lathed, then rotated to lie along z (nose at −z)
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    let r = R;
    if (t < 0.12) r = R * Math.sqrt(1 - ((0.12 - t) / 0.12) ** 2) * 0.98 + 0.02; // nose
    if (t > 0.78) r = R * (1 - ((t - 0.78) / 0.22) ** 1.6 * 0.82); // tail cone
    pts.push(new THREE.Vector2(Math.max(0.05, r), t * L));
  }
  const body = new THREE.LatheGeometry(pts, 48).rotateX(Math.PI / 2).translate(0, 0, -L / 2); // nose at −z
  // the tail cone sweeps upward: lift vertices progressively toward the tail
  const p = body.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i) + L / 2; const t = z / L; if (t > 0.78) p.setY(i, p.getY(i) + (t - 0.78) * 7); }
  body.computeVertexNormals();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.28, metalness: 0.1, clearcoat: 0.6 });
  const fus = new THREE.Mesh(body, windowBandMaterial(paint, L));
  fus.castShadow = fus.receiveShadow = true;
  g.add(fus);
  // belly stripe and tail livery
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.003, R * 1.003, L * 0.62, 48, 1, true, Math.PI * 0.55, Math.PI * 0.9).rotateX(Math.PI / 2).translate(0, 0, -1), new THREE.MeshPhysicalMaterial({ color: livery, roughness: 0.3, clearcoat: 0.6, side: THREE.DoubleSide }));
  g.add(stripe);
  // wings: airfoil section extruded, swept 25°, dihedral 5°
  const af = new THREE.Shape();
  af.moveTo(0, 0); af.bezierCurveTo(0.6, 0.32, 2.6, 0.3, 5.2, 0.02); af.lineTo(5.2, -0.02); af.bezierCurveTo(2.6, -0.08, 0.6, -0.1, 0, 0);
  const wingMat = new THREE.MeshPhysicalMaterial({ color: 0xd9dbdf, roughness: 0.35, metalness: 0.35, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    // build in final coordinates: chord runs toward the tail (+z), span along ±x, 25° sweep, 5° dihedral
    const wingGeo = new THREE.ExtrudeGeometry(af, { depth: 16, bevelEnabled: false, steps: 8 });
    const wp = wingGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < wp.count; i++) {
      const chord = wp.getX(i), thick = wp.getY(i), span = wp.getZ(i) / 16;
      const taper = 1 - 0.62 * span;
      wp.setXYZ(i, s * (1.4 + span * 16), -1.1 + thick * taper + span * 1.3, -2.6 + chord * taper + span * 6.5);
    }
    wingGeo.computeVertexNormals();
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.castShadow = true;
    g.add(w);
    // engine nacelle under each wing
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.8, 3.6, 32, 1, true).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide }));
    nac.position.set(s * 5.4, -1.9, -4.2); nac.castShadow = true; g.add(nac);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.88, 32), new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.8, roughness: 0.3 }));
    fan.position.set(s * 5.4, -1.9, -5.9); fan.rotation.y = Math.PI; fan.name = 'fan'; g.add(fan);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 2.4), wingMat); pylon.position.set(s * 5.4, -1.2, -3.8); g.add(pylon);
  }
  // vertical and horizontal tail
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(4.6, 0); fin.lineTo(5.8, 5.6); fin.lineTo(4.0, 5.6); fin.lineTo(0, 0);
  const finM = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.28, bevelEnabled: false }).translate(0, 0, -0.14).rotateY(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: livery, roughness: 0.3, clearcoat: 0.6 }));
  finM.position.set(0, 1.7, L / 2 - 6.4); finM.castShadow = true; g.add(finM);
  for (const s of [-1, 1]) {
    const hs = new THREE.Mesh(new THREE.BoxGeometry(6, 0.18, 2.2).translate(s * 3.2, 0, 0), wingMat);
    hs.position.set(0, 2.0, L / 2 - 2.6); hs.rotation.y = s * 0.35; hs.castShadow = true; g.add(hs);
  }
  // landing gear
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6 });
  for (const [x, z] of [[0, -L / 2 + 5], [-2.6, 1.2], [2.6, 1.2]] as const) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), MAT_CHROME); strut.position.set(x, -2.4, z); g.add(strut);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 20).rotateZ(Math.PI / 2), gearMat); tyre.position.set(x, -3.15, z); tyre.castShadow = true; g.add(tyre);
  }
  g.position.y = 3.7; // tyres on the ground at y = 0
  const holder = new THREE.Group();
  holder.add(g);
  return holder;
}

const MAT_CHROME = new THREE.MeshStandardMaterial({ color: 0xb0b4ba, metalness: 1, roughness: 0.25 });

/** Window band + cockpit glazing as a shader detail on the fuselage (u = angle, v = length). */
function windowBandMaterial(base: THREE.MeshPhysicalMaterial, L: number): THREE.MeshPhysicalMaterial {
  base.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vLocal;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float zz = vLocal.z + ${(L / 2).toFixed(2)};
        float side = abs(vLocal.x);
        float band = step(1.55, side) * step(abs(vLocal.y - 0.45), 0.24) * step(5.0, zz) * step(zz, ${(L * 0.76).toFixed(2)});
        float win = band * step(0.42, fract(zz / 0.82)) * step(fract(zz / 0.82), 0.82);
        float cockpit = step(zz, 2.6) * step(1.6, zz) * step(0.35, vLocal.y) * step(vLocal.y, 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.05, 0.07), clamp(win + cockpit, 0.0, 1.0));`);
  };
  base.customProgramCacheKey = () => 'airliner-windows';
  return base;
}
