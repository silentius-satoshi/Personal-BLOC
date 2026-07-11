/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

// C0 commercialization — build-time flags. Set on the PUBLIC Vercel project only; unset (undefined) on the owner
// project → the landing/demo branches are dead code, tree-shaken out. VITE_OWNER_PUBKEY is already read in AppShell.
interface ImportMetaEnv {
  readonly VITE_LANDING?: string;      // '1' → serve LandingPage at '/'
  readonly VITE_DEMO?: string;         // '1' → seed the sandbox showcase plan + show the DemoBanner
  readonly VITE_REPO_URL?: string;     // "View source" link target on the landing page
  readonly VITE_OWNER_PUBKEY?: string; // owner hex pubkey — the private/owner gate (also set on public to close free-riding)
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  nostr?: {
    getPublicKey(): Promise<string>;
    signEvent(event: unknown): Promise<unknown>;
    nip04?: { encrypt(p: string, t: string): Promise<string>; decrypt(p: string, c: string): Promise<string> };
    nip44?: { encrypt(p: string, t: string): Promise<string>; decrypt(p: string, c: string): Promise<string> };
  };
}
