import type { Engine } from '../engine/engine';

export function TravelPanel({ e, onClose }: { e: Engine; onClose: () => void }) {
  void e;
  return (
    <div className="panel travel" data-testid="travel">
      <h3>World</h3>
      <button className="secondary" onClick={onClose}>Close</button>
    </div>
  );
}
