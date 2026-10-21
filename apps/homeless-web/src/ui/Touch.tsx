import { useRef, useState } from 'react';
import type { Engine } from '../engine/engine';

/** Touch controls: left virtual stick (move), right half drag (look), action buttons. */
export function Touch({ e }: { e: Engine }) {
  const [stick, setStick] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const R = 56;
  const moveStart = (ev: React.PointerEvent) => {
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    setStick({ x: 0, y: 0, ox: ev.clientX, oy: ev.clientY });
  };
  const moveMove = (ev: React.PointerEvent) => {
    if (!stick) return;
    let dx = ev.clientX - stick.ox, dy = ev.clientY - stick.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    setStick({ ...stick, x: dx, y: dy });
    e.input.touchMove = { x: dx / R, y: -dy / R };
    if (l > R * 0.92) e.input.pressTouch('run'); else e.input.releaseTouch('run');
  };
  const moveEnd = () => { setStick(null); e.input.touchMove = { x: 0, y: 0 }; e.input.releaseTouch('run'); };
  const btn = (id: string, label: string) => (
    <button className="tbtn" data-testid={`touch-${id}`} onPointerDown={(ev) => { ev.preventDefault(); e.input.pressTouch(id); }} onPointerUp={() => e.input.releaseTouch(id)} onPointerLeave={() => e.input.releaseTouch(id)}>{label}</button>
  );
  return (
    <div className="touch">
      <div className="touch-move" data-testid="touch-move" onPointerDown={moveStart} onPointerMove={moveMove} onPointerUp={moveEnd} onPointerCancel={moveEnd}>
        {stick && <div className="stick-base" style={{ left: stick.ox - R, top: stick.oy - R, width: R * 2, height: R * 2 }}><div className="stick-knob" style={{ transform: `translate(${stick.x}px, ${stick.y}px)` }} /></div>}
      </div>
      <div className="touch-look" data-testid="touch-look"
        onPointerDown={(ev) => { lookId.current = ev.pointerId; last.current = { x: ev.clientX, y: ev.clientY }; (ev.target as HTMLElement).setPointerCapture(ev.pointerId); }}
        onPointerMove={(ev) => { if (lookId.current !== ev.pointerId) return; e.input.addLook((ev.clientX - last.current.x) * 1.6, (ev.clientY - last.current.y) * 1.6); last.current = { x: ev.clientX, y: ev.clientY }; }}
        onPointerUp={() => { lookId.current = null; }} />
      <div className="touch-buttons">{btn('interact', 'E')}{btn('vehicle', 'F')}{btn('jump', '⤒')}{btn('brake', 'Brake')}</div>
    </div>
  );
}
