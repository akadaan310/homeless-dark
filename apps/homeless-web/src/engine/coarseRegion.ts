// Any coordinate on Earth: coarse GEBCO terrain + Natural Earth coast, an authored
// arrival marker with an honest data-status sign, and safe spawning (never into
// unloaded tiles or deep water). Oceans and poles are valid world cells, not roads.
import { Mesh, Material, Vec3, boxGeometry, cylinderGeometry } from '@astro/core';
import type { WorldCellManifest } from '@dark/geo';
import type { Engine } from './engine';
import type { Region, Interactable } from './region';
import { buildCoarseTerrain } from './coarse';
import { globe } from './globe';
import { signEntity } from './signs';
import { MAT } from './materials';

export interface CoarseOptions { name: string; lat: number; lon: number; signal?: AbortSignal; extraLabel?: string }

export async function makeCoarseRegion(e: Engine, o: CoarseOptions): Promise<Region & { manifest: WorldCellManifest }> {
  const manifest = await globe.resolve(o.lat, o.lon);
  const t = await buildCoarseTerrain(e.phys, o.lat, o.lon, { halfKm: e.quality === 'low' ? 12 : 22, n: e.quality === 'low' ? 97 : 161, signal: o.signal, onProgress: (m, p) => e.setLoading(m, p) });
  const g = t.group;
  // safe spawn: land → terrain height; ocean → authored survey platform (fictional), never the sea floor
  let spawn: Vec3;
  if (t.centerOcean) {
    const deck = new Mesh(boxGeometry(8, 0.6, 8), new Material({ color: 0xcfc6b2, roughness: 0.8 }));
    deck.position.set(0, 0.6, 0); deck.castShadow = deck.receiveShadow = true;
    g.add(deck);
    for (const [x, z] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]] as const) {
      const post = new Mesh(cylinderGeometry(0.25, 0.25, 6, 12), MAT.metal(0x8a6b45));
      post.position.set(x, -2, z); g.add(post);
    }
    t.surfaces.set(e.phys.fixedBox(deck.position.clone(), new Vec3(4, 0.3, 4)).handle, 'wood');
    spawn = new Vec3(0, 0.95, 1.5);
  } else spawn = new Vec3(0, t.heightAt(0, 0) + 0.3, 2);
  // arrival marker with the reality contract written on it
  const country = manifest.country ?? (t.centerOcean ? 'open ocean' : 'no admin label');
  const markerBase = new Vec3(0, t.centerOcean ? 0.9 : t.heightAt(0, -2), -2);
  const stele = new Mesh(boxGeometry(2.4, 2.2, 0.35), new Material({ color: 0x2b2f36, roughness: 0.5, metalness: 0.2 }));
  stele.position.copy(markerBase).add(new Vec3(0, 1.1, 0)); stele.castShadow = true; g.add(stele);
  e.phys.fixedBox(stele.position.clone(), new Vec3(1.2, 1.1, 0.2));
  const title = e.signs.create(signEntity('arrival-title', 'wayfinding', o.name, 2.2, 0.55, { fictional: false, emission: { hue: 80, chroma: 0.08, lightness: 0.92, brightness: 0.7 } }), { panelColor: 0x1b1e23 });
  title.group.position.copy(markerBase).add(new Vec3(0, 1.75, 0.2)); g.add(title.group);
  const roads = manifest.layers.find((l) => l.layer === 'roads-buildings')!;
  const info = e.signs.create(signEntity('arrival-info', 'diegetic_interface', `${o.lat.toFixed(3)}°, ${o.lon.toFixed(3)}° · ${country} · terrain GEBCO 6' (model) · roads ${roads.status}`, 2.2, 0.8, { fictional: false, emission: { hue: 200, chroma: 0.05, lightness: 0.85, brightness: 0.5 } }), { panelColor: 0x1b1e23 });
  info.group.position.copy(markerBase).add(new Vec3(0, 0.95, 0.2)); g.add(info.group);

  let lastSafe = spawn.clone();
  let warnT = 0;
  const region: Region & { manifest: WorldCellManifest } = {
    id: `coarse:${o.lat.toFixed(3)},${o.lon.toFixed(3)}`, kind: 'coarse', name: o.name, lat: o.lat, lon: o.lon,
    group: g, surfaces: t.surfaces, spawn, spawnYaw: 0, interiors: [], manifest,
    sourceLabels: [
      ...manifest.layers.map((l) => ({ id: l.layer, status: l.status, note: `${l.source ?? '—'}; ${l.note}` })),
      { id: 'marker', status: 'authored' as const, note: t.centerOcean ? 'survey platform and marker are fictional' : 'arrival marker is fictional' },
      { id: 'terrain-stats', status: 'derived' as const, note: `${t.stats.tiles} tiles, ${t.stats.vertices} vertices, ${t.stats.minH}…${t.stats.maxH} m, land ${(t.landFraction * 100).toFixed(0)}%` },
      ...(o.extraLabel ? [{ id: 'note', status: 'authored' as const, note: o.extraLabel }] : []),
    ],
    frame(dt) {
      // deep water guard: swimming is not implemented; return to the last safe footing
      const p = e.playerPos();
      const deep = t.oceanAt(p.x, p.z) && p.y < -1.2;
      if (deep) {
        e.player.teleport(lastSafe);
        warnT = 3;
        e.world.refusals.push({ ev: { type: 'MOVE', actor: 'player', payload: {} }, reason: 'deep water: swimming is not implemented; returned to safe footing' });
      } else if (e.player.grounded) lastSafe.copy(p).setY(p.y + 0.2);
      warnT = Math.max(0, warnT - dt);
      e.audio.setSurf(t.oceanAt(p.x, p.z) || t.centerOcean ? 1 : Math.max(0, 1 - Math.abs(t.heightAt(p.x, p.z)) / 40), performance.now() / 1000);
    },
    interactables(): Interactable[] {
      return [{ id: 'travel', label: 'Open the world map', pos: markerBase, radius: 3, action: (en) => en.openTravel?.() }];
    },
    hudExtra: () => ({ terrain: t.stats, ocean: t.centerOcean, country }),
    dispose() { e.audio.setSurf(0, 0); },
  };
  return region;
}
