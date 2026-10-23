import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Engine, type Quality } from '../engine/engine';
import { makeTampaRegion } from '../engine/tampaRegion';
import { Hud } from './Hud';
import { Touch } from './Touch';
import { TravelPanel } from './TravelPanel';
import { SignConsole } from './SignConsole';
import * as persist from '../engine/persist';
import { Vec3 } from '@astro/core';

declare global { interface Window { __dark?: Engine } }

function autoQuality(): Quality {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.hardwareConcurrency ?? 4) <= 4 ? 'low' : 'high';
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [started, setStarted] = useState(false);
  const [quality] = useState<Quality>(autoQuality);
  const [panel, setPanel] = useState<'none' | 'travel' | 'sign' | 'research' | 'settings'>('none');
  const [hasSave, setHasSave] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const e = new Engine(canvas, quality);
    window.__dark = e;
    setEngine(e);
    let cancelled = false;
    (async () => {
      try {
        await e.init();
        await e.enterRegion(() => makeTampaRegion(e));
        if (cancelled) return;
        e.openTravel = () => setPanel('travel');
        e.openSignConsole = () => setPanel('sign');
        e.start();
        setHasSave(!!(await persist.load('auto')));
      } catch (err) {
        console.error(err);
        e.hud.error = String((err as Error)?.stack ?? err);
        e.setLoading(null);
      }
    })();
    return () => { cancelled = true; e.stop(); };
  }, [quality]);

  const hud = useSyncExternalStore(engine?.subscribe ?? (() => () => {}), engine?.getHud ?? (() => null));

  const enter = async (resume: boolean) => {
    if (!engine) return;
    await engine.unlockAudio().catch(() => {});
    if (resume) {
      const s = await persist.load('auto');
      if (s && s.location.name.startsWith('Tampa')) {
        engine.gameUtc = s.gameUtc;
        engine.player.teleport(new Vec3(s.player.x, s.player.y + 0.1, s.player.z));
        engine.rig.yaw = s.player.yaw;
        engine.restoreNpcs(s.npcs);
        if (s.settings.haptics) engine.haptics.preference = s.settings.haptics as never;
      }
    }
    setStarted(true);
  };

  return (
    <div className="app">
      <canvas ref={canvasRef} className="view" data-testid="view" />
      {hud && engine && (
        <>
          {!started && (
            <div className="start">
              <div className="start-card">
                <h1>HOMELESS</h1>
                <p className="sub">on the DARK engine · web-native</p>
                <p className="lede">A source-anchored Tampa street at the corner of N Dale Mabry Hwy and W Spruce St. Roads and building footprints are OpenStreetMap; façades, the café, its people and its weather are fictional.</p>
                {hud.loading ? <div className="loading"><div className="bar"><span style={{ width: `${Math.round(hud.loadProgress * 100)}%` }} /></div><span>{hud.loading}</span></div> : null}
                {hud.error && <pre className="error">{hud.error}</pre>}
                <div className="start-actions">
                  <button disabled={!hud.ready} onClick={() => void enter(false)} data-testid="enter">Enter the street</button>
                  {hasSave && <button disabled={!hud.ready} className="secondary" onClick={() => void enter(true)}>Continue</button>}
                </div>
                <p className="fine">Keyboard: WASD move · Shift run · drag to look · E talk/use · F car · Space jump/brake · Esc pause. Touch: left stick, right side to look. Audio starts on Enter. Haptics are off until you enable them.</p>
              </div>
            </div>
          )}
          {started && <Hud e={engine} hud={hud} onPanel={setPanel} panel={panel} />}
          {started && <Touch e={engine} />}
          {started && panel === 'travel' && <TravelPanel e={engine} onClose={() => setPanel('none')} />}
          {started && panel === 'sign' && <SignConsole e={engine} onClose={() => setPanel('none')} />}
        </>
      )}
    </div>
  );
}
