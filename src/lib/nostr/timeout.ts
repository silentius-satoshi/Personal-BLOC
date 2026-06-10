// Pure, store-free utility — keeps publish.ts dependency-light (no circular dep).

/** Signer-op timeout policy: nip07 has a human approving popups (60s); nip46 is automated (20s — rides out one capped relay-backoff window). */
export function signerOpTimeout(method: string | null | undefined): number {
  return method === 'nip07' ? 60000 : 20000;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
