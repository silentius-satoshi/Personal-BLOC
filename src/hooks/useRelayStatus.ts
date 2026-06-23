import { useState, useEffect, useRef } from 'react';
import { NRelay1 } from '@nostrify/nostrify';
import { ExponentialBackoff } from 'websocket-ts';   // same source NostrProvider imports its backoff from

export type RelayStatus = 'connected' | 'connecting' | 'offline';

/**
 * PURE (exported for unit test): native WebSocket readyState → status.
 * 1 OPEN → connected · 0 CONNECTING → connecting · 2 CLOSING / 3 CLOSED (and anything else) → offline.
 */
export function readyStateToStatus(rs: number): RelayStatus {
  if (rs === 1) return 'connected';
  if (rs === 0) return 'connecting';
  return 'offline';
}

/**
 * Live per-relay connection status for the Network subpage dots.
 *
 * The hook owns its OWN dedicated NRelay1 probe sockets (NOT useNostr()'s NPool, which drives zero I/O here and whose
 * 30s default idleTimeout would self-close a status-only socket → false-offline dots). `idleTimeout: false` keeps the
 * probe open; the sockets are shared with nothing, so cleanup removes listeners AND close()s them (the inverse of the
 * usual "never close shared sockets" rule — correct precisely because these are ours). Probes are built ONLY for the
 * urls passed in — callers must never pass an in-progress draft / arbitrary string (that would open a socket per
 * keystroke). The effect is keyed on the STABLE joined-url string so an unrelated re-render doesn't re-subscribe.
 */
export function useRelayStatus(urls: string[]): Record<string, RelayStatus> {
  const [status, setStatus] = useState<Record<string, RelayStatus>>({});
  const probes = useRef<Map<string, { relay: NRelay1; off: () => void }>>(new Map());
  const key = urls.join(',');   // STABLE dep — not the array identity

  useEffect(() => {
    const set = (url: string, next: RelayStatus) =>
      setStatus((prev) => (prev[url] === next ? prev : { ...prev, [url]: next }));   // early-return on no-change

    for (const url of urls) {
      // hook OWNS this socket — idleTimeout:false prevents the 30s self-close; backoff matches NostrProvider
      const relay = new NRelay1(url, { idleTimeout: false, backoff: new ExponentialBackoff(1000, 4) });
      set(url, readyStateToStatus(relay.socket.readyState));   // seed from the current readyState

      // websocket-ts listeners — signature is (instance, ev) => void (NOT DOM-style; we ignore both args)
      const onConnected  = () => set(url, 'connected');
      const onOffline    = () => set(url, 'offline');
      const onConnecting = () => set(url, 'connecting');
      relay.socket.addEventListener('open',      onConnected);
      relay.socket.addEventListener('close',     onOffline);
      relay.socket.addEventListener('error',     onOffline);
      relay.socket.addEventListener('retry',     onConnecting);
      relay.socket.addEventListener('reconnect', onConnecting);
      probes.current.set(url, {
        relay,
        off: () => {
          relay.socket.removeEventListener('open',      onConnected);
          relay.socket.removeEventListener('close',     onOffline);
          relay.socket.removeEventListener('error',     onOffline);
          relay.socket.removeEventListener('retry',     onConnecting);
          relay.socket.removeEventListener('reconnect', onConnecting);
        },
      });
    }

    return () => {
      for (const { relay, off } of probes.current.values()) { off(); void relay.close(); }   // OUR sockets → close OK
      probes.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return status;
}
