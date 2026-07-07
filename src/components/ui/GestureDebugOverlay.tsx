import { useSyncExternalStore } from 'react';
import {
  subscribeGestureDebug, getGestureDebugSnapshot, isGestureDebugEnabled,
} from '../../lib/gestureDebug';

/**
 * ⚠ TEMPORARY (P1.3) — live on-device readout of the DraggableSheet gesture handoff. Self-gates to null when
 * the debug flag is off (always mounted in the sheet portal → cheap subscription). Deletable scaffolding.
 */
export function GestureDebugOverlay() {
  const on = useSyncExternalStore(subscribeGestureDebug, isGestureDebugEnabled, () => false);
  const st = useSyncExternalStore(subscribeGestureDebug, getGestureDebugSnapshot, getGestureDebugSnapshot);
  if (!on) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', left: 8, bottom: 8, zIndex: 99999, pointerEvents: 'none',
        font: '11px/1.35 var(--mono)', color: 'var(--green)',
        background: 'rgba(0,0,0,0.8)', border: '1px solid var(--line)', borderRadius: 6,
        padding: '6px 8px', whiteSpace: 'pre', maxWidth: '60vw',
      }}
    >
      {`phase   ${st.phase}
dy      ${Math.round(st.dy)}
scroll@ ${Math.round(st.scrollTopAtDown)}
claimed ${st.claimed ? 'Y' : 'n'}
active@ ${st.activeTagAtDown || '—'}
bail    ${st.lastBail || '—'}
cancel# ${st.cancelCount}`}
    </div>
  );
}
