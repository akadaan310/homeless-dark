import { useState } from 'react';
import { compileProgram, unfoldProgram } from '@dark/core';
import type { Engine } from '../engine/engine';

const EXAMPLES = [
  'v1:sign/cafe-sign/START/TEXT:OPEN%20LATE/HUE:330/BRIGHTNESS:0.9/COMMIT',
  'v1:sign/cafe-sign/START/TEXT:WARM%20INSIDE/HUE:40/CHIME:7/COMMIT',
  'v1:sign/cafe-sign/START/HUE:999/COMMIT',
  'v1:sign/cafe-sign/START/PULSE:4/COMMIT',
];

/** Inspect (read-only) and submit a typed sign programme. Inspecting never mutates the world. */
export function SignConsole({ e, onClose }: { e: Engine; onClose: () => void }) {
  const [src, setSrc] = useState(EXAMPLES[0]!);
  const [result, setResult] = useState<string>('');
  const inspected = compileProgram(src, new Set(['sign/cafe-sign']));
  return (
    <div className="panel sign" data-testid="sign-console">
      <h3>Café sign programme <span className="fict">sign owner: Bo (fictional)</span></h3>
      <p className="meta">A versioned path programme compiled by the WorldProgramCompiler. It runs only between START and COMMIT, with typed, flash-safe arguments, and only with the owner's consent.</p>
      <textarea value={src} onChange={(ev) => setSrc(ev.target.value)} rows={3} spellCheck={false} data-testid="sign-src" />
      <div className="row">{EXAMPLES.map((x, i) => <button key={i} className="secondary" onClick={() => setSrc(x)}>example {i + 1}</button>)}</div>
      <div className={`inspect ${inspected.ok ? 'ok' : 'bad'}`}>
        <b>{inspected.ok ? 'admissible' : 'refused'}</b> · states {inspected.states.join(' → ')}
        <ul>{(inspected.ok ? unfoldProgram(inspected) : inspected.diagnostics).map((d, i) => <li key={i}><code>{d}</code></li>)}</ul>
      </div>
      <div className="row">
        <button onClick={() => { const r = e.programSign?.(src); setResult(r ? (r.ok ? 'Committed: the sign changes in the street.' : `Refused: ${r.reason}`) : 'No sign here.'); }} data-testid="sign-submit">Submit</button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>
      {result && <p className="meta strong" data-testid="sign-result">{result}</p>}
    </div>
  );
}
