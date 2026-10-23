import { useEffect, useState } from 'react';
import type { Engine, HudState } from '../engine/engine';

type Panel = 'none' | 'travel' | 'sign' | 'research' | 'settings';

export function Hud({ e, hud, panel, onPanel }: { e: Engine; hud: HudState; panel: Panel; onPanel: (p: Panel) => void }) {
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === 'INPUT' || (ev.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (ev.code === 'Escape') { if (panel !== 'none') onPanel('none'); else if (hud.dialog) e.closeDialog(); else e.pause(!e.paused); }
      if (ev.code === 'KeyM') onPanel(panel === 'travel' ? 'none' : 'travel');
      if (ev.code === 'KeyR' && ev.shiftKey) e.resetToSpawn();
      if (ev.code === 'Backquote') onPanel(panel === 'research' ? 'none' : 'research');
      if (hud.dialog && /^Digit[1-9]$/.test(ev.code)) { const o = hud.dialog.options[Number(ev.code.slice(5)) - 1]; if (o) e.choose(hud.dialog.npc, o.id); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [e, hud.dialog, panel, onPanel]);

  const [devOpen, setDevOpen] = useState(() => { try { return localStorage.getItem('dark.dev') !== '0'; } catch { return true; } });
  const toggleDev = () => { const v = !devOpen; setDevOpen(v); try { localStorage.setItem('dark.dev', v ? '1' : '0'); } catch { /* storage unavailable */ } };
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); };
  const extra = hud.extra as { carKmh?: number; inCar?: boolean; signal?: string; npcs?: { name: string; activity: string; reason: string; trust: number; state: string }[]; tiers?: Record<string, number>; signText?: string; travel?: Record<string, unknown> };
  return (
    <>
      <div className="hud-tl" data-testid="hud-location">
        <div className="place">{hud.region}</div>
        <div className="meta">{hud.lat.toFixed(5)}°, {hud.lon.toFixed(5)}° · {hud.localTime} · ×{hud.timeScale}</div>
        <div className="meta">{hud.profile} · EV {hud.exposureEV >= 0 ? '+' : ''}{hud.exposureEV} · {hud.rain > 0 ? `rain ${Math.round(hud.rain * 100)}%` : 'dry'} · wet {Math.round(hud.wetness * 100)}%</div>
        {extra.inCar && <div className="meta strong">{extra.carKmh} km/h · signal {extra.signal}</div>}
      </div>
      <div className="hud-corner">
        <button onClick={fullscreen} aria-label="Full screen" data-testid="btn-fullscreen">⛶</button>
        <button onClick={toggleDev} aria-label="Toggle menus" data-testid="btn-dev">{devOpen ? '✕' : '☰'}</button>
      </div>
      {devOpen && <><div className="hud-tr" data-testid="hud-perf">
        <span>{hud.fps} fps</span><span>p95 {hud.p95} ms</span><span>{hud.drawCalls} draws</span>
        <span className={hud.audio ? 'ok' : 'warn'}>{hud.audio ? (hud.hrtf ? 'HRTF audio' : 'audio') : 'audio locked'}</span>
      </div>
      <div className="hud-menu">
        <button onClick={() => onPanel(panel === 'travel' ? 'none' : 'travel')} data-testid="btn-travel">World</button>
        <button onClick={() => e.toggleRain()} data-testid="btn-rain">{hud.rain > 0 ? 'Stop rain' : 'Rain'}</button>
        <button onClick={() => { e.timeScale = e.timeScale === 1 ? 20 : e.timeScale === 20 ? 120 : 1; }} data-testid="btn-time">Time ×{hud.timeScale}</button>
        <button onClick={() => onPanel(panel === 'settings' ? 'none' : 'settings')}>Settings</button>
        <button onClick={() => onPanel(panel === 'research' ? 'none' : 'research')} data-testid="btn-research">Research</button>
        <button onClick={() => e.pause(!hud.paused)} data-testid="btn-pause">{hud.paused ? 'Resume' : 'Pause'}</button>
      </div></>}
      {hud.prompt && !hud.dialog && <div className="prompt" data-testid="prompt">{hud.prompt}</div>}
      <div className="captions" aria-live="polite" data-testid="captions">
        {hud.captions.slice(-3).map((c, i) => <div key={i} className="caption"><b>{c.speaker.replace('npc:', '').replace(/^./, (x) => x.toUpperCase())}</b> {c.text}</div>)}
      </div>
      {hud.dialog && (
        <div className="dialog" data-testid="dialog">
          <div className="dialog-title">{hud.dialog.name} <span className="fict">fictional resident</span></div>
          {hud.dialog.options.map((o, i) => <button key={o.id} onClick={() => e.choose(hud.dialog!.npc, o.id)} data-testid={`opt-${o.id}`}><kbd>{i + 1}</kbd> {o.label}</button>)}
        </div>
      )}
      {hud.paused && <div className="paused"><div><h2>Paused</h2><button onClick={() => e.pause(false)}>Resume</button><button className="secondary" onClick={() => { e.resetToSpawn(); e.pause(false); }}>Reset to safe spawn</button></div></div>}
      {hud.error && <div className="toast warn">{hud.error}</div>}
      {panel === 'research' && <Research e={e} hud={hud} />}
      {panel === 'settings' && <Settings e={e} hud={hud} />}
      {hud.refusals[0] && <div className="refusal" data-testid="refusal">Refused · {hud.refusals[0].type}: {hud.refusals[0].reason}</div>}
    </>
  );
}

function Research({ e, hud }: { e: Engine; hud: HudState }) {
  const extra = hud.extra as { npcs?: { name: string; activity: string; reason: string; trust: number; state: string }[]; tiers?: Record<string, number>; stats?: Record<string, number>; colorAuditOk?: boolean; colorAuditCount?: number; physicsStepMs?: number; journal?: number };
  const vp = e.visualProgram();
  return (
    <div className="panel research" data-testid="research">
      <h3>Six-division trace</h3>
      <ul className="trace">{hud.trace.slice(0, 14).map((t, i) => <li key={i}><span className="div">{t.division}</span>{t.text}</li>)}</ul>
      <h3>Committed events</h3>
      <ul className="events">{hud.events.slice(0, 10).map((ev) => <li key={ev.id}><code>{ev.id}</code> {ev.type} · {ev.actor} · {ev.t}</li>)}</ul>
      <h3>Residents (fictional)</h3>
      <ul>{extra.npcs?.map((n) => <li key={n.name}>{n.name}: {n.activity} ({n.state}) — {n.reason}; trust {n.trust}</li>)}</ul>
      <p className="meta">World Loom tiers: {Object.entries(extra.tiers ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
      <h3>Chromastratum VisualProgram</h3>
      <p className="meta">{vp.ok ? `admitted: ${vp.recipe!.mode} / ${vp.recipe!.weather} / ${vp.recipe!.toneMapping}, ${vp.recipe!.dynamicLights} dynamic light classes, wetness ${vp.recipe!.wetness}` : vp.errors.join('; ')}</p>
      <p className="meta">colour-space audit: {extra.colorAuditOk ? 'all maps annotated correctly' : 'MISMATCH'} ({extra.colorAuditCount} maps) · physics {extra.physicsStepMs} ms/frame · journal {extra.journal} events</p>
      <h3>Data status</h3>
      <ul className="sources">{hud.sources.map((s) => <li key={s.id}><span className={`status ${s.status}`}>{s.status}</span> {s.id}: {s.note}</li>)}</ul>
      <p className="meta">frame p50 {hud.p50} / p95 {hud.p95} / p99 {hud.p99} ms · {hud.triangles.toLocaleString()} triangles{hud.heapMB ? ` · heap ${hud.heapMB} MB` : ''}</p>
    </div>
  );
}

function Settings({ e, hud }: { e: Engine; hud: HudState }) {
  return (
    <div className="panel settings" data-testid="settings">
      <h3>Haptics</h3>
      <p className="meta">Driver: {hud.hapticDriver}. Off by default; every pulse is short, rate-limited and budgeted.</p>
      <div className="row">{(['OFF', 'LOW', 'NORMAL'] as const).map((p) => <button key={p} className={hud.haptics === p ? 'on' : ''} onClick={() => { e.haptics.preference = p; if (p !== 'OFF') e.haptics.request('TAP', performance.now()); }}>{p}</button>)}
        <button className="secondary" onClick={() => { e.haptics.muted = !e.haptics.muted; }}>Emergency mute</button></div>
      <h3>Audio</h3>
      <div className="row">{(['world', 'voice', 'music', 'vehicles', 'rain'] as const).map((b) => (
        <label key={b}>{b}<input type="range" min={0} max={1} step={0.05} defaultValue={e.audio.volumes[b]} onChange={(ev) => e.audio.setVolume(b, Number(ev.target.value))} /></label>
      ))}<button className="secondary" onClick={() => e.audio.setMuted(!e.audio.muted)}>Mute all</button></div>
      <h3>Comfort</h3>
      <div className="row">
        <label><input type="checkbox" onChange={(ev) => { e.signs.reducedMotion = ev.target.checked; e.atmo.reducedFlash = ev.target.checked; }} /> Reduced motion & flash</label>
        <label>Exposure adaptation speed<input type="range" min={0.2} max={2} step={0.05} defaultValue={e.atmo.maxEVPerSecond} onChange={(ev) => { e.atmo.maxEVPerSecond = Number(ev.target.value); }} /></label>
      </div>
      <h3>Time of day</h3>
      <div className="row">{[7, 12, 17.5, 19, 21, 23.5].map((h) => <button key={h} onClick={() => e.setTimeOfDay(h)}>{Math.floor(h)}:{h % 1 ? '30' : '00'}</button>)}</div>
      <p className="meta">Quality tier: {e.quality} (add ?quality=low|high to the URL). Weather and residents are fictional; the clock drives the real solar position for this latitude/longitude.</p>
    </div>
  );
}
