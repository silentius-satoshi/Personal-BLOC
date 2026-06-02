import { createContext, useContext, useState } from 'react';
import type { NostrSigner } from './signers';

const SignerContext = createContext<{
  signer: NostrSigner | null;
  setSigner: (s: NostrSigner | null) => void;
}>({ signer: null, setSigner: () => {} });

export function SignerProvider({ children }: { children: React.ReactNode }) {
  const [signer, setSigner] = useState<NostrSigner | null>(null);
  return (
    <SignerContext.Provider value={{ signer, setSigner }}>
      {children}
    </SignerContext.Provider>
  );
}

export const useSigner = () => useContext(SignerContext);
