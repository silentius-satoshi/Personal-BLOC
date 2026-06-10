import { useRef, useEffect } from 'react';
import { NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { ExponentialBackoff } from 'websocket-ts';

const NIP46_RELAYS = ['wss://relay.primal.net'];

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const pool = useRef<NPool | undefined>(undefined);

  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        // Cap reconnect backoff at 1000·2^4 = 16s (nostrify default is UNBOUNDED doubling,
        // which strands the NIP-46 socket in a minutes-long wait after an offline period).
        return new NRelay1(url, { backoff: new ExponentialBackoff(1000, 4) });
      },
      reqRouter(filters) {
        return new Map(NIP46_RELAYS.map(url => [url, filters]));
      },
      eventRouter() {
        return NIP46_RELAYS;
      },
    });
  }

  useEffect(() => {
    return () => { pool.current?.close(); };
  }, []);

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
}
