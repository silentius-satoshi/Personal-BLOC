// Type declaration for the plain-ESM .js helper so the vitest suite (TS, under tsc -b) can import it.
export function validateOwnerRequest(
  authHeader: string | undefined,
  url: string,
  method: string,
  ownerPubkey: string | undefined,
): Promise<{ ok: true } | { status: 401 | 403 }>;
