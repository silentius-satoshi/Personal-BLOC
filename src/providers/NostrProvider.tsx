import { useRef } from 'react';
import { NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';

const NIP46_RELAYS = ['wss://relay.primal.net'];

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const pool = useRef<NPool | undefined>(undefined);

  if (!pool.current) {
    pool.current = new NPool({
      open(url: string) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        return new Map(NIP46_RELAYS.map(url => [url, filters]));
      },
      eventRouter() {
        return NIP46_RELAYS;
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
}
